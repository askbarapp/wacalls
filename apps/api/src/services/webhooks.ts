import { prisma } from "@wacalls/database";
import { webhookQueue } from "../queues.js";

export async function enqueueWebhook(
  organizationId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const hooks = await prisma.webhook.findMany({
    where: { organizationId, isActive: true, events: { has: event } },
  });
  for (const hook of hooks) {
    await webhookQueue.add("deliver", {
      webhookId: hook.id,
      event,
      payload: {
        event,
        timestamp: new Date().toISOString(),
        organization_id: organizationId,
        ...payload,
      },
    });
  }
}
