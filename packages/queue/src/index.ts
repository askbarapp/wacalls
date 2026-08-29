import { Redis } from "ioredis";

const RELEASE = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const RENEW = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export function channelLockKey(channelId: string): string {
  return `lock:whatsapp-channel:${channelId}`;
}

export function channelQueueKey(channelId: string): string {
  return `queue:whatsapp-channel:${channelId}`;
}

export class ChannelLock {
  constructor(
    private readonly redis: Redis,
    private readonly ttlMs = 120_000,
  ) {}

  async acquire(channelId: string, owner: string, ttlMs = this.ttlMs): Promise<boolean> {
    const result = await this.redis.set(channelLockKey(channelId), owner, "PX", ttlMs, "NX");
    return result === "OK";
  }

  async release(channelId: string, owner: string): Promise<boolean> {
    const result = await this.redis.eval(RELEASE, 1, channelLockKey(channelId), owner);
    return Number(result) === 1;
  }

  async renew(channelId: string, owner: string, ttlMs = this.ttlMs): Promise<boolean> {
    const result = await this.redis.eval(RENEW, 1, channelLockKey(channelId), owner, String(ttlMs));
    return Number(result) === 1;
  }

  async owner(channelId: string): Promise<string | null> {
    return this.redis.get(channelLockKey(channelId));
  }
}

export class ChannelWaitQueue {
  constructor(private readonly redis: Redis) {}

  async enqueue(channelId: string, callId: string): Promise<number> {
    await this.redis.rpush(channelQueueKey(channelId), callId);
    return this.position(channelId, callId);
  }

  async dequeue(channelId: string): Promise<string | null> {
    return this.redis.lpop(channelQueueKey(channelId));
  }

  async remove(channelId: string, callId: string): Promise<void> {
    await this.redis.lrem(channelQueueKey(channelId), 0, callId);
  }

  async position(channelId: string, callId: string): Promise<number> {
    const list = await this.redis.lrange(channelQueueKey(channelId), 0, -1);
    return list.indexOf(callId) + 1;
  }

  async snapshot(channelId: string): Promise<string[]> {
    return this.redis.lrange(channelQueueKey(channelId), 0, -1);
  }

  async length(channelId: string): Promise<number> {
    return this.redis.llen(channelQueueKey(channelId));
  }
}

export const QUEUE_NAMES = {
  calls: "wacalls-calls",
  campaigns: "wacalls-campaigns",
  webhooks: "wacalls-webhooks",
  retries: "wacalls-retries",
} as const;

export type PlaceCallJob = {
  callId: string;
  organizationId: string;
  channelId: string;
  phone: string;
  contactName?: string | null;
  campaignId?: string | null;
  recordingPath?: string | null;
};
