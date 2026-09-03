import { useEffect } from "react";
import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sounds } from "@/lib/sounds";
import { useCalls } from "@/stores/calls";
import { useDevices } from "@/stores/devices";
import { useAcceptCall } from "@/hooks/useAcceptCall";
import { useRejectCall } from "@/hooks/useRejectCall";
import { useI18n } from "@/lib/i18n";

export const IncomingCallModal = () => {
  const incoming = useCalls((s) => s.incoming);
  const micId = useDevices((s) => s.micId);
  const accept = useAcceptCall(micId);
  const reject = useRejectCall();
  const t = useI18n((s) => s.t);
  const busy = accept.isPending || reject.isPending;

  useEffect(() => {
    if (!incoming) return;
    sounds.ring();
    return () => sounds.stop();
  }, [incoming]);

  return (
    <Dialog open={!!incoming}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-sm"
      >
        <DialogHeader className="items-center text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PhoneIncoming className="h-7 w-7" />
          </div>
          <DialogTitle>{t("incoming_call")}</DialogTitle>
          <DialogDescription className="truncate">{incoming?.peer}</DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex items-center justify-center gap-6">
          <Button
            variant="destructive"
            size="icon"
            className="h-14 w-14 rounded-full"
            disabled={busy}
            onClick={() => {
              sounds.busy();
              incoming && reject.mutate({ sid: incoming.sessionId, callId: incoming.callId });
            }}
            aria-label={t("reject")}
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
          <Button
            size="icon"
            className="h-14 w-14 rounded-full"
            disabled={busy}
            onClick={() => {
              sounds.stop();
              incoming && accept.mutate({ sid: incoming.sessionId, callId: incoming.callId });
            }}
            aria-label={t("accept")}
          >
            <Phone className="h-6 w-6" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
