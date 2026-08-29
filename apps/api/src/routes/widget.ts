import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { enqueueCall } from "../services/calls.js";
import { ChannelWaitQueue } from "@wacalls/queue";
import { redis } from "../redis.js";

const waitQueue = new ChannelWaitQueue(redis);

export const widgetRoutes: FastifyPluginAsync = async (app) => {
  app.post("/widget/call", {
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const body = z
      .object({
        channelId: z.string().uuid(),
        phone: z.string(),
        name: z.string().optional(),
      })
      .parse(req.body);

    const channel = await prisma.whatsAppChannel.findUnique({ where: { id: body.channelId } });
    if (!channel) {
      return reply.status(404).send({ success: false, error: { message: "Unknown channel" } });
    }

    const { call, position } = await enqueueCall({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: body.phone,
      contactName: body.name ?? "Website lead",
      source: "widget",
    });

    return {
      success: true,
      call_id: call.id,
      status: "QUEUED",
      queue_position: position,
      message: position > 1 ? `You are in queue. Position: #${position}` : "Calling you now",
    };
  });

  app.get("/widget/status/:callId", async (req) => {
    const { callId } = req.params as { callId: string };
    const call = await prisma.call.findUnique({ where: { id: callId } });
    if (!call) return { success: false };
    const position = await waitQueue.position(call.channelId, call.id);
    return {
      success: true,
      status: call.status,
      queue_position: position || null,
    };
  });
};
