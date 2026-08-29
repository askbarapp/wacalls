import type { FastifyPluginAsync } from "fastify";
import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const activeCalls = new client.Gauge({
  name: "wacalls_active_calls",
  help: "Active calls",
  registers: [register],
});
export const queuedCalls = new client.Gauge({
  name: "wacalls_queued_calls",
  help: "Queued calls",
  registers: [register],
});
export const completedCalls = new client.Counter({
  name: "wacalls_completed_calls",
  help: "Completed calls",
  registers: [register],
});
export const failedCalls = new client.Counter({
  name: "wacalls_failed_calls",
  help: "Failed calls",
  registers: [register],
});
export const callDuration = new client.Histogram({
  name: "wacalls_call_duration_ms",
  help: "Call duration",
  buckets: [1000, 5000, 15000, 30000, 60000, 180000],
  registers: [register],
});
export const queueWait = new client.Histogram({
  name: "wacalls_queue_wait_ms",
  help: "Queue wait time",
  buckets: [100, 500, 2000, 10000, 30000],
  registers: [register],
});
export const waStatus = new client.Gauge({
  name: "wacalls_whatsapp_connection_status",
  help: "1 connected 0 otherwise",
  labelNames: ["channel_id"],
  registers: [register],
});

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", register.contentType);
    return register.metrics();
  });
};
