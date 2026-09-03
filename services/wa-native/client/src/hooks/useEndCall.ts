import { useMutation } from "@tanstack/react-query";
import { sounds } from "@/lib/sounds";
import { endCall } from "@/services/calls";

export const useEndCall = () =>
  useMutation({
    mutationFn: async (vars: { sid: string; callId: string }) => {
      sounds.disconnect();
      try {
        await endCall(vars.sid, vars.callId);
      } catch {}
    },
  });
