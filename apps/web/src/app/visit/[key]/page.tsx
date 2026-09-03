"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MessageSquare } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type Config = {
  name: string;
  buttonLabel: string;
  greeting: string;
  departments?: Array<{ id: string; name: string; connected: boolean }>;
  channelConnected: boolean;
};

export default function VisitPreviewPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/v1/public/visits/${encodeURIComponent(key)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || "Website Visit not found");
        setConfig(json.data as Config);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load"));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const existing = document.getElementById("wacalls-visit-widget");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "wacalls-visit-widget";
    script.src = "/widget.js";
    script.setAttribute("data-visit", key);
    if (API) script.setAttribute("data-api", API);
    document.body.appendChild(script);
    return () => script.remove();
  }, [key]);

  return (
    <main className="min-h-screen bg-[#07111c] p-6 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500 text-ink-950">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">{config?.name ?? "Website Visit"}</div>
            <div className="text-xs text-slate-500">Preview — this page behaves like your website</div>
          </div>
        </div>
        {error ? <p className="mb-4 text-sm text-rose-300">{error}</p> : null}
        <div className="rounded-3xl border border-white/10 bg-ink-900/80 p-8">
          <h1 className="text-2xl font-semibold">Welcome</h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
            {config?.greeting || "Use the chat button in the corner. Visitors can pick a department, chat on WhatsApp, or tap the call icon."}
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {(config?.departments ?? []).map((d) => (
              <div key={d.id} className="rounded-2xl border border-white/10 p-4">
                <div className="font-medium">{d.name}</div>
                <div className="mt-1 text-xs text-slate-500">{d.connected ? "WhatsApp connected" : "Instance offline"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
