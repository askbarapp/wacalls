import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { channelRoutes } from "./routes/channels.js";
import { callRoutes } from "./routes/calls.js";
import { contactRoutes } from "./routes/contacts.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { userRoutes } from "./routes/users.js";
import { recordingRoutes } from "./routes/recordings.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { keyRoutes } from "./routes/keys.js";
import { settingsRoutes } from "./routes/settings.js";
import { widgetRoutes } from "./routes/widget.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { aiRoutes } from "./routes/ai.js";
import { voiceTemplateRoutes } from "./routes/voice-templates.js";
import { messageTemplateRoutes } from "./routes/message-templates.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { incomingRoutes } from "./routes/incoming.js";
import { autoReplyRoutes } from "./routes/auto-reply.js";
import { metricsRoutes } from "./routes/metrics.js";
import { messageRoutes } from "./routes/messages.js";
import { platformRoutes } from "./routes/platform.js";
import { accountRoutes } from "./routes/account.js";
import { brandingRoutes, publicBrandingRoutes } from "./routes/branding.js";
import { publicRoutes } from "./routes/public.js";
import { publicVisitRoutes, visitRoutes } from "./routes/visits.js";
import { registerAuth } from "./plugins/auth.js";
import { registerWs } from "./ws.js";
import { AppError } from "@wacalls/shared";
import { ZodError } from "zod";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "password", "token"],
    },
    trustProxy: true,
  });

  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      const text = typeof body === "string" ? body.trim() : "";
      done(null, text ? JSON.parse(text) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowed = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
      if (!origin || allowed.includes("*") || allowed.includes(origin)) {
        cb(null, true);
        return;
      }
      // Third-party JS SDK / website widgets call the API from other origins.
      cb(null, true);
    },
    credentials: true,
    allowedHeaders: ["content-type", "authorization", "x-api-key", "x-wacalls-signature", "x-wacalls-event"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(websocket);

  await registerAuth(app);
  await registerWs(app);

  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(publicRoutes, { prefix: "/api/v1" });
  await app.register(publicBrandingRoutes, { prefix: "/api/v1" });
  await app.register(publicVisitRoutes, { prefix: "/api/v1" });
  await app.register(visitRoutes, { prefix: "/api/v1" });
  await app.register(dashboardRoutes, { prefix: "/api/v1" });
  await app.register(accountRoutes, { prefix: "/api/v1" });
  await app.register(brandingRoutes, { prefix: "/api/v1" });
  await app.register(messageRoutes, { prefix: "/api/v1" });
  await app.register(platformRoutes, { prefix: "/api/v1" });
  await app.register(channelRoutes, { prefix: "/api/v1" });
  await app.register(callRoutes, { prefix: "/api/v1" });
  await app.register(contactRoutes, { prefix: "/api/v1" });
  await app.register(campaignRoutes, { prefix: "/api/v1" });
  await app.register(userRoutes, { prefix: "/api/v1" });
  await app.register(recordingRoutes, { prefix: "/api/v1" });
  await app.register(webhookRoutes, { prefix: "/api/v1" });
  await app.register(keyRoutes, { prefix: "/api/v1" });
  await app.register(settingsRoutes, { prefix: "/api/v1" });
  await app.register(analyticsRoutes, { prefix: "/api/v1" });
  await app.register(aiRoutes, { prefix: "/api/v1" });
  await app.register(voiceTemplateRoutes, { prefix: "/api/v1" });
  await app.register(messageTemplateRoutes, { prefix: "/api/v1" });
  await app.register(knowledgeRoutes, { prefix: "/api/v1" });
  await app.register(incomingRoutes, { prefix: "/api/v1" });
  await app.register(autoReplyRoutes, { prefix: "/api/v1" });
  await app.register(widgetRoutes);

  app.setErrorHandler((err, req, reply) => {
    const e = err as AppError;
    if (err instanceof AppError || e.name === "AppError") {
      return reply.status(e.statusCode).send({
        success: false,
        error: { code: e.code, message: e.message, details: e.details },
      });
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => i.message).join("; ") || "Invalid request";
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION", message },
      });
    }
    req.log.error({ err }, "unhandled");
    const message = err instanceof Error && err.message ? err.message : "Internal server error";
    return reply.status(500).send({
      success: false,
      error: { code: "INTERNAL", message },
    });
  });

  return app;
}
