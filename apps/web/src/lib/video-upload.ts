const MAX_UPLOAD_VIDEO_BYTES = 50 * 1024 * 1024;

export const VIDEO_FILE_ACCEPT = ".mp4,.mov,video/mp4,video/quicktime";

export function assertUploadVideoFile(file: File) {
  const name = file.name.toLowerCase();
  const okType =
    file.type.startsWith("video/") || name.endsWith(".mp4") || name.endsWith(".mov");
  if (!okType) throw new Error("Upload an MP4 or MOV video.");
  if (file.size > MAX_UPLOAD_VIDEO_BYTES) throw new Error("Video must be 50 MB or smaller.");
}
