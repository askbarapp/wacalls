"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, PhoneOff } from "lucide-react";
import { api } from "@/lib/api";
import { CallMicSession, type CallPhase } from "@/lib/agent-test-audio";

type Turn = { role: "user" | "assistant"; content: string };

type Props = {
  agentId: string;
  agentName: string;
  onClose: () => void;
};

const PHASE_LABEL: Record<CallPhase, string> = {
  idle: "Enable microphone to start",
  starting: "Connecting microphone…",
  speaking: "Agent is speaking…",
  listening: "Listening — speak naturally",
  hearing: "Hearing you…",
  thinking: "Agent is thinking…",
};

export function AgentTestPanel({ agentId, agentName, onClose }: Props) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [level, setLevel] = useState(0);
  const [turns, setTurns] = useState<Array<{ who: string; text: string }>>([]);
  const [error, setError] = useState("");
  const session = useRef<CallMicSession | null>(null);
  const history = useRef<Turn[]>([]);
  const alive = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      session.current?.stop();
      session.current = null;
    };
  }, []);

  async function postTurn(payload: { audioBase64?: string; history: Turn[] }) {
    return api<{
      success: true;
      data: {
        transcript: string | null;
        reply: string | null;
        audioBase64: string | null;
        history: Turn[];
        listenAgain?: boolean;
      };
    }>(`/api/v1/ai-configs/${agentId}/test`, {
      method: "POST",
      body: JSON.stringify({ contactName: "there", ...payload }),
    });
  }

  async function playReply(audioBase64: string, reply: string, transcript: string | null) {
    const call = session.current;
    if (!call || !alive.current) return;
    setTurns((prev) => {
      const next = [...prev];
      if (transcript) next.push({ who: "You", text: transcript });
      next.push({ who: agentName, text: reply });
      return next.slice(-12);
    });
    setPhase("speaking");
    await call.play(audioBase64);
  }

  async function handleUtterance(audioBase64: string) {
    const call = session.current;
    if (!call || !alive.current || inFlight.current) return;
    inFlight.current = true;
    call.listen(false);
    setPhase("thinking");
    setError("");
    try {
      const res = await postTurn({ audioBase64, history: history.current });
      if (!alive.current) return;
      if (res.data.listenAgain || !res.data.reply || !res.data.audioBase64) {
        return;
      }
      history.current = res.data.history;
      await playReply(res.data.audioBase64, res.data.reply, res.data.transcript);
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : "Call failed");
    } finally {
      inFlight.current = false;
      if (!alive.current) return;
      call.listen(true);
      setPhase("listening");
    }
  }

  async function enableMic() {
    if (phase !== "idle") return;
    setError("");
    setPhase("starting");
    const unlock = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
    );
    void unlock.play().catch(() => undefined);
    const call = new CallMicSession();
    session.current = call;
    try {
      await call.start({
        onLevel: (value) => setLevel(value),
        onHearing: (hearing) => {
          if (inFlight.current) return;
          setPhase(hearing ? "hearing" : "listening");
        },
        onUtterance: (clip) => void handleUtterance(clip),
      });
      const greet = await postTurn({ history: [] });
      if (!alive.current) return;
      history.current = greet.data.history;
      if (greet.data.reply && greet.data.audioBase64) {
        await playReply(greet.data.audioBase64, greet.data.reply, null);
      }
      if (!alive.current) return;
      call.listen(true);
      setPhase("listening");
    } catch (err) {
      session.current?.stop();
      session.current = null;
      setPhase("idle");
      const denied =
        (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "NotAllowedError") ||
        (err instanceof Error && /NotAllowedError|NotFoundError|Permission|microphone/i.test(`${err.name} ${err.message}`));
      setError(
        denied
          ? "Allow the microphone, then tap it again. This test is a live voice call."
          : err instanceof Error
            ? err.message
            : "Could not start the test call",
      );
    }
  }

  function hangup() {
    alive.current = false;
    session.current?.stop();
    session.current = null;
    onClose();
  }

  const live = phase !== "idle";
  const pulse = phase === "hearing" || phase === "listening";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center">
      <div className="flex w-full max-w-md flex-col rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Test call</p>
            <h3 className="font-medium text-white">{agentName}</h3>
            <p className="mt-1 text-xs text-slate-400">
              Same Sarvam voice call as WhatsApp: you speak, the agent listens and answers.
            </p>
          </div>
          <button type="button" className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white" onClick={hangup}>
            Close
          </button>
        </div>
        {error ? (
          <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
        ) : null}
        <div className="mb-5 min-h-28 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/50 p-3">
          {turns.length === 0 ? (
            <p className="text-sm text-slate-500">
              Tap the mic, allow it, then talk as you would on a phone. The agent greets you first.
            </p>
          ) : (
            turns.map((t, i) => (
              <div key={`${t.who}-${i}`} className="text-sm">
                <div className="text-xs text-slate-500">{t.who}</div>
                <p className="text-slate-200">{t.text}</p>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-col items-center gap-3 py-2">
          <button
            type="button"
            disabled={live && phase === "starting"}
            onClick={() => {
              if (!live) void enableMic();
            }}
            className={`relative flex h-24 w-24 items-center justify-center rounded-full text-ink-950 disabled:opacity-60 ${
              phase === "hearing"
                ? "bg-brand-400"
                : phase === "listening"
                  ? "bg-brand-500"
                  : phase === "speaking" || phase === "thinking"
                    ? "bg-white/30"
                    : "bg-brand-500"
            }`}
            aria-label={live ? PHASE_LABEL[phase] : "Enable microphone"}
          >
            {pulse ? (
              <span
                className="absolute inset-0 rounded-full bg-brand-400/40"
                style={{ transform: `scale(${1 + Math.min(0.45, level * 8)})` }}
              />
            ) : null}
            <Mic className="relative h-9 w-9" />
          </button>
          <p className="text-sm text-slate-300">{live ? PHASE_LABEL[phase] : "Enable microphone"}</p>
        </div>
        {live ? (
          <button
            type="button"
            onClick={hangup}
            className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm text-white"
          >
            <PhoneOff className="h-4 w-4" />
            End test call
          </button>
        ) : null}
      </div>
    </div>
  );
}
