import { EventEmitter } from "node:events";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import pino from "pino";
import { digitsOnly, type ChannelStatus } from "@wacalls/shared";
import {
  SELFHOSTED_BASE_CAPABILITIES,
  SELFHOSTED_VOIP_CAPABILITIES,
  UnsupportedCapabilityError,
  type CallEvent,
  type CallEventHandler,
  type CallingEngine,
  type CallSession,
  type ConnectOptions,
  type EngineCapabilities,
  type EngineName,
  type InitiateCallOptions,
} from "./types.js";
import { attachVoipToSocket, type AttachedVoip, type VoipCallHandle } from "./voip-attach.js";

const logger = pino({ name: "selfhosted-engine", level: process.env.LOG_LEVEL ?? "info" });

type BaileysSock = {
  ev: {
    on: (event: string, cb: (...args: any[]) => void) => void;
    off?: (event: string, cb: (...args: any[]) => void) => void;
  };
  ws?: { on: (event: string, cb: (...args: any[]) => void) => void };
  end?: (err?: Error) => void;
  logout?: () => Promise<void>;
  sendMessage?: (jid: string, content: { text: string }) => Promise<{ key?: { id?: string } }>;
  onWhatsApp?: (jid: string | string[]) => Promise<Array<{ jid: string; exists: boolean; lid?: string }>>;
  sendPresenceUpdate?: (type: string, jid?: string) => Promise<void>;
  user?: { id?: string; name?: string };
  authState?: { creds?: { me?: { id?: string; name?: string; lid?: string } } };
};

type ChannelRuntime = {
  status: ChannelStatus;
  qrDataUrl: string | null;
  sock?: BaileysSock;
  voip?: AttachedVoip;
  voipReady?: Promise<AttachedVoip | null>;
  phoneNumber?: string;
  displayName?: string;
};

type ActiveCall = {
  callId: string;
  engineCallId: string;
  channelId: string;
  phoneNumber: string;
  startedAt: number;
  voipCall?: VoipCallHandle;
};

export type SelfHostedEngineOptions = {
  sessionRoot: string;
  organizationResolver: (channelId: string) => Promise<{ organizationId: string }>;
};

/**
 * One WhatsApp Web session per channel (Baileys).
 * Voice uses baileys-caller's WASM stack attached to that same socket.
 * Never opens a second session — that is what caused conflict/replaced / Connection Closed.
 */
export class SelfHostedWhatsAppEngine implements CallingEngine {
  readonly name: EngineName = "selfhosted";
  private caps: EngineCapabilities = { ...SELFHOSTED_BASE_CAPABILITIES };
  private readonly events = new EventEmitter();
  private readonly channels = new Map<string, ChannelRuntime>();
  private readonly callsById = new Map<string, ActiveCall>();
  private readonly pairing = new Set<string>();
  private voipAvailable: boolean | undefined;
  private baileysModule: any | null | undefined;

  constructor(private readonly options: SelfHostedEngineOptions) {
    this.events.setMaxListeners(100);
    void this.warmup();
  }

  get capabilities(): EngineCapabilities {
    return this.caps;
  }

  async warmup(): Promise<void> {
    await this.probeVoip();
    await this.loadBaileys();
  }

  async connect(channelId: string, options?: ConnectOptions): Promise<void> {
    const forceQr = Boolean(options?.forceQr);
    const existing = this.channels.get(channelId);
    if (!forceQr && existing?.sock && existing.status === "CONNECTED") {
      if (!existing.voip && !existing.voipReady) {
        this.beginVoipAttach(channelId);
      }
      return;
    }
    if (!forceQr && this.pairing.has(channelId)) {
      logger.info({ channelId }, "WhatsApp pairing already in progress");
      return;
    }
    this.pairing.add(channelId);
    if (existing?.voip) {
      try {
        existing.voip.destroy();
      } catch (err) {
        logger.warn({ err, channelId }, "previous voip teardown");
      }
    }
    if (existing?.sock) {
      try {
        existing.sock.end?.();
      } catch (err) {
        logger.warn({ err, channelId }, "previous socket end");
      }
    }

    const baileys = await this.loadBaileys();
    if (!baileys) {
      this.pairing.delete(channelId);
      throw new Error(
        "Baileys is not installed. QR connection cannot start. Install @whiskeysockets/baileys.",
      );
    }

    const authDir = await this.ensureAuthDir(channelId);
    this.setChannel(channelId, {
      status: "CONNECTING",
      qrDataUrl: null,
      phoneNumber: existing?.phoneNumber,
      displayName: existing?.displayName,
    });
    this.emit({ type: "channel_status", channelId, timestamp: iso(), status: "CONNECTING" });

    const sessionReady = await fileExists(path.join(authDir, "creds.json"));
    logger.info({ channelId, forceQr, sessionReady }, "starting WhatsApp Web pairing");
    try {
      await this.connectBaileys(channelId, authDir, baileys);
    } catch (err) {
      this.pairing.delete(channelId);
      throw err;
    }
  }

  async disconnect(channelId: string): Promise<void> {
    const runtime = this.channels.get(channelId);
    try {
      runtime?.voip?.destroy();
    } catch (err) {
      logger.warn({ err, channelId }, "voip disconnect");
    }
    try {
      runtime?.sock?.end?.();
    } catch (err) {
      logger.warn({ err, channelId }, "socket end");
    }
    this.setChannel(channelId, { status: "DISCONNECTED", qrDataUrl: null });
    this.emit({ type: "channel_status", channelId, timestamp: iso(), status: "DISCONNECTED" });
  }

  async getStatus(channelId: string): Promise<ChannelStatus> {
    return this.channels.get(channelId)?.status ?? "DISCONNECTED";
  }

  async getQr(channelId: string): Promise<string | null> {
    return this.channels.get(channelId)?.qrDataUrl ?? null;
  }

  async initiateCall(
    channelId: string,
    phoneNumber: string,
    options?: InitiateCallOptions,
  ): Promise<CallSession> {
    const runtime = this.channels.get(channelId);
    if (!runtime || runtime.status !== "CONNECTED" || !runtime.sock) {
      throw new Error("WhatsApp channel is not CONNECTED");
    }

    const voip = await this.ensureVoip(channelId);
    if (!voip) {
      throw new UnsupportedCapabilityError(
        "outbound WhatsApp voice media (WASM VoIP stack)",
        this.name,
      );
    }

    const digits = digitsOnly(phoneNumber);
    const callId = options?.clientCallId || cryptoRandom();
    this.emit({ type: "connecting", callId, channelId, timestamp: iso() });

    const voipCall = await voip.call(digits, {
      audioSource: options?.audioFilePath ?? (options?.silence === false ? undefined : "silence"),
      durationMs: 0,
    });

    const active: ActiveCall = {
      callId,
      engineCallId: voipCall.callId,
      channelId,
      phoneNumber,
      startedAt: Date.now(),
      voipCall,
    };
    this.callsById.set(callId, active);
    this.callsById.set(voipCall.callId, active);

    voipCall.on("ringing", () => {
      this.emit({ type: "ringing", callId, channelId, timestamp: iso() });
    });
    voipCall.on("connected", () => {
      this.emit({ type: "answered", callId, channelId, timestamp: iso() });
    });
    voipCall.on("recording", (filePath: string) => {
      this.emit({ type: "recording", callId, channelId, timestamp: iso(), recordingPath: filePath });
    });
    voipCall.on("playback_done", () => {
      this.emit({ type: "playback_done", callId, channelId, timestamp: iso() });
    });
    voipCall.on("ended", (reason: string) => {
      const durationMs = Date.now() - active.startedAt;
      const mapped = mapEndReason(reason);
      this.callsById.delete(callId);
      this.callsById.delete(voipCall.callId);
      this.emit({ type: mapped, callId, channelId, timestamp: iso(), reason, durationMs });
    });
    voipCall.on("audio", (pcm: Float32Array) => {
      const copy = Float32Array.from(pcm);
      this.emit({ type: "audio", callId, channelId, timestamp: iso(), pcm: copy });
    });
    voipCall.on("error", (err: Error) => {
      this.emit({
        type: "failed",
        callId,
        channelId,
        timestamp: iso(),
        reason: err.message,
      });
    });
    if (voipCall._progressed) {
      this.emit({ type: "ringing", callId, channelId, timestamp: iso() });
    }

    return {
      callId,
      engineCallId: voipCall.callId,
      channelId,
      phoneNumber,
      status: "CONNECTING",
    };
  }

  async hangup(callId: string): Promise<void> {
    const active = this.callsById.get(callId);
    if (!active?.voipCall) return;
    try {
      active.voipCall.end();
    } catch (err) {
      logger.warn({ err, callId }, "hangup end() threw");
    }
  }

  async mute(callId: string, muted: boolean): Promise<void> {
    this.callsById.get(callId)?.voipCall?.mute(muted);
  }

  async sendAudio(callId: string, pcm: Float32Array): Promise<void> {
    const active = this.callsById.get(callId);
    if (!active) return;
    if (active.voipCall?.pushMic) {
      active.voipCall.pushMic(Float32Array.from(pcm));
      return;
    }
    const voip = this.channels.get(active.channelId)?.voip;
    voip?.pushMic(Float32Array.from(pcm));
  }

  async getProfilePicture(channelId: string, phoneNumber: string): Promise<string | null> {
    const sock = this.channels.get(channelId)?.sock as
      | (BaileysSock & {
          profilePictureUrl?: (jid: string, type?: "image" | "preview") => Promise<string>;
        })
      | undefined;
    if (!sock?.profilePictureUrl) return null;
    const digits = digitsOnly(phoneNumber);
    const jids: string[] = [`${digits}@s.whatsapp.net`];
    try {
      const listed = await sock.onWhatsApp?.(digits);
      const hit = listed?.find((row) => row.exists);
      if (hit?.jid && !jids.includes(hit.jid)) jids.unshift(hit.jid);
      if (hit?.lid) {
        const lid = hit.lid.includes("@") ? hit.lid : `${hit.lid}@lid`;
        if (!jids.includes(lid)) jids.push(lid);
      }
    } catch {
      /* PN jid is enough when LID lookup fails */
    }
    for (const jid of jids) {
      for (const type of ["preview", "image"] as const) {
        try {
          const url = await sock.profilePictureUrl(jid, type);
          if (!url) continue;
          const res = await fetch(url);
          if (!res.ok) {
            logger.warn({ jid, type, status: res.status }, "profile picture HTTP failed");
            continue;
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength < 32) continue;
          const mime = res.headers.get("content-type") || "image/jpeg";
          logger.info({ jid, type, bytes: buf.byteLength }, "profile picture loaded");
          return `data:${mime};base64,${buf.toString("base64")}`;
        } catch (err) {
          logger.warn({ jid, type, err }, "profile picture lookup failed");
        }
      }
    }
    return null;
  }

  async sendText(channelId: string, phoneNumber: string, text: string): Promise<{ id?: string }> {
    const runtime = this.channels.get(channelId);
    if (!runtime?.sock?.sendMessage) {
      throw new Error(
        "WhatsApp Web session is not CONNECTED. Open WhatsApp → Reconnect, scan QR if asked, then send again.",
      );
    }
    const digits = digitsOnly(phoneNumber);
    const result = await runtime.sock.sendMessage(`${digits}@s.whatsapp.net`, { text });
    return { id: result?.key?.id };
  }

  onCallEvent(handler: CallEventHandler): () => void {
    this.events.on("event", handler);
    return () => this.events.off("event", handler);
  }

  private async connectBaileys(channelId: string, authDir: string, baileys: any): Promise<void> {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      Browsers,
    } = baileys;
    const makeSocket = makeWASocket ?? baileys.makeWASocket;
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version: number[] | undefined;
    try {
      const fetched = await fetchLatestBaileysVersion();
      version = fetched.version;
    } catch {
      version = undefined;
    }

    const sock: BaileysSock = makeSocket({
      auth: state,
      version,
      printQRInTerminal: false,
      emitOwnEvents: true,
      markOnlineOnConnect: true,
      browser: Browsers?.ubuntu?.("Chrome") ?? ["Ubuntu", "Chrome", "22.04.4"],
      syncFullHistory: false,
    });

    this.setChannel(channelId, {
      ...(this.channels.get(channelId) ?? { status: "CONNECTING", qrDataUrl: null }),
      sock,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update: any) => {
      if (update.qr) {
        logger.info({ channelId }, "WhatsApp QR received from Baileys");
        const qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
        this.setChannel(channelId, {
          ...(this.channels.get(channelId) as ChannelRuntime),
          status: "CONNECTING",
          qrDataUrl,
        });
        this.emit({ type: "qr", channelId, timestamp: iso(), qrDataUrl, status: "CONNECTING" });
      }

      if (update.connection === "open") {
        this.pairing.delete(channelId);
        const me = sock.user ?? sock.authState?.creds?.me;
        const jid = String(me?.id ?? "");
        const phoneNumber = jidToPhone(jid);
        this.setChannel(channelId, {
          ...(this.channels.get(channelId) as ChannelRuntime),
          status: "CONNECTED",
          qrDataUrl: null,
          sock,
          phoneNumber,
          displayName: me?.name,
        });
        this.emit({
          type: "channel_status",
          channelId,
          timestamp: iso(),
          status: "CONNECTED",
          phoneNumber,
          displayName: me?.name,
        });
        this.beginVoipAttach(channelId);
      }

      if (update.connection === "close") {
        this.pairing.delete(channelId);
        if (this.channels.get(channelId)?.sock !== sock) return;
        const current = this.channels.get(channelId);
        try {
          current?.voip?.destroy();
        } catch {
          /* ignore */
        }
        const code = update.lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason?.loggedOut;
        if (loggedOut) {
          this.setChannel(channelId, { status: "DISCONNECTED", qrDataUrl: null });
          this.emit({
            type: "channel_status",
            channelId,
            timestamp: iso(),
            status: "DISCONNECTED",
          });
          return;
        }
        this.setChannel(channelId, { status: "RECONNECTING", qrDataUrl: null });
        this.emit({
          type: "channel_status",
          channelId,
          timestamp: iso(),
          status: "RECONNECTING",
        });
        setTimeout(() => {
          void this.connect(channelId).catch((err) => {
            logger.error({ err, channelId }, "reconnect failed");
            this.setChannel(channelId, { status: "ERROR", qrDataUrl: null });
            this.emit({ type: "channel_status", channelId, timestamp: iso(), status: "ERROR" });
          });
        }, 2000);
      }
    });
  }

  private beginVoipAttach(channelId: string) {
    const runtime = this.channels.get(channelId);
    if (!runtime?.sock || runtime.voipReady) return;
    runtime.voipReady = this.attachVoip(channelId, runtime.sock);
    this.setChannel(channelId, { ...runtime, voipReady: runtime.voipReady });
  }

  private async attachVoip(channelId: string, sock: BaileysSock): Promise<AttachedVoip | null> {
    const available = await this.probeVoip();
    if (!available) return null;
    try {
      const voip = await attachVoipToSocket(sock);
      const prev = this.channels.get(channelId);
      if (!prev || prev.sock !== sock) {
        voip.destroy();
        return null;
      }
      this.caps = { ...SELFHOSTED_VOIP_CAPABILITIES };
      this.setChannel(channelId, { ...prev, voip, voipReady: Promise.resolve(voip) });
      logger.info({ channelId }, "outbound voice ready on existing WhatsApp session");
      return voip;
    } catch (err) {
      logger.error({ err, channelId }, "failed to attach WASM voice to WhatsApp socket");
      const prev = this.channels.get(channelId);
      if (prev) {
        this.setChannel(channelId, { ...prev, voip: undefined, voipReady: Promise.resolve(null) });
      }
      return null;
    }
  }

  private async ensureVoip(channelId: string): Promise<AttachedVoip | null> {
    const runtime = this.channels.get(channelId);
    if (!runtime) return null;
    if (runtime.voip) return runtime.voip;
    if (runtime.voipReady) {
      const ready = await runtime.voipReady;
      if (ready) return ready;
    }
    if (runtime.sock) {
      runtime.voipReady = this.attachVoip(channelId, runtime.sock);
      this.setChannel(channelId, { ...runtime, voipReady: runtime.voipReady });
      return runtime.voipReady;
    }
    return null;
  }

  private async loadBaileys(): Promise<any | null> {
    if (this.baileysModule !== undefined) return this.baileysModule;
    try {
      this.baileysModule = await import("@whiskeysockets/baileys");
      return this.baileysModule;
    } catch (err) {
      logger.warn({ err }, "Baileys not available");
      this.baileysModule = null;
      return null;
    }
  }

  private async probeVoip(): Promise<boolean> {
    if (this.voipAvailable !== undefined) {
      if (this.voipAvailable) this.caps = { ...this.caps, ...SELFHOSTED_VOIP_CAPABILITIES, qrConnect: true };
      return this.voipAvailable;
    }
    try {
      await import("baileys-caller");
      this.voipAvailable = true;
      this.caps = { ...this.caps, ...SELFHOSTED_VOIP_CAPABILITIES, qrConnect: true };
      return true;
    } catch (err) {
      logger.warn(
        { err },
        "baileys-caller not installed; QR/session works, outbound voice media is unavailable",
      );
      this.voipAvailable = false;
      this.caps = { ...SELFHOSTED_BASE_CAPABILITIES };
      return false;
    }
  }

  private async ensureAuthDir(channelId: string): Promise<string> {
    const { organizationId } = await this.options.organizationResolver(channelId);
    const dir = path.join(this.options.sessionRoot, organizationId, channelId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  private setChannel(channelId: string, runtime: ChannelRuntime) {
    this.channels.set(channelId, runtime);
  }

  private emit(event: CallEvent) {
    this.events.emit("event", event);
  }
}

function iso() {
  return new Date().toISOString();
}

function cryptoRandom() {
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function jidToPhone(jid: string): string | undefined {
  const user = jid.split("@")[0]?.split(":")[0];
  return user ? `+${user}` : undefined;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function mapEndReason(reason: string): CallEvent["type"] {
  const r = reason.toLowerCase();
  if (r.includes("reject")) return "rejected";
  if (r.includes("busy")) return "busy";
  if (r.includes("timeout") || r.includes("no_answer") || r.includes("no-answer") || r.includes("no_ring")) {
    return "no_answer";
  }
  if (r.includes("no_offer") || r.includes("fail") || r.includes("error")) return "failed";
  return "ended";
}
