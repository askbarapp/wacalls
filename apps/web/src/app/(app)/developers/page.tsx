"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";

type Channel = { id: string; displayName: string; status: string; provider?: string };

export default function DevelopersPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    api<{ success: true; data: Channel[] }>("/api/v1/channels")
      .then((r) => setChannels(r.data))
      .catch(() => undefined);
  }, []);

  const channelId = channels[0]?.id ?? "YOUR_CHANNEL_ID";
  const snippet = `<script src="${origin}/sdk/wacalls.js"></script>
<script>
  const client = WaCalls.init({
    token: "YOUR_API_KEY",
    channelId: "${channelId}"
  });

  // Place a WhatsApp Web call
  client.call({ phone: "+9198xxxxxxxx", name: "Website lead" })
    .then((res) => client.watchCall(res.callId, console.log));

  // Send a WhatsApp text (Web session or Cloud API channel)
  client.sendMessage({ phone: "+9198xxxxxxxx", text: "Hello from our site" });
</script>`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Developers"
        subtitle="Use an API key from API keys, or create a Website Visit widget for live chat, page tracking, and WhatsApp calling."
      />
      <section className="mb-8 rounded-2xl border border-white/10 bg-ink-900/80 p-5 text-sm leading-relaxed text-slate-300">
        <p>
          Create a <strong className="text-white">secret</strong> key (<code>wc_live_</code>) for your backend, or a{" "}
          <strong className="text-white">publishable</strong> key (<code>wc_pub_</code>) for browser widgets. Both go in
          the <code>X-API-Key</code> header.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-400">
          <li>
            <code>POST /api/v1/calls</code> — queue an outbound WhatsApp Web call
          </li>
          <li>
            <code>GET /api/v1/calls/:id</code> — poll status
          </li>
          <li>
            Website Visit widget — <code>/visits</code> in the app, embed <code>/widget.js</code>
          </li>
        </ul>
      </section>
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200">
        {snippet}
      </pre>
      <p className="mt-4 text-xs text-slate-500">
        Voice calls need a WhatsApp Web channel that is CONNECTED. Cloud API channels are for text only. Never commit
        live keys to a public repo.
      </p>
    </div>
  );
}
