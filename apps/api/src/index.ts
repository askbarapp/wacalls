import { buildApp } from "./app.js";
import { env } from "./env.js";
import { prisma } from "@wacalls/database";
import { redis } from "./redis.js";
import { startEventBridge } from "./services/events.js";

const app = await buildApp();

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await startEventBridge();
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
