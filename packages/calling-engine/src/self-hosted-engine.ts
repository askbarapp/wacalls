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

const logger = pino({ name: "selfhosted-engine", level: process.env.LOG_LEVEL ?? "info" });

type BaileysSock = {
  ev: {
    on: (event: string, cb: (...args: any[]) => void) => void;
    off?: (event: string, cb: (...args: any[]) => void) => void;
  };
  ws?: { on: (event: string, cb: (...args: any[]) => void) => void };
  end?: (err?: Error) => void;
  logout?: () => Promise<void>;
  user?: { id?: string; name?: string };
  authState?: { creds?: { me?: { id?: string; name?: string } } };
};

type ChannelRuntime = {
  status: ChannelStatus;
  qrDataUrl: string | null;
  sock?: BaileysSock;
  voip?: VoipHandle;
  phoneNumber?: string;
  displayName?: string;
};

type VoipHandle = {
  call: (
    phone: string,
    opts?: { audioSource?: string; durationMs?: number },
  ) => Promise<VoipCall>;
  disconnect: () => void;
};

type VoipCall = {
  callId: string;
  end: () => void;
  mute: (muted: boolean) => void;
  on: (event: string, cb: (...args: any[]) => void) => void;
};

type ActiveCall = {
  callId: string;
  engineCallId: string;
  channelId: string;
  phoneNumber: string;
  startedAt: number;
  voipCall?: VoipCall;
};

export type SelfHostedEngineOptions = {
  sessionRoot: string;
  organizationResolver: (channelId: string) => Promise<{ organizationId: string }>;
};

/**
 * Self-hosted engine.
 *
 * Phase A: Baileys QR + multi-file auth (production-capable).
 * Phase B: Optional baileys-caller VoipClient handoff after session exists
 *          so outbound media uses WhatsApp Web's WASM stack.
 *
 * If VoipClient cannot be loaded, initiateCall throws UnsupportedCapabilityError.
 * Call statuses are never invented.
 */
export class SelfHostedWhatsAppEngine implements CallingEngine {
  readonly name: EngineName = "selfhosted";
  private caps: EngineCapabilities = { ...SELFHOSTED_BASE_CAPABILITIES };
  private readonly events = new EventEmitter();
  private readonly channels = new Map<string, ChannelRuntime>();
  private readonly callsById = new Map<string, ActiveCall>();
  private voipModule: any | null | undefined;
  private baileysModule: any | null | undefined;

  constructor(private readonly options: SelfHostedEngineOptions) {
    this.events.setMaxListeners(100);
  }

  get capabilities(): EngineCapabilities {
    return this.caps;
  }

  async connect(channelId: string, options?: ConnectOptions): Promise<void> {
    const forceQr = Boolean(options?.forceQr);
    const existing = this.channels.get(channelId);
    if (existing?.sock) {
      try {
        existing.sock.end?.();
      } catch (err) {
        logger.warn({ err, channelId }, "previous socket end");
      }
    }
    if (forceQr && existing?.voip) {
      try {
        existing.voip.disconnect();
      } catch (err) {
        logger.warn({ err, channelId }, "previous voip disconnect");
      }
    }

    const baileys = await this.loadBaileys();
    if (!baileys) {
      throw new Error(
        "Baileys is not installed. QR connection cannot start. Install @whiskeysockets/baileys.",
      );
    }

    const authDir = await this.ensureAuthDir(channelId);
    this.setChannel(channelId, { status: "CONNECTING", qrDataUrl: null });
    this.emit({ type: "channel_status", channelId, timestamp: iso(), status: "CONNECTING" });

    const sessionReady = await fileExists(path.join(authDir, "creds.json"));
    const voip = await this.loadVoip();

    // Existing session can reconnect without a QR unless the operator asked for pairing.
    if (!forceQr && sessionReady && voip) {
      await this.connectVoip(channelId, authDir, voip);
      return;
    }

    logger.info({ channelId, forceQr, sessionReady }, "starting WhatsApp Web pairing");
    await this.connectBaileys(channelId, authDir, baileys, Boolean(voip));
  }

  async disconnect(channelId: string): Promise<void> {
    const runtime = this.channels.get(channelId);
    try {
      runtime?.voip?.disconnect();
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
    if (!runtime || runtime.status !== "CONNECTED") {
      throw new Error("WhatsApp channel is not CONNECTED");
    }
    if (!runtime.voip) {
      throw new UnsupportedCapabilityError(
        "outbound WhatsApp voice media (WASM VoIP stack)",
        this.name,
      );
    }

    const digits = digitsOnly(phoneNumber);
    const callId = cryptoRandom();
    this.emit({ type: "connecting", callId, channelId, timestamp: iso() });

    const voipCall = await runtime.voip.call(digits, {
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
    voipCall.on("ended", (reason: string) => {
      const durationMs = Date.now() - active.startedAt;
      const mapped = mapEndReason(reason);
      this.callsById.delete(callId);
      this.callsById.delete(voipCall.callId);
      this.emit({ type: mapped, callId, channelId, timestamp: iso(), reason, durationMs });
    });
    voipCall.on("audio", () => {
      this.emit({ type: "audio", callId, channelId, timestamp: iso() });
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

    return {
      callId,
      engineCallId: voipCall.callId,
      channelId,
      phoneNumber,
      status: "CONNECTING",
    };
  }

  async hangup(callId: string): Promise<void> {
    this.callsById.get(callId)?.voipCall?.end();
  }

  async mute(callId: string, muted: boolean): Promise<void> {
    this.callsById.get(callId)?.voipCall?.mute(muted);
  }

  async sendAudio(_callId: string, _pcm: Float32Array): Promise<void> {
    if (!this.caps.audioInject) {
      throw new UnsupportedCapabilityError("sendAudio", this.name);
    }
    // baileys-caller feeds audio from file/silence via AudioFeeder.
    // Live mic PCM injection requires a feeder hook not exported by VoipClient.
    throw new UnsupportedCapabilityError(
      "live microphone PCM inject (file playback is supported via initiateCall audioFilePath)",
      this.name,
    );
  }

  onCallEvent(handler: CallEventHandler): () => void {
    this.events.on("event", handler);
    return () => this.events.off("event", handler);
  }

  private async connectBaileys(
    channelId: string,
    authDir: string,
    baileys: any,
    handoffVoip: boolean,
  ): Promise<void> {
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
      browser: Browsers?.ubuntu?.("Chrome") ?? ["WaCalls", "Chrome", "1.0"],
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
        const me = sock.user ?? sock.authState?.creds?.me;
        const jid = String(me?.id ?? "");
        const phoneNumber = jidToPhone(jid);
        this.setChannel(channelId, {
          ...(this.channels.get(channelId) as ChannelRuntime),
          status: "CONNECTED",
          qrDataUrl: null,
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

        if (handoffVoip) {
          logger.info({ channelId }, "session saved; handing off to VoipClient for calling");
          try {
            sock.end?.();
          } catch {
            /* ignore */
          }
          const voip = await this.loadVoip();
          if (voip) {
            await this.connectVoip(channelId, authDir, voip);
          }
        }
      }

      if (update.connection === "close") {
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

  private async connectVoip(channelId: string, authDir: string, voipMod: any): Promise<void> {
    const VoipClient = voipMod.VoipClient;
    if (!VoipClient) {
      this.caps = { ...SELFHOSTED_BASE_CAPABILITIES };
      throw new Error("baileys-caller loaded but VoipClient export is missing");
    }
    const client = new VoipClient({ authDir });
    await client.connect();
    this.caps = { ...SELFHOSTED_VOIP_CAPABILITIES };
    this.setChannel(channelId, {
      status: "CONNECTED",
      qrDataUrl: null,
      voip: client,
      phoneNumber: this.channels.get(channelId)?.phoneNumber,
      displayName: this.channels.get(channelId)?.displayName,
    });
    this.emit({
      type: "channel_status",
      channelId,
      timestamp: iso(),
      status: "CONNECTED",
      phoneNumber: this.channels.get(channelId)?.phoneNumber,
    });
    logger.info({ channelId }, "VoipClient connected; outbound voice capability enabled");
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

  private async loadVoip(): Promise<any | null> {
    if (this.voipModule !== undefined) return this.voipModule;
    try {
      this.voipModule = await import("baileys-caller");
      this.caps = { ...this.caps, ...SELFHOSTED_VOIP_CAPABILITIES, qrConnect: true };
      return this.voipModule;
    } catch {
      logger.warn(
        "baileys-caller not installed; QR/session works, outbound voice media is unavailable",
      );
      this.voipModule = null;
      this.caps = { ...SELFHOSTED_BASE_CAPABILITIES };
      return null;
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
  if (r.includes("timeout") || r.includes("no_answer") || r.includes("no-answer")) {
    return "no_answer";
  }
  if (r.includes("fail") || r.includes("error")) return "failed";
  return "ended";
}
