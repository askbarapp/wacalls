import { Queue } from "bullmq";
import { QUEUE_NAMES, type PlaceCallJob } from "@wacalls/queue";
import { env } from "./env.js";

export const callQueue = new Queue<PlaceCallJob>(QUEUE_NAMES.calls, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 200,
  },
});

export const campaignQueue = new Queue(QUEUE_NAMES.campaigns, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
});

export const webhookQueue = new Queue(QUEUE_NAMES.webhooks, {
  connection: { url: env.REDIS_URL },
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: "exponential", delay: 4000 },
    removeOnComplete: 200,
  },
});

export const retryQueue = new Queue(QUEUE_NAMES.retries, {
  connection: { url: env.REDIS_URL },
});
