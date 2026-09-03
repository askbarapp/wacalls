import { ChannelLock } from "@wacalls/queue";
import { redis, redisPub, redisSub } from "../redis.js";
import { broadcast } from "../ws.js";

export const EVENTS_CHANNEL = "wacalls:events";

const lock = new ChannelLock(redis);
const TERMINAL_CALL_EVENTS = new Set(["ended", "failed", "busy", "no_answer", "rejected"]);

export async function publishEvent(payload: unknown) {
  await redisPub.publish(EVENTS_CHANNEL, JSON.stringify(payload));
}

export async function startEventBridge() {
  await redisSub.subscribe(EVENTS_CHANNEL);
  redisSub.on("message", (_ch: string, message: string) => {
    try {
      const event = JSON.parse(message) as {
        organizationId?: string;
        type?: string;
        channelId?: string;
        callId?: string;
      };
      if (event.channelId && event.callId && event.type && TERMINAL_CALL_EVENTS.has(event.type)) {
        void lock.release(event.channelId, event.callId);
      }
      if (event.type === "inbound_chat" && event.channelId) {
        const chat = event as { channelId: string; phone?: string; text?: string; messageId?: string };
        if (chat.phone && chat.text) {
          void import("./visits-support.js").then((mod) =>
            mod.ingestInboundWhatsApp({
              channelId: chat.channelId,
              phone: chat.phone!,
              text: chat.text!,
              whatsappId: chat.messageId,
            }),
          );
        }
      }
      broadcast(event.organizationId, event);
    } catch {
      /* ignore */
    }
  });
}
