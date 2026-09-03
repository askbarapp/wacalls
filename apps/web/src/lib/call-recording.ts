import { getAccessToken } from "./api";

function apiBase() {
  return process.env.NEXT_PUBLIC_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
}

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function asAudioBlob(blob: Blob, fallback = "audio/wav") {
  if (blob.type.startsWith("audio/")) return blob;
  return new Blob([blob], { type: fallback });
}

async function recordingBlob(path: string, fallbackType = "audio/wav") {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Recording is not available yet");
  return asAudioBlob(await res.blob(), fallbackType);
}

export async function playCallRecording(callId: string) {
  const blob = await recordingBlob(`/api/v1/calls/${callId}/recording`);
  return URL.createObjectURL(blob);
}

export async function downloadCallRecording(callId: string, filename?: string) {
  const blob = await recordingBlob(`/api/v1/calls/${callId}/recording`);
  triggerDownload(blob, filename || `call-${callId}.wav`);
}

export async function playUploadedRecording(recordingId: string, mimeType?: string | null) {
  const blob = await recordingBlob(`/api/v1/recordings/${recordingId}/file`, mimeType || "audio/wav");
  return URL.createObjectURL(blob);
}

export async function downloadUploadedRecording(
  recordingId: string,
  filename?: string,
  mimeType?: string | null,
) {
  const blob = await recordingBlob(`/api/v1/recordings/${recordingId}/file`, mimeType || "audio/wav");
  triggerDownload(blob, filename || `recording-${recordingId}.wav`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  URL.revokeObjectURL(url);
}

type StopFn = () => void;
let activeStop: StopFn | null = null;

export function claimPlayback(stop: StopFn) {
  if (activeStop && activeStop !== stop) activeStop();
  activeStop = stop;
}

export function releasePlayback(stop: StopFn) {
  if (activeStop === stop) activeStop = null;
}
