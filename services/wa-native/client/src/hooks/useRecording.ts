import { useCallback, useRef, useState } from "react";

type RecordingState = "idle" | "recording" | "processing";

export const useRecording = () => {
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef = useRef(0);

  const start = useCallback(
    (streams: MediaStream[]) => {
      if (streams.length === 0) return;

      const combined = new MediaStream();
      for (const s of streams) {
        s.getTracks().forEach((t) => combined.addTrack(t));
      }

      chunksRef.current = [];
      durationRef.current = 0;

      const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      let mimeType = "";
      for (const mt of mimeTypes) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) {
          mimeType = mt;
          break;
        }
      }
      if (!mimeType) {
        return;
      }

      const recorder = new MediaRecorder(combined, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        setState("processing");
        if (timerRef.current) clearInterval(timerRef.current);

        const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        a.href = url;
        a.download = `wacalls-recording-${ts}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        setState("idle");
        setDuration(0);
      };

      recorder.start(1000);
      setState("recording");

      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDuration(durationRef.current);
      }, 1000);
    },
    [],
  );

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const toggle = useCallback(
    (streams: MediaStream[]) => {
      if (state === "recording") stop();
      else start(streams);
    },
    [state, start, stop],
  );

  return { state, duration, start, stop, toggle };
};
