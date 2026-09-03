import { useEffect, useState } from "react";
import { Phone, PhoneCall, PhoneOff, Wifi, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface SIPStatus {
  enabled: boolean;
  asterisk?: string;
  ext?: string;
  calls?: { id: string; peer: string; state: number }[];
}

const callStates: Record<number, string> = {
  0: "Idle",
  1: "Inviting",
  2: "Ringing",
  3: "Active",
  4: "Bye",
};

export const SIPPage = () => {
  const t = useI18n((s) => s.t);
  const [status, setStatus] = useState<SIPStatus | null>(null);
  const [peerURI, setPeerURI] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    apiGet<SIPStatus>("/api/sip/status")
      .then(setStatus)
      .catch(() => setStatus({ enabled: false }))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const call = async () => {
    if (!peerURI) return;
    try {
      await apiPost<{ call_id: string }>("/api/sip/call", { peer_uri: peerURI });
      toast.success("SIP call initiated");
      setPeerURI("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const hangup = async (callID: string) => {
    try {
      await apiDelete(`/api/sip/call/${callID}`);
      toast.success("Call ended");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
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
        <Phone className="h-5 w-5" />
        <h2 className="text-lg font-semibold">SIP Bridge</h2>
        {status?.enabled ? (
          <Wifi className="h-4 w-4 text-green-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <Card className="p-4">
        {status?.enabled ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted-foreground">Asterisk:</span>
              <span className="font-mono">{status.asterisk}</span>
              <span className="text-muted-foreground">Ext:</span>
              <span className="font-mono">{status.ext}</span>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="sip:ext@host (e.g. sip:101@192.168.1.100)"
                value={peerURI}
                onChange={(e) => setPeerURI(e.target.value)}
              />
              <Button onClick={call} disabled={!peerURI}>
                <PhoneCall className="h-4 w-4 mr-1" />
                Call
              </Button>
            </div>

            {status.calls && status.calls.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Active SIP calls:</p>
                {status.calls.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <p className="font-mono text-sm">{c.peer}</p>
                      <p className="text-xs text-muted-foreground">
                        {callStates[c.state] || "Unknown"} · {c.id.slice(0, 8)}...
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => hangup(c.id)}>
                      <PhoneOff className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            <WifiOff className="mx-auto h-8 w-8 mb-2" />
            <p>SIP bridge not enabled.</p>
            <p className="text-xs mt-1">
              Start with: <code>-sip -sip-addr host:port -sip-ext ext -sip-pass pass</code>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
};
