import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@wacalls/database";
import { redis } from "../redis.js";
import { whatsappClient } from "../services/whatsapp-client.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    let database = "ok";
    let redisStatus = "ok";
    let whatsapp = "error";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "error";
    }
    try {
      await redis.ping();
    } catch {
      redisStatus = "error";
    }
    try {
      const h = await whatsappClient.health();
      whatsapp = h.status === "ok" ? "ok" : "error";
    } catch {
      whatsapp = "error";
    }
    const ok = database === "ok" && redisStatus === "ok";
    return {
      status: ok ? "ok" : "degraded",
      database,
      redis: redisStatus,
      whatsapp_engine: whatsapp,
    };
  });

  app.get("/ready", async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "not_ready" });
    }
  });
};
