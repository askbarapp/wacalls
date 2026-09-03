import { useEffect, useState } from "react";
import { Mic, Download, Clock, FileAudio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listRecordings, downloadRecordingUrl, type Recording } from "@/services/recordings";
import { useI18n } from "@/lib/i18n";

export const RecordingsPage = ({ sid }: { sid: string }) => {
  const t = useI18n((s) => s.t);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRecordings(sid)
      .then(setRecordings)
      .catch(() => setRecordings([]))
      .finally(() => setLoading(false));
  }, [sid]);

  const formatDuration = (ms: number) => {
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return `${mins}:${remainSecs.toString().padStart(2, "0")}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5" />
        <h2 className="text-lg font-semibold">{t("recordings")}</h2>
      </div>

      {recordings.length === 0 ? (
        <Card className="p-8 text-center">
          <FileAudio className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("no_recordings")}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {recordings.map((rec) => (
            <Card key={rec.id} className="flex items-center gap-4 p-4">
              <FileAudio className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{rec.call_id}</p>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(rec.duration)}
                  </span>
                  <span>{formatSize(rec.file_size)}</span>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={downloadRecordingUrl(rec.id)} download>
                  <Download className="h-4 w-4 mr-1" />
                  WAV
                </a>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
