import { useEffect, useState, useRef, useCallback } from "react";
import type { OpenCall } from "@/lib/webrtc";

export type QualityMetrics = {
  rtt: number | null;
  jitter: number | null;
  packetLoss: number | null;
  bitrate: number | null;
  codec: string | null;
};

const empty: QualityMetrics = { rtt: null, jitter: null, packetLoss: null, bitrate: null, codec: null };

export const useCallQuality = (conn: OpenCall | undefined): QualityMetrics => {
  const [metrics, setMetrics] = useState<QualityMetrics>(empty);
  const prevBytes = useRef<number | null>(null);
  const prevTime = useRef<number>(0);

  const poll = useCallback(async () => {
    if (!conn?.pc) return;
    try {
      const stats = await conn.pc.getStats();
      let rtt: number | null = null;
      let jitter: number | null = null;
      let packetLoss: number | null = null;
      let bitrate: number | null = null;
      let codec: string | null = null;

      stats.forEach((report) => {
        if (report.type === "candidate-pair" && report.state === "succeeded") {
          rtt = report.currentRoundTripTime != null ? Math.round(report.currentRoundTripTime * 1000) : null;
        }
        if (report.type === "inbound-rtp" && report.kind === "audio") {
          jitter = report.jitter != null ? Math.round(report.jitter * 1000) : null;
          const lost = report.packetsLost ?? 0;
          const received = report.packetsReceived ?? 0;
          const total = lost + received;
          packetLoss = total > 0 ? Math.round((lost / total) * 10000) / 100 : null;

          const now = performance.now();
          if (prevBytes.current !== null && now - prevTime.current > 0) {
            const bytesDiff = (report.bytesReceived ?? 0) - prevBytes.current;
            const timeDiff = (now - prevTime.current) / 1000;
            bitrate = timeDiff > 0 ? Math.round((bytesDiff * 8) / timeDiff / 1000) : null;
          }
          prevBytes.current = report.bytesReceived ?? 0;
          prevTime.current = performance.now();
        }
        if (report.type === "codec" && report.mimeType?.startsWith("audio/")) {
          codec = report.mimeType.replace("audio/", "").toUpperCase();
        }
      });

      setMetrics({ rtt, jitter, packetLoss, bitrate, codec });
    } catch {}
  }, [conn?.pc]);

  useEffect(() => {
    if (!conn?.pc) { setMetrics(empty); return; }
    const id = setInterval(poll, 2000);
    poll();
    return () => clearInterval(id);
  }, [conn?.pc, poll]);

  return metrics;
};
