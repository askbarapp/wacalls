export function StatusBadge({ status }: { status: string }) {
  const s = (status || "UNKNOWN").toUpperCase();
  const tone =
    s === "CONNECTED" || s === "ANSWERED" || s === "RUNNING" || s === "COMPLETED"
      ? "bg-brand-500/15 text-brand-400 ring-brand-500/30"
      : s === "CONNECTING" || s === "RINGING" || s === "QUEUED" || s === "RECONNECTING"
        ? "bg-amber-400/15 text-amber-300 ring-amber-400/30"
        : s === "ERROR" || s === "FAILED" || s === "DISCONNECTED" || s === "CANCELLED"
          ? "bg-rose-500/15 text-rose-300 ring-rose-500/30"
          : "bg-white/10 text-slate-300 ring-white/10";
  const dot =
    s === "CONNECTED" || s === "ANSWERED" || s === "RUNNING"
      ? "bg-brand-400"
      : s === "CONNECTING" || s === "RINGING" || s === "QUEUED"
        ? "bg-amber-300"
        : s === "ERROR" || s === "FAILED" || s === "DISCONNECTED"
          ? "bg-rose-400"
          : "bg-slate-400";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ring-1 ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {s.replaceAll("_", " ")}
    </span>
  );
}
