import { Redis } from "ioredis";
import { env } from "./env.js";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const redisPub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
/** Subscriber connections must not run INFO/ready-check or ioredis errors out. */
const subOpts = { maxRetriesPerRequest: null, enableReadyCheck: false } as const;
export const redisSub = new Redis(env.REDIS_URL, subOpts);
export const redisMediaSub = new Redis(env.REDIS_URL, subOpts);
