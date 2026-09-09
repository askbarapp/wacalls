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

  const curlSnippet = `curl -sS -X POST "${origin}/api/v1/messages" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wc_live_YOUR_KEY" \\
  -d '{
    "channel_id": "${channelId}",
    "phone": "+9198xxxxxxxx",
    "text": "Hello from our website form"
  }'`;

  const nodeSnippet = `const res = await fetch("${origin}/api/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": process.env.WACALLS_API_KEY,
  },
  body: JSON.stringify({
    channel_id: "${channelId}",
    phone: "+9198xxxxxxxx",
    text: "Hello from Node",
  }),
});
const json = await res.json();`;

  const formSnippet = `<script src="${origin}/sdk/wacalls.js"></script>
<form id="lead">
  <input name="phone" placeholder="+9198xxxxxxxx" required />
  <textarea name="text">Thanks — we got your form.</textarea>
  <button type="submit">Send WhatsApp</button>
</form>
<script>
  const client = WaCalls.init({
    token: "wc_pub_YOUR_KEY",
    channelId: "${channelId}"
  });
  document.getElementById("lead").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await client.sendMessage({ phone: fd.get("phone"), text: fd.get("text") });
  });
</script>`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Developers"
        subtitle="Use an API key from API keys, or create a Website Visit widget for live chat, page tracking, and WhatsApp calling."
      />
      <section className="mb-8 rounded-2xl border border-white/10 bg-ink-900/80 p-5 text-sm leading-relaxed text-slate-300">
        <p>
          Create <strong className="text-white">one Production key</strong> on API keys. The same{" "}
          <code>wc_live_</code> value works for voice calls and WhatsApp SMS. Put it in the{" "}
          <code>X-API-Key</code> header on your server — one key, not two. Use a{" "}
          <strong className="text-white">website key</strong> (<code>wc_pub_</code>) only in browser widgets.
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-400">
          <li>
            <code>POST /api/v1/calls</code> — queue an outbound WhatsApp Web call
          </li>
          <li>
            <code>GET /api/v1/calls/:id</code> — poll status
          </li>
          <li>
            <code>POST /api/v1/messages</code> — send WhatsApp text (CONNECTED Web line or Cloud channel)
          </li>
          <li>
            Website Visit widget — <code>/visits</code> in the app, embed <code>/widget.js</code>
          </li>
        </ul>
      </section>
      <h2 className="mb-2 text-sm font-medium text-white">Browser SDK</h2>
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200">
        {snippet}
      </pre>
      <h2 className="mb-2 mt-8 text-sm font-medium text-white">REST — curl</h2>
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200">
        {curlSnippet}
      </pre>
      <h2 className="mb-2 mt-8 text-sm font-medium text-white">REST — Node</h2>
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200">
        {nodeSnippet}
      </pre>
      <h2 className="mb-2 mt-8 text-sm font-medium text-white">HTML form</h2>
      <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-slate-200">
        {formSnippet}
      </pre>
      <p className="mt-4 text-xs text-slate-500">
        Voice calls and inbound chatbot replies need a WhatsApp Web channel that is CONNECTED. Cloud API channels are
        for outbound text only. Never commit live keys to a public repo. Copy the channel UUID from the WhatsApp page.
      </p>
    </div>
  );
}
