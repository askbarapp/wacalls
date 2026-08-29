import { redisPub, redisSub } from "../redis.js";
import { broadcast } from "../ws.js";

export const EVENTS_CHANNEL = "wacalls:events";

export async function publishEvent(payload: unknown) {
  await redisPub.publish(EVENTS_CHANNEL, JSON.stringify(payload));
}

export async function startEventBridge() {
  await redisSub.subscribe(EVENTS_CHANNEL);
  redisSub.on("message", (_ch: string, message: string) => {
    try {
      const event = JSON.parse(message) as { organizationId?: string };
      broadcast(event.organizationId, event);
    } catch {
      /* ignore */
    }
  });
}
