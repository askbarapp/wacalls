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
import { metricsRoutes } from "./routes/metrics.js";
import { registerAuth } from "./plugins/auth.js";
import { registerWs } from "./ws.js";
import { AppError } from "@wacalls/shared";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "password", "token"],
    },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
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
  await app.register(dashboardRoutes, { prefix: "/api/v1" });
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
  await app.register(widgetRoutes);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({
        success: false,
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    req.log.error({ err }, "unhandled");
    return reply.status(500).send({
      success: false,
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  });

  return app;
}
