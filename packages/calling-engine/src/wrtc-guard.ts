/**
 * wrtc throws InvalidStateError if setLocalDescription runs after the PC is
 * closed. baileys-caller's RelayRtcTransport fires overlapping #connect()
 * calls, and that unhandled rejection kills the WhatsApp process (pid 1).
 * Guard the native methods so a closed PC is a no-op, not a crash.
 */
export async function installWrtcClosedStateGuard(): Promise<void> {
  let wrtc: any;
  try {
    const spec: string = "@roamhq/wrtc";
    wrtc = await import(spec);
  } catch {
    return;
  }
  const mod = wrtc.default ?? wrtc;
  const Original = mod.RTCPeerConnection;
  if (typeof Original !== "function" || Original.__wacallsGuarded) return;

  const wrapMethod = (pc: any, name: string) => {
    const orig = pc[name]?.bind(pc);
    if (typeof orig !== "function") return;
    pc[name] = async (...args: unknown[]) => {
      if (pc.signalingState === "closed" || pc.signalingState === "failed") {
        return undefined;
      }
      try {
        return await orig(...args);
      } catch (err) {
        const state = String(pc.signalingState ?? "");
        if (state === "closed" || state === "failed") return undefined;
        const message = err instanceof Error ? err.message : String(err);
        if (/signalingState is 'closed'|InvalidStateError/i.test(message)) return undefined;
        throw err;
      }
    };
  };

  function GuardedPeerConnection(...args: unknown[]) {
    const pc = new Original(...args);
    wrapMethod(pc, "setLocalDescription");
    wrapMethod(pc, "setRemoteDescription");
    wrapMethod(pc, "createOffer");
    wrapMethod(pc, "createAnswer");
    return pc;
  }
  GuardedPeerConnection.__wacallsGuarded = true;
  Object.setPrototypeOf(GuardedPeerConnection, Original);
  GuardedPeerConnection.prototype = Original.prototype;
  for (const key of Object.getOwnPropertyNames(Original)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    try {
      (GuardedPeerConnection as any)[key] = Original[key];
    } catch {
      /* ignore non-writable */
    }
  }

  mod.RTCPeerConnection = GuardedPeerConnection;
  if (wrtc.RTCPeerConnection) wrtc.RTCPeerConnection = GuardedPeerConnection;
  if (wrtc.default?.RTCPeerConnection) wrtc.default.RTCPeerConnection = GuardedPeerConnection;
}
