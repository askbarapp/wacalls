import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pino from "pino";
import { loadRelayRtcTransport } from "./load-relay.js";
import { UdpRelayTransport } from "./udp-relay.js";
import { CallRecorder } from "./call-recorder.js";
import { FileAudioFeeder } from "./file-feeder.js";
import { installWrtcClosedStateGuard } from "./wrtc-guard.js";

const logger = pino({ name: "voip-attach", level: process.env.LOG_LEVEL ?? "info" });

const SHA256_LEN = 32;

export type VoipCallHandle = {
  callId: string;
  end: () => void;
  mute: (muted: boolean) => void;
  pushMic: (pcm: Float32Array) => void;
  on: (event: string, cb: (...args: any[]) => void) => void;
  _progressed?: boolean;
};

export type AttachedVoip = {
  call: (
    phoneNumber: string,
    opts?: { audioSource?: string; durationMs?: number },
  ) => Promise<VoipCallHandle>;
  pushMic: (pcm: Float32Array) => void;
  destroy: () => void;
};

/**
 * WASM only registers sendDataToRelay / onCallEvent once. A second attachVoip
 * (reconnect) would keep sending on the destroyed first UDP/ICE sockets.
 * Always dispatch through the latest live attach.
 */
type LiveVoipHooks = {
  onVoipReady: () => void;
  onLog: (level: string, msg: string) => void;
  onSignalingXmpp: (peerJid: string, callId: string, xmlPayload: Uint8Array) => void;
  onCallEvent: (eventType: number, eventData?: string) => void;
  sendDataToRelay: (data: Uint8Array, ip: string, port: number) => number;
  onAudioCaptureInit: (config: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    framesPerChunk: number;
  }) => void;
  onAudioCaptureStart: () => void;
  onAudioCaptureStop: () => void;
  onAudioPlaybackData: (audioData: Float32Array) => void;
};

let liveHooks: LiveVoipHooks | null = null;

function dispatch<K extends keyof LiveVoipHooks>(name: K): LiveVoipHooks[K] {
  return ((...args: Parameters<LiveVoipHooks[K]>) => {
    const fn = liveHooks?.[name] as ((...a: Parameters<LiveVoipHooks[K]>) => ReturnType<LiveVoipHooks[K]>) | undefined;
    return fn?.(...args);
  }) as LiveVoipHooks[K];
}

/**
 * Load baileys-caller internals (not on the public export map) so we can
 * attach the WASM VoIP stack to an existing Baileys socket.
 * VoipClient.connect() opens a second WhatsApp Web session and WhatsApp
 * kicks the first one with conflict/replaced.
 */
async function loadCallerInternals(): Promise<{
  SignalingBridge: any;
  WasmEngine: any;
  RelayRtcTransport: any;
  AudioFeeder: any;
  ActiveCall: any;
}> {
  const require = createRequire(import.meta.url);
  let entry: string;
  try {
    entry = require.resolve("baileys-caller");
  } catch {
    entry = fileURLToPath(import.meta.resolve("baileys-caller"));
  }
  const distDir = dirname(entry);
  const load = (file: string) => import(pathToFileURL(join(distDir, file)).href);
  const [signaling, wasm, feeder, index, RelayRtcTransport] = await Promise.all([
    load("signaling.mjs"),
    load("wasm-engine.mjs"),
    load("audio-feeder.mjs"),
    import("baileys-caller"),
    loadRelayRtcTransport(),
  ]);
  return {
    SignalingBridge: signaling.SignalingBridge,
    WasmEngine: wasm.WasmEngine ?? wasm.default,
    RelayRtcTransport,
    AudioFeeder: feeder.AudioFeeder,
    ActiveCall: index.ActiveCall,
  };
}

function toBareJid(jid: string): string {
  if (!jid) return jid;
  const at = jid.indexOf("@");
  if (at < 0) return jid;
  const user = jid.slice(0, at).split(":")[0];
  return `${user}@${jid.slice(at + 1)}`;
}

function computeHkdf(
  key: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number,
): Uint8Array {
  const effectiveSalt = salt && salt.length > 0 ? Buffer.from(salt) : Buffer.alloc(SHA256_LEN, 0);
  const prk = createHmac("sha256", effectiveSalt).update(key).digest();
  const blocks = Math.ceil(length / SHA256_LEN);
  const okm = Buffer.alloc(blocks * SHA256_LEN);
  let prev = Buffer.alloc(0);
  for (let i = 1; i <= blocks; i += 1) {
    prev = createHmac("sha256", prk)
      .update(prev)
      .update(info)
      .update(Buffer.from([i]))
      .digest();
    prev.copy(okm, (i - 1) * SHA256_LEN);
  }
  return new Uint8Array(okm.buffer, okm.byteOffset, length);
}

function computeHmacSha256(data: Uint8Array, key: Uint8Array): Uint8Array {
  const result = createHmac("sha256", Buffer.from(key)).update(data).digest();
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

function isCallReceiptNode(node: any): boolean {
  if (node?.tag !== "receipt") return false;
  const child = Array.isArray(node.content) ? node.content[0] : null;
  return !!(child?.attrs?.["call-id"] || child?.attrs?.call_id);
}

function asLidJid(value: unknown): string | undefined {
  if (!value) return undefined;
  const raw = String(value);
  if (raw.includes("@lid")) return raw.includes(":") ? toBareJid(raw) : raw;
  if (/^\d+$/.test(raw)) return `${raw}@lid`;
  return undefined;
}

function deviceOf(jid: string | undefined): string | undefined {
  const user = jid?.split("@")[0] ?? "";
  const parts = user.split(":");
  return parts.length > 1 ? parts[1] : undefined;
}

function withDevice(jid: string | undefined, device: string | undefined): string | undefined {
  if (!jid) return jid;
  const at = jid.indexOf("@");
  const user = (at < 0 ? jid : jid.slice(0, at)).split(":")[0];
  const server = at < 0 ? "" : jid.slice(at + 1);
  if (!user || !server) return jid;
  if (!device) return `${user}@${server}`;
  return `${user}:${device}@${server}`;
}

function lidUser(jid: string): string {
  return jid.split("@")[0]?.split(":")[0] ?? jid;
}

function toLidPeerJid(jid: string, peerLid: string): string | undefined {
  if (!jid) return undefined;
  if (jid.includes("@lid")) return jid;
  const user = lidUser(peerLid);
  if (!user) return undefined;
  const device = deviceOf(jid);
  return device ? `${user}:${device}@lid` : `${user}@lid`;
}

function uniqueJids(jids: Array<string | undefined>): string[] {
  return [...new Set(jids.filter((j): j is string => Boolean(j)))];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function resolvePeerLid(signaling: any, sock: any, pnJid: string): Promise<string> {
  const fromMap = await signaling.resolveLid(pnJid);
  if (fromMap) return fromMap;

  if (typeof sock.onWhatsApp === "function") {
    const results = await sock.onWhatsApp(pnJid);
    const hit = Array.isArray(results) ? results[0] : undefined;
    if (hit && hit.exists === false) {
      throw new Error(
        `This number is not on WhatsApp (${pnJid.replace("@s.whatsapp.net", "")}).`,
      );
    }
    const lid =
      asLidJid(hit?.lid) ??
      (typeof hit?.jid === "string" && hit.jid.includes("@lid") ? hit.jid : undefined);
    if (lid) return lid;
  }

  const retry = await signaling.resolveLid(pnJid);
  if (retry) return retry;

  throw new Error(
    "Could not resolve this WhatsApp identity (LID). Send them a WhatsApp message from this line first, then call again.",
  );
}

/**
 * Bring up WhatsApp Web's WASM calling stack on the already-open Baileys socket.
 * Does not open a second session.
 */
export async function attachVoipToSocket(sock: any): Promise<AttachedVoip> {
  if (!sock?.ws?.on) {
    throw new Error("WhatsApp socket is not ready for voice signaling");
  }

  await installWrtcClosedStateGuard();
  const internals = await loadCallerInternals();
  const { SignalingBridge, WasmEngine, RelayRtcTransport, ActiveCall } = internals;
  if (!SignalingBridge || !WasmEngine || !ActiveCall) {
    throw new Error("baileys-caller internals are incomplete; outbound voice cannot start");
  }

  const signaling = new SignalingBridge({ sock });
  await signaling.init();

  let engine: any = null;
  let relayPacketsOut = 0;
  let relayPacketsIn = 0;
  let udpPacketsIn = 0;
  const onRelayMessage = (data: Uint8Array, ip: string, port: number, source: "udp" | "rtc" = "udp") => {
    if (source === "udp") udpPacketsIn += 1;
    // Docker's WebRTC tunnel to :3478 carries STUN/ICE, not the phone's RTP.
    // Once native UDP is receiving, keep WASM on that 5-tuple so it can hear the peer.
    if (source === "rtc" && udpPacketsIn > 8) return;
    relayPacketsIn += 1;
    if (relayPacketsIn === 1 || relayPacketsIn % 50 === 0) {
      logger.info(
        { relayPacketsIn, source, ip, port, bytes: data.byteLength, udpPacketsIn },
        "relay packet from WhatsApp edge",
      );
    }
    engine?.handleOnTransportMessage(data, ip, port);
  };
  const relay = new UdpRelayTransport({
    onTransportMessage: (data, ip, port) => onRelayMessage(data, ip, port, "udp"),
    onIceRtt: (rttMs: number, ip: string, port: number) => engine?.updateIceRtt(rttMs, ip, port),
  });
  // Browser path is a WebRTC datachannel (TURN allocate / Active). Raw UDP to
  // Meta :3478 is what actually carries RTP to the phone. Keep both.
  let rtcRelay: any = null;
  if (process.env.CALL_RELAY_WEBRTC !== "0" && RelayRtcTransport) {
    try {
      rtcRelay = new RelayRtcTransport({
        onTransportMessage: (data: Uint8Array, ip: string, port: number) =>
          onRelayMessage(data, ip, port, "rtc"),
        onIceRtt: (rttMs: number, ip: string, port: number) => engine?.updateIceRtt(rttMs, ip, port),
      });
      logger.info("WebRTC relay transport enabled (UDP stays the media path)");
    } catch (err) {
      logger.warn({ err }, "WebRTC relay unavailable; using UDP only");
    }
  }

  let activeCall: any = null;
  let signalingSent = false;
  let capturePtr = 0;
  let captureSampleRate = 16000;
  let captureChannels = 1;
  let captureFramesPerChunk = 320;
  let feeder: FileAudioFeeder | null = null;
  let captureTimer: ReturnType<typeof setInterval> | null = null;
  let micMuted = false;
  let recorder: CallRecorder | null = null;
  let callAudioSource = "silence";
  const micQueue = new Float32Array(16_000 * 3);
  let micRead = 0;
  let micWrite = 0;
  let micCount = 0;

  function pushMic(pcm: Float32Array) {
    recorder?.addUplink(pcm);
    for (let i = 0; i < pcm.length; i += 1) {
      micQueue[micWrite] = pcm[i] ?? 0;
      micWrite = (micWrite + 1) % micQueue.length;
      if (micCount < micQueue.length) micCount += 1;
      else micRead = (micRead + 1) % micQueue.length;
    }
  }

  function finishRecording(call: any) {
    if (!recorder) return;
    const rec = recorder;
    recorder = null;
    const dir = process.env.RECORDINGS_DIR || "/data/recordings";
    const filePath = join(dir, "calls", `${call.callId}.wav`);
    try {
      const saved = rec.finalize(filePath);
      if (saved) {
        logger.info({ filePath, ...saved }, "call recording saved");
        call.emit("recording", filePath);
      }
    } catch (err) {
      logger.warn({ err, filePath }, "call recording failed");
    }
  }

  function pullMic(n: number): Float32Array {
    const out = new Float32Array(n);
    if (micMuted) return out;
    for (let i = 0; i < n; i += 1) {
      if (micCount <= 0) break;
      out[i] = micQueue[micRead] ?? 0;
      micRead = (micRead + 1) % micQueue.length;
      micCount -= 1;
    }
    return out;
  }

  function stopCapturePump() {
    if (captureTimer) {
      clearInterval(captureTimer);
      captureTimer = null;
    }
  }

  function isFileAudioSource(source: string | undefined): boolean {
    if (!source || source === "silence" || source === "mic") return false;
    if (source.startsWith("lavfi:")) return false;
    return true;
  }

  function stopFileFeeder() {
    try {
      feeder?.stop();
    } catch {
      /* ignore */
    }
    feeder = null;
  }

  function startFileFeeder(source: string) {
    stopFileFeeder();
    if (!isFileAudioSource(source)) return;
    logger.info({ source }, "playing campaign audio into WhatsApp uplink");
    const next = new FileAudioFeeder(
      captureSampleRate,
      captureChannels,
      captureFramesPerChunk,
      source,
      (chunk) => pushMic(chunk),
    );
    next.on("ended", () => {
      logger.info({ source }, "campaign audio playback finished");
      if (feeder === next) feeder = null;
      activeCall?.emit?.("playback_done");
    });
    next.on("log", (msg: string) => logger.warn({ msg }, "audio feeder"));
    feeder = next;
    next.start();
  }

  function startCapturePump() {
    stopCapturePump();
    const chunkSamples = captureFramesPerChunk * captureChannels;
    const intervalMs = Math.max(10, Math.round((captureFramesPerChunk / captureSampleRate) * 1000));
    logger.info(
      { capturePtr, captureSampleRate, captureChannels, captureFramesPerChunk, intervalMs },
      "starting WASM mic pump",
    );
    captureTimer = setInterval(() => {
      if (!engine || !capturePtr) return;
      try {
        engine.sendAudioData(pullMic(chunkSamples), capturePtr);
      } catch {
        /* call may have ended */
      }
    }, intervalMs);
  }

  function ensureLiveAudio(reason: string) {
    if (!engine) return;
    if (!capturePtr) {
      const chunkSamples = captureFramesPerChunk * captureChannels;
      capturePtr = engine.malloc(chunkSamples * Float32Array.BYTES_PER_ELEMENT);
      logger.info({ reason, capturePtr, chunkSamples }, "allocated WASM mic buffer");
    }
    if (!captureTimer) startCapturePump();
    try {
      WasmEngine.notifyGlobalCallbackListeners?.("startPlaybackJS", {});
    } catch {
      /* playback loop may already be running */
    }
  }

  const hooks: LiveVoipHooks = {
      onVoipReady: () => logger.info("WASM voip stack reported ready"),
      onLog: (level: string, msg: string) => {
        if (level === "error" || level === "warn") logger.warn({ wasmLevel: level }, msg);
        else logger.debug({ wasmLevel: level }, msg);
      },
      onSignalingXmpp: (peerJid: string, callId: string, xmlPayload: Uint8Array) => {
        signalingSent = true;
        logger.info(
          { peerJid, callId, bytes: xmlPayload?.byteLength ?? (xmlPayload as any)?.length ?? 0 },
          "WASM outbound call signaling",
        );
        signaling.sendSignaling(peerJid, callId, xmlPayload);
      },
      onCallEvent: (eventType: number, eventData?: string) => {
        if (eventType === 16 && eventData) {
          try {
            const parsed = JSON.parse(eventData);
            const info = parsed.call_info ?? parsed.callInfo ?? {};
            const callState = Number(info.call_state ?? info.callState ?? 0);
            logger.info({ callState, eventType, info }, "WASM call state");
            const RINGING_OR_LIVE = callState === 2 || callState === 5 || callState === 6;
            if (activeCall && RINGING_OR_LIVE) {
              activeCall._progressed = true;
              logger.info({ callState, callId: activeCall.callId }, "WhatsApp call ringing or live");
              ensureLiveAudio(`call-state-${callState}`);
            }
            if (callState === 6 && isFileAudioSource(callAudioSource) && !feeder) {
              startFileFeeder(callAudioSource);
            }
            if ((callState === 0 || callState === 13) && !activeCall?._progressed) {
              if (activeCall) activeCall._earlyIdle = true;
              return;
            }
            if (callState === 1) {
              return;
            }
            if ((callState === 0 || callState === 13) && activeCall?._progressed) {
              stopCapturePump();
              stopFileFeeder();
              const ending = activeCall;
              try {
                ending._forceEnd("ended");
              } catch {
                /* ignore */
              }
              finishRecording(ending);
              if (activeCall === ending) activeCall = null;
              return;
            }
            activeCall?._updateState(callState);
          } catch {
            /* ignore malformed WASM event */
          }
        } else if (eventType === 156 && eventData) {
          try {
            const update = JSON.parse(eventData);
            logger.info(
              { relays: update?.relays?.length ?? 0, tokens: update?.relay_tokens?.length ?? 0 },
              "WASM relay list update",
            );
            relay.updateRelayList(update);
            try {
              rtcRelay?.updateRelayList?.(update);
            } catch {
              /* optional */
            }
          } catch {
            /* ignore */
          }
        } else if (eventType === 26 || eventType === 48) {
          logger.info({ eventType }, "WASM sound port ready");
          ensureLiveAudio(`sound-port-${eventType}`);
        } else if (eventType === 2) {
          logger.info({ progressed: Boolean(activeCall?._progressed) }, "WASM remote_end");
          if (activeCall?._progressed) activeCall._forceEnd("remote_end");
        } else {
          logger.debug({ eventType, eventData }, "WASM event");
        }
      },
      sendDataToRelay: (data: Uint8Array, ip: string, port: number) => {
        try {
          relayPacketsOut += 1;
          const rtcStats = rtcRelay?.getStats?.();
          const rtcOpen = Number(rtcStats?.openConnections ?? 0) > 0;
          if (relayPacketsOut === 1 || relayPacketsOut % 50 === 0) {
            logger.info(
              {
                relayPacketsOut,
                ip,
                port,
                bytes: data?.byteLength ?? 0,
                rtcOpen,
                rtc: rtcStats,
                udp: relay.getStats?.(),
              },
              "WASM sending media/stun to relay",
            );
          }
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          // Keep the WebRTC tunnel for TURN allocate / Active, but never stop
          // native UDP. Dropping UDP when the datachannel opens lets Docker NAT
          // expire, the phone never receives RTP, and WhatsApp shows Reconnecting.
          if (rtcRelay) {
            let rtcIp = ip;
            let rtcPort = port;
            if (ip.includes(":")) {
              const mapped = relay.ipv4Alias(ip);
              if (mapped) {
                rtcIp = mapped.ip;
                rtcPort = mapped.port || port;
              }
            }
            try {
              rtcRelay.send(copy, rtcIp, rtcPort);
            } catch (err) {
              logger.warn({ err, ip: rtcIp, port: rtcPort }, "rtc relay send threw");
            }
          }
          return relay.send(copy, ip, port);
        } catch (err) {
          logger.warn({ err, ip, port }, "relay send threw");
          return 0;
        }
      },
      onAudioCaptureInit: (config: {
        sampleRate: number;
        channels: number;
        bitsPerSample: number;
        framesPerChunk: number;
      }) => {
        if (!engine) return;
        captureSampleRate = config.sampleRate || 16000;
        captureChannels = config.channels || 1;
        captureFramesPerChunk = config.framesPerChunk || 320;
        const chunkSamples = captureFramesPerChunk * captureChannels;
        const captureChunkBytes = chunkSamples * Float32Array.BYTES_PER_ELEMENT;
        capturePtr = engine.malloc(captureChunkBytes);
        logger.info({ captureSampleRate, captureChannels, captureFramesPerChunk, capturePtr }, "WASM capture init");
      },
      onAudioCaptureStart: () => {
        logger.info({ capturePtr, callAudioSource }, "WASM capture start");
        if (!engine || !capturePtr) {
          ensureLiveAudio("capture-start");
        } else {
          startCapturePump();
        }
      },
      onAudioCaptureStop: () => {
        stopCapturePump();
        stopFileFeeder();
        if (engine && capturePtr) {
          try {
            engine.free(capturePtr);
          } catch {
            /* ignore */
          }
          capturePtr = 0;
        }
      },
      onAudioPlaybackData: (audioData: Float32Array) => {
        if (!audioData?.length) return;
        const copy = Float32Array.from(audioData);
        if (relayPacketsIn <= 1) {
          logger.info({ samples: copy.length }, "WASM playback chunk");
        }
        recorder?.addDownlink(copy);
        activeCall?._emitAudio(copy);
      },
  };
  liveHooks = hooks;
  engine = new WasmEngine({
    enableLogs: true,
    callbacks: {
      onVoipReady: dispatch("onVoipReady"),
      onLog: dispatch("onLog"),
      onSignalingXmpp: dispatch("onSignalingXmpp"),
      onCallEvent: dispatch("onCallEvent"),
      sendDataToRelay: (data: Uint8Array, ip: string, port: number) =>
        liveHooks?.sendDataToRelay(data, ip, port) ?? 0,
      onAudioCaptureInit: dispatch("onAudioCaptureInit"),
      onAudioCaptureStart: dispatch("onAudioCaptureStart"),
      onAudioCaptureStop: dispatch("onAudioCaptureStop"),
      onAudioPlaybackData: dispatch("onAudioPlaybackData"),
      cryptoHkdf: computeHkdf,
      hmacSha256: computeHmacSha256,
    },
  });

  await engine.initialize();
  signaling.attachEngine(engine);

  const selfPnJid = sock.authState?.creds?.me?.id;
  if (!selfPnJid) {
    throw new Error("WhatsApp session has no linked number yet. Reconnect and scan QR.");
  }
  const selfDevice = deviceOf(selfPnJid);
  const selfLidJid =
    withDevice(asLidJid(sock.authState?.creds?.me?.lid) ?? sock.authState?.creds?.me?.lid, selfDevice) ??
    sock.authState?.creds?.me?.lid;
  logger.info({ selfPn: toBareJid(selfPnJid), selfDevice, hasLid: Boolean(selfLidJid) }, "init voip stack identity");
  engine.initVoipStack(selfPnJid, toBareJid(selfPnJid), selfLidJid);
  await engine.waitForVoipStackReady();
  try {
    engine.updateNetworkMedium(2, 0);
  } catch {
    /* optional */
  }

  const onCallNode = (node: any) => {
    signaling.processIncomingCall(node, engine, activeCall?.callId ?? "");
  };
  const onReceiptNode = (node: any) => {
    if (!isCallReceiptNode(node)) return;
    signaling.processIncomingReceipt(node, engine, activeCall?.callId ?? "");
  };
  sock.ws.on("CB:call", onCallNode);
  sock.ws.on("CB:receipt", onReceiptNode);

  logger.info("WASM VoIP attached to existing WhatsApp socket");

  let destroyed = false;
  return {
    call: async (phoneNumber, opts = {}) => {
      if (destroyed || !engine) throw new Error("Voice stack is not connected");
      if (activeCall) throw new Error("A call is already active on this WhatsApp line");
      relayPacketsOut = 0;
      relayPacketsIn = 0;
      udpPacketsIn = 0;

      const targetNumber = phoneNumber.replace(/\D/g, "");
      const targetPnJid = `${targetNumber}@s.whatsapp.net`;
      const durationMs = opts.durationMs ?? 0;
      const audioSource = opts.audioSource ?? "silence";
      callAudioSource = audioSource;

      const peerLid = toBareJid(
        await withTimeout(
          resolvePeerLid(signaling, sock, targetPnJid),
          12_000,
          "Could not resolve this WhatsApp identity (LID). Send them a WhatsApp message from this line first, then call again.",
        ),
      );
      logger.info({ targetPnJid, peerLid }, "resolved WhatsApp identity for call");
      try {
        await sock.sendPresenceUpdate?.("available");
      } catch {
        /* optional */
      }
      for (const jid of [targetPnJid, peerLid]) {
        try {
          await sock.presenceSubscribe?.(jid);
        } catch {
          /* optional */
        }
      }
      try {
        await sock.signalRepository?.lidMapping?.storeLIDPNMappings?.([{ lid: peerLid, pn: targetPnJid }]);
      } catch {
        /* optional */
      }
      try {
        await sock.getUSyncDevices?.([targetPnJid, peerLid], false, false);
      } catch (err) {
        logger.warn({ err }, "device usync warmup failed");
      }
      await sleep(750);

      const discovered = await signaling.discoverPeerDevices(peerLid);
      const lidDevices = uniqueJids([
        peerLid,
        `${lidUser(peerLid)}:0@lid`,
        ...discovered.map((jid: string) => toLidPeerJid(jid, peerLid)),
      ]).filter((jid) => jid.includes("@lid"));
      const deviceList = (lidDevices.length ? lidDevices : [peerLid]).slice(0, 5);
      await signaling.ensureSessionsForPeers(uniqueJids([...deviceList, ...discovered, targetPnJid, peerLid]));
      try {
        await sock.assertSessions?.(deviceList, true);
      } catch {
        /* optional */
      }
      await sleep(500);
      await signaling.issueTcToken(peerLid);
      await signaling.issueTcToken(targetPnJid);
      const tcToken = await signaling.ensureTcToken(peerLid, targetPnJid);

      const attempts: Array<{ peerList: string[]; extraData?: Uint8Array | Buffer }> = [
        { peerList: deviceList, extraData: tcToken },
        { peerList: [peerLid], extraData: tcToken },
        { peerList: deviceList },
      ];

      let call: any = null;
      for (const [i, attempt] of attempts.entries()) {
        signalingSent = false;
        const callId = (`00${randomBytes(16).toString("hex").slice(2)}`).toUpperCase();
        call = new ActiveCall(callId, engine, durationMs);
        call._audioSource = audioSource;
        call._progressed = false;
        call._earlyIdle = false;
        activeCall = call;
        recorder = new CallRecorder(captureSampleRate);
        recorder.start();
        call.on("ended", () => {
          finishRecording(call);
          if (activeCall === call) activeCall = null;
        });

        logger.info(
          {
            attempt: i + 1,
            callId,
            peerJid: peerLid,
            isFromDialer: false,
            isLidCall: true,
            devices: attempt.peerList.length,
            peerList: attempt.peerList,
            hasTcToken: Boolean(attempt.extraData?.length),
          },
          "starting WhatsApp voice call",
        );
        try {
          engine.startCall({
            peerJid: peerLid,
            peerPn: targetPnJid,
            peerList: attempt.peerList,
            callId,
            isVideo: false,
            isLidCall: true,
            isFromDialer: false,
            extraData: attempt.extraData ? Uint8Array.from(attempt.extraData) : undefined,
          });
        } catch (err) {
          logger.error({ err, attempt: i + 1 }, "startCall threw");
        }

        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          if (signalingSent || call._progressed) break;
          if (call._earlyIdle) break;
          await sleep(40);
        }

        if (signalingSent || call._progressed) {
          logger.info(
            { attempt: i + 1, signalingSent, progressed: Boolean(call._progressed) },
            "WhatsApp accepted the call offer",
          );
          break;
        }

        logger.warn(
          { attempt: i + 1, signalingSent, earlyIdle: Boolean(call._earlyIdle) },
          "WASM dropped the call before sending an offer; retrying",
        );
        try {
          engine.endCall(0, false);
        } catch {
          /* ignore */
        }
        if (i < attempts.length - 1) {
          try {
            call._forceEnd("retry");
          } catch {
            /* ignore */
          }
          if (activeCall === call) activeCall = null;
          call = null;
          await sleep(400);
        }
      }

      if (!call || (!signalingSent && !call._progressed)) {
        try {
          call?._forceEnd("no_offer");
        } catch {
          /* ignore */
        }
        activeCall = null;
        throw new Error(
          "WhatsApp did not send a call offer. Keep the primary phone online and on WhatsApp. If this is a new number, send them a message from this line first, then try again.",
        );
      }

      const ringWatchdog = setTimeout(() => {
        if (activeCall === call && !call._progressed) {
          call._forceEnd("no_ring");
        }
      }, 45_000);
      call.on("ended", () => clearTimeout(ringWatchdog));
      call.on("ringing", () => clearTimeout(ringWatchdog));

      const nativeMute = call.mute.bind(call);
      call.mute = (muted: boolean) => {
        micMuted = muted;
        nativeMute(muted);
      };
      call.pushMic = pushMic;
      const nativeUpdate = call._updateState?.bind(call);
      if (typeof nativeUpdate === "function") {
        call._updateState = (state: number) => {
          if (state === 5) {
            call._progressed = true;
          }
          if (state === 6) {
            call._progressed = true;
            call.emit("connected");
          }
          nativeUpdate(state);
        };
      }
      call.end = () => {
        logger.info({ callId: call.callId }, "hanging up WhatsApp voice call");
        try {
          engine.endCall(0, true);
        } catch {
          /* ignore */
        }
        stopCapturePump();
        stopFileFeeder();
        finishRecording(call);
        if (activeCall === call) activeCall = null;
        try {
          call._forceEnd("hangup");
        } catch {
          /* already ended */
        }
      };

      return call;
    },
    pushMic,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (liveHooks === hooks) liveHooks = null;
      try {
        sock.ws?.off?.("CB:call", onCallNode);
        sock.ws?.off?.("CB:receipt", onReceiptNode);
      } catch {
        /* ignore */
      }
      try {
        activeCall?._forceEnd("disconnect");
      } catch {
        /* ignore */
      }
      activeCall = null;
      stopCapturePump();
      stopFileFeeder();
      try {
        void relay.closeAll();
      } catch {
        /* ignore */
      }
      try {
        void rtcRelay?.closeAll?.();
      } catch {
        /* ignore */
      }
      try {
        engine?.destroy();
      } catch {
        /* ignore */
      }
      engine = null;
    },
  };
}
