export function connectionState(status?: string): "CONNECTED" | "DISCONNECTED" {
  return status === "CONNECTED" ? "CONNECTED" : "DISCONNECTED";
}

/** WhatsApp line: only Connected (green) or Disconnected (red). */
export function ConnectionBadge({ status }: { status: string }) {
  const connected = connectionState(status) === "CONNECTED";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ${
        connected
          ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40"
          : "bg-rose-500/20 text-rose-200 ring-rose-400/40"
      }`}
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          connected
            ? "animate-pulse-dot bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.85)]"
            : "bg-rose-500 shadow-[0_0_8px_2px_rgba(244,63,94,0.55)]"
        }`}
      />
      {connected ? "Connected" : "Disconnected"}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = (status || "UNKNOWN").toUpperCase();
  const tone =
    s === "CONNECTED" || s === "ANSWERED" || s === "RUNNING" || s === "COMPLETED" || s === "ACTIVE"
      ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/35"
      : s === "CONNECTING" || s === "RINGING" || s === "QUEUED" || s === "RECONNECTING" || s === "SCHEDULED" || s === "PAUSED"
        ? "bg-amber-400/20 text-amber-100 ring-amber-400/35"
        : s === "ERROR" || s === "FAILED" || s === "DISCONNECTED" || s === "CANCELLED"
          ? "bg-rose-500/20 text-rose-100 ring-rose-400/35"
          : "bg-cyan-500/15 text-cyan-100 ring-cyan-400/30";
  const dot =
    s === "CONNECTED" || s === "ANSWERED" || s === "RUNNING" || s === "COMPLETED"
      ? "bg-emerald-400"
      : s === "CONNECTING" || s === "RINGING" || s === "QUEUED" || s === "SCHEDULED" || s === "PAUSED"
        ? "bg-amber-300"
        : s === "ERROR" || s === "FAILED" || s === "DISCONNECTED"
          ? "bg-rose-400"
          : "bg-cyan-300";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ring-1 ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {s.replaceAll("_", " ")}
    </span>
  );
}
