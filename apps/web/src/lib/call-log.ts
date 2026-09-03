export type CallRow = {
  id: string;
  phone: string;
  contactName?: string | null;
  status: string;
  outcome?: string | null;
  source?: string | null;
  durationMs?: number;
  createdAt: string;
  answeredAt?: string | null;
  failureReason?: string | null;
  recordingPath?: string | null;
  hasTranscript?: boolean;
  agent?: { name?: string | null } | null;
  channel?: { displayName?: string | null } | null;
  campaign?: { name?: string | null } | null;
};

export type CallListMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export const CALL_RESULT_FILTERS = [
  { id: "", label: "All results" },
  { id: "answered", label: "Answered" },
  { id: "missed", label: "Missed" },
  { id: "no_answer", label: "No answer" },
  { id: "busy", label: "Busy" },
  { id: "rejected", label: "Rejected" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "in_progress", label: "In progress" },
] as const;

export const CALL_SOURCE_FILTERS = [
  { id: "", label: "All sources" },
  { id: "dialer", label: "Dialer" },
  { id: "campaign", label: "Campaign" },
  { id: "visit", label: "Website visit" },
  { id: "widget", label: "Widget" },
  { id: "sdk", label: "SDK" },
] as const;

export function callResultLabel(row: Pick<CallRow, "status" | "outcome" | "answeredAt">) {
  if (row.status === "ANSWERED" || row.outcome === "ANSWERED" || row.answeredAt) return "Answered";
  if (row.status === "ENDED") return "Ended";
  if (row.status === "RINGING" || row.status === "CONNECTING") return "In progress";
  if (row.status === "NO_ANSWER") return "No answer";
  if (row.status === "BUSY") return "Busy";
  if (row.status === "REJECTED") return "Rejected";
  if (row.status === "CANCELLED") return "Cancelled";
  if (row.status === "FAILED") return "Failed";
  if (row.status === "QUEUED") return "Queued";
  return row.outcome?.replaceAll("_", " ") || row.status.replaceAll("_", " ");
}

export function formatCallDuration(ms?: number | null) {
  if (!ms) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
