import { apiGet } from "@/lib/api";

export interface Recording {
  id: string;
  session_id: string;
  call_id: string;
  duration: number;
  file_path: string;
  file_size: number;
}

export const listRecordings = (sid: string) =>
  apiGet<Recording[]>(`/api/sessions/${sid}/recordings`);

export const downloadRecordingUrl = (id: string) =>
  `/api/recordings/${id}/download`;
