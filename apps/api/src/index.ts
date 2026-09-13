import { buildApp } from "./app.js";
import { env } from "./env.js";
import { prisma } from "@wacalls/database";
import { redis } from "./redis.js";
import { startEventBridge } from "./services/events.js";
import { processCadenceTick } from "./services/followup-cadence.js";
import { processDuePaymentReminders } from "./services/invoice-service.js";
import { processDailyBriefingTick } from "./services/daily-briefing.js";

const app = await buildApp();

const shutdown = async () => {
  clearInterval(cadenceInterval);
  clearInterval(reminderInterval);
  clearInterval(briefingInterval);
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await startEventBridge();

// Background Tickers for Follow-up Cadence (+4h, +24h, +3d AI Call) and Payment Reminders
const cadenceInterval = setInterval(() => {
  void processCadenceTick().catch(() => undefined);
}, 60 * 1000);

const reminderInterval = setInterval(() => {
  void processDuePaymentReminders().catch(() => undefined);
}, 10 * 60 * 1000);

const briefingInterval = setInterval(() => {
  void processDailyBriefingTick().catch(() => undefined);
}, 60 * 1000);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
