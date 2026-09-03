"use client";

import Link from "next/link";
import { AudioLines, MessageSquareText, Phone, Sparkles, Upload, type LucideIcon } from "lucide-react";

export type CallMode = "ai" | "tts" | "recording" | "live";

export type DialerAgent = {
  id: string;
  name: string;
  greeting?: string | null;
  systemPrompt: string;
  language: string;
  voice?: string | null;
};
export type DialerRecording = { id: string; name: string };
export type DialerLang = { code: string; label: string };

const MODES: Array<{
  id: CallMode;
  title: string;
  desc: string;
  icon: LucideIcon;
  tint: string;
}> = [
  {
    id: "ai",
    title: "AI Agent",
    desc: "AI handles the call.",
    icon: Sparkles,
    tint: "bg-violet-500/20 text-violet-300",
  },
  {
    id: "tts",
    title: "Play Message",
    desc: "Speak a message.",
    icon: MessageSquareText,
    tint: "bg-sky-500/20 text-sky-300",
  },
  {
    id: "recording",
    title: "Audio Upload",
    desc: "Play a recording.",
    icon: AudioLines,
    tint: "bg-amber-500/20 text-amber-300",
  },
  {
    id: "live",
    title: "Talk Yourself",
    desc: "You speak on the call.",
    icon: Phone,
    tint: "bg-emerald-500/20 text-emerald-300",
  },
];

export function DialerModePanel({
  mode,
  onMode,
  agents,
  recordings,
  languages,
  speakers,
  sarvam,
  aiConfigId,
  onAiConfigId,
  recordingId,
  onRecordingId,
  ttsBody,
  onTtsBody,
  ttsLanguage,
  onTtsLanguage,
  ttsSpeaker,
  onTtsSpeaker,
  onUpload,
  uploading,
  disabled,
  inCall,
  busy,
  onCall,
}: {
  mode: CallMode;
  onMode: (mode: CallMode) => void;
  agents: DialerAgent[];
  recordings: DialerRecording[];
  languages: DialerLang[];
  speakers: string[];
  sarvam: boolean;
  aiConfigId: string;
  onAiConfigId: (id: string) => void;
  recordingId: string;
  onRecordingId: (id: string) => void;
  ttsBody: string;
  onTtsBody: (v: string) => void;
  ttsLanguage: string;
  onTtsLanguage: (v: string) => void;
  ttsSpeaker: string;
  onTtsSpeaker: (v: string) => void;
  onUpload: (file: File) => void;
  uploading: boolean;
  disabled: boolean;
  inCall: boolean;
  busy?: boolean;
  onCall: () => void;
}) {
  const agent = agents.find((a) => a.id === aiConfigId);
  const needsKey = mode === "ai" || mode === "tts";
  return (
    <section className="flex h-full min-h-[720px] flex-col rounded-[2rem] border border-white/10 bg-ink-900/80 p-5">
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Call mode</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {MODES.map((item) => {
          const Icon = item.icon;
          const active = mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              disabled={inCall}
              onClick={() => onMode(item.id)}
              className={`rounded-2xl border px-3 py-3 text-left transition ${
                active ? "border-brand-400 bg-brand-500/10" : "border-white/10 bg-white/5 hover:border-white/20"
              }`}
            >
              <span className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full ${item.tint}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="text-sm font-medium text-white">{item.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{item.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 min-h-0 flex-1 space-y-3">
        {mode === "ai" ? (
          <>
            <label className="block text-xs text-slate-400">Conversation AI agent</label>
            <select value={aiConfigId} onChange={(e) => onAiConfigId(e.target.value)} disabled={inCall}>
              {agents.length === 0 ? <option value="">Create an agent first</option> : null}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {agent ? (
              <>
                <p className="text-xs text-slate-500">
                  Uses this agent’s prompt, greeting, voice, and appointment slots.{" "}
                  <Link href={`/ai-calling?test=${agent.id}`} className="text-brand-400 underline">
                    Test / edit
                  </Link>
                </p>
                <textarea readOnly className="min-h-28 w-full text-xs text-slate-300" value={agent.systemPrompt} />
                {agent.greeting ? (
                  <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                    Opening line: {agent.greeting}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Create an AI agent on{" "}
                <Link href="/ai-calling" className="text-brand-400 underline">
                  AI calling
                </Link>{" "}
                with a knowledge base and appointment slots.
              </p>
            )}
          </>
        ) : null}

        {mode === "tts" ? (
          <>
            <label className="block text-xs text-slate-400">Message to speak</label>
            <textarea
              className="min-h-32 w-full"
              disabled={inCall}
              placeholder="Hello {{name}}, this is a reminder about..."
              value={ttsBody}
              onChange={(e) => onTtsBody(e.target.value)}
            />
            <p className="text-[11px] text-slate-500">
              Personalize with <code className="text-slate-300">{"{{name}}"}</code>{" "}
              <code className="text-slate-300">{"{{phone}}"}</code>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Voice</label>
                <select value={ttsSpeaker} onChange={(e) => onTtsSpeaker(e.target.value)} disabled={inCall}>
                  {speakers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Language</label>
                <select value={ttsLanguage} onChange={(e) => onTtsLanguage(e.target.value)} disabled={inCall}>
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        ) : null}

        {mode === "recording" ? (
          <>
            <label className="block text-xs text-slate-400">Audio file</label>
            <select value={recordingId} onChange={(e) => onRecordingId(e.target.value)} disabled={inCall}>
              {recordings.length === 0 ? <option value="">Upload a WAV or MP3 first</option> : null}
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-3 text-sm text-slate-300">
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading…" : "Upload audio"}
              <input
                type="file"
                accept=".wav,.mp3,audio/wav,audio/mpeg"
                className="hidden"
                disabled={inCall || uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-[11px] text-slate-500">Played when they answer, then the call hangs up.</p>
          </>
        ) : null}

        {mode === "live" ? (
          <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-400">
            Your browser microphone is sent on the WhatsApp call. Allow mic access when you tap Call now.
          </p>
        ) : null}

        {needsKey && !sarvam ? (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Add your Sarvam AI API key on{" "}
            <Link href="/ai-calling" className="font-medium underline">
              AI calling
            </Link>{" "}
            before using text-to-speech or the AI agent.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onCall}
        disabled={disabled || inCall || busy}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-base font-semibold text-white shadow-lg shadow-emerald-500/25"
      >
        <Phone className="h-5 w-5" />
        {busy ? "Preparing call…" : "Call now"}
      </button>
    </section>
  );
}
