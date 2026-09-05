/** Max length for user-uploaded campaign / dialer audio (WAV / MP3). */
export const MAX_UPLOAD_AUDIO_DURATION_MS = 3 * 60 * 1000;

export function getAudioFileDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      const ms = Math.round(audio.duration * 1000);
      cleanup();
      if (!Number.isFinite(ms) || ms <= 0) {
        reject(new Error("Could not read audio duration"));
        return;
      }
      resolve(ms);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Invalid audio file"));
    };
    audio.src = url;
  });
}

/** Throws if the file is longer than the allowed upload limit. */
export async function assertUploadAudioDuration(file: File): Promise<number> {
  const durationMs = await getAudioFileDurationMs(file);
  if (durationMs > MAX_UPLOAD_AUDIO_DURATION_MS) {
    throw new Error("Audio must be 3 minutes or shorter.");
  }
  return durationMs;
}
