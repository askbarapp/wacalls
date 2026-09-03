import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const ENSURE_ORIGINAL = `#ensureConnection = async (info) => {
        const connection = this.#getOrCreateConnection(info);
        if (connection.state === "open" || connection.state === "connecting") {
            return connection.connectPromise ?? Promise.resolve();
        }
        const promise = this.#connect(connection);
        connection.connectPromise = promise;
        try {
            await promise;
        }
        finally {
            connection.connectPromise = null;
        }
    };`;

const ENSURE_PATCHED = `#ensureConnection = async (info) => {
        const connection = this.#getOrCreateConnection(info);
        if (connection.state === "open") return;
        if (connection.connectPromise) return connection.connectPromise;
        if (connection.state === "connecting") return;
        connection.state = "connecting";
        const promise = this.#connect(connection);
        connection.connectPromise = promise;
        try {
            await promise;
        }
        catch (err) {
            console.warn("[relay-rtc] ensureConnection failed", connection.info?.id, err);
            if (connection.state === "connecting") connection.state = "failed";
        }
        finally {
            if (connection.connectPromise === promise) connection.connectPromise = null;
        }
    };`;

const CONNECT_OFFER_ORIGINAL = `        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const remoteSdp = buildRemoteRelayAnswer(offer.sdp ?? "", {
            ...connection.info,
            port: getRtcConnectPort(connection.info),
        });
        await pc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
    };`;

const CONNECT_OFFER_PATCHED = `        const offer = await pc.createOffer();
        if (connection.peerConnection !== pc || pc.signalingState === "closed") return;
        await pc.setLocalDescription(offer);
        await new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                if (connection.peerConnection !== pc || pc.signalingState === "closed") return resolve();
                const sdp = pc.localDescription?.sdp ?? "";
                const hasPub = /a=candidate:[^\\r\\n]* typ (srflx|prflx) /.test(sdp);
                if (hasPub || pc.iceGatheringState === "complete" || Date.now() - started > 8000) return resolve();
                setTimeout(tick, 200);
            };
            tick();
        });
        if (connection.peerConnection !== pc || pc.signalingState === "closed") return;
        let localSdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
        localSdp = localSdp.split("\\n").filter((line) => {
            const row = line.replace(/\\r$/, "");
            if (!row.startsWith("a=candidate:")) return true;
            const ip = row.split(" ")[4] ?? "";
            return Boolean(ip) && !ip.includes(":");
        }).join("\\n");
        const remoteSdp = buildRemoteRelayAnswer(localSdp, {
            ...connection.info,
            port: getRtcConnectPort(connection.info),
        });
        if (connection.peerConnection !== pc || pc.signalingState === "closed") return;
        const types = (localSdp.match(/typ \\w+/g) || []).join(",");
        console.warn("[relay-rtc] connecting", connection.info?.id, "localCandidates", (localSdp.match(/a=candidate:/g) || []).length, "types", types, "gather", pc.iceGatheringState);
        await pc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
    };`;

const ICE_STATE_ORIGINAL = `        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
                connection.state = "failed";
            }
        };`;

const ICE_STATE_PATCHED = `        pc.oniceconnectionstatechange = () => {
            console.warn("[relay-rtc] ice", pc.iceConnectionState, "gather", pc.iceGatheringState, "dc", dc.readyState, connection.info?.id);
            if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
                console.warn("[relay-rtc] ice connected", connection.info?.id);
                return;
            }
            if (pc.iceConnectionState === "failed" && pc.iceGatheringState !== "complete") {
                console.warn("[relay-rtc] ice failed while gathering; waiting for srflx");
                return;
            }
            if (pc.iceConnectionState === "failed") {
                connection.state = "failed";
            }
        };`;

function resolveRelayTransportPath(): string {
  const require = createRequire(import.meta.url);
  let entry: string;
  try {
    entry = require.resolve("baileys-caller");
  } catch {
    entry = fileURLToPath(import.meta.resolve("baileys-caller"));
  }
  return join(dirname(entry), "relay-transport.mjs");
}

function resolveWrtcHref(fromPath: string): string {
  const require = createRequire(fromPath);
  try {
    return pathToFileURL(require.resolve("@roamhq/wrtc")).href;
  } catch {
    return "";
  }
}

function writePatched(sourcePath: string, source: string): string {
  const beside = join(dirname(sourcePath), "wacalls-relay-transport.patched.mjs");
  try {
    writeFileSync(beside, source);
    return beside;
  } catch {
    const fallback = join(tmpdir(), "wacalls-relay-transport.mjs");
    writeFileSync(fallback, source);
    return fallback;
  }
}

export async function loadRelayRtcTransport(): Promise<any> {
  const sourcePath = resolveRelayTransportPath();
  let source = readFileSync(sourcePath, "utf8");
  if (source.includes(ENSURE_ORIGINAL)) {
    source = source.replace(ENSURE_ORIGINAL, ENSURE_PATCHED);
  }
  if (source.includes(CONNECT_OFFER_ORIGINAL)) {
    source = source.replace(CONNECT_OFFER_ORIGINAL, CONNECT_OFFER_PATCHED);
  }
  if (source.includes(ICE_STATE_ORIGINAL)) {
    source = source.replace(ICE_STATE_ORIGINAL, ICE_STATE_PATCHED);
  }
  source = source.replaceAll(
    "const pc = new RTCPeerConnection();",
    'const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:31.13.64.133:3478" }], iceCandidatePoolSize: 4 });',
  );
  source = source.replaceAll(
    "const pc = new RTCPeerConnection({ iceServers: [] });",
    'const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:31.13.64.133:3478" }], iceCandidatePoolSize: 4 });',
  );
  source = source.replace(
    "const CONNECTION_TIMEOUT_MS = 20_000;",
    "const CONNECTION_TIMEOUT_MS = 60_000;",
  );
  source = source.replace(
    "const ICE_RESTART_IDLE_THRESHOLD_MS = 10_000;",
    "const ICE_RESTART_IDLE_THRESHOLD_MS = 600_000;",
  );
  source = source.replace(
    `if (classifyRelayPacket(arrayBuffer) === "stun_alloc" &&
            connection.state === "open" &&
            connection.sentMedia &&
            Date.now() - connection.lastRxPacketTime > ICE_RESTART_IDLE_THRESHOLD_MS) {
            connection.packetBuffer = [];
            connection.bufferedBytes = 0;
            bufferPacket(connection, arrayBuffer);
            void this.#restartIce(connection);
            return packet.byteLength;
        }`,
    `if (classifyRelayPacket(arrayBuffer) === "stun_alloc" &&
            connection.state === "open" &&
            connection.dataChannel?.readyState === "open") {
            console.warn("[relay-rtc] skip ice restart; datachannel already open", connection.info?.id);
        }`,
  );
  source = source.replace(
    'const getRtcConnectPort = (info) => info.ip === "157.240.24.133" ? FAUX_WEB_CLIENT_RELAY_PORT : info.port;',
    "const getRtcConnectPort = (info) => FAUX_WEB_CLIENT_RELAY_PORT;",
  );
  source = source.replaceAll(
    `dc.onopen = () => {
            connection.state = "open";`,
    `dc.onopen = () => {
            console.warn("[relay-rtc] datachannel open", connection.info?.id);
            connection.state = "open";`,
  );
  source = source.replace(
    'const RELAY_PORT_MODE = process.env.CALL_RELAY_PORT_MODE === "web" ? "web" : "original";',
    'const RELAY_PORT_MODE = "original";',
  );

  const wrtcHref = resolveWrtcHref(sourcePath);
  if (wrtcHref) {
    source = source.replaceAll('import("@roamhq/wrtc")', `import(${JSON.stringify(wrtcHref)})`);
  }

  const patchedPath = writePatched(sourcePath, source);
  console.warn("[load-relay] patched", patchedPath, "wrtc", wrtcHref || "unresolved");
  const loaded = await import(pathToFileURL(patchedPath).href + `?v=${Date.now()}`);
  if (!loaded.RelayRtcTransport) {
    throw new Error("Patched relay transport did not export RelayRtcTransport");
  }
  return loaded.RelayRtcTransport;
}
