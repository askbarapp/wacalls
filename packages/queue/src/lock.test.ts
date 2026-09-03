import { describe, expect, it } from "vitest";
import { ChannelLock, ChannelWaitQueue, channelLockIsStale } from "./index.js";

class MemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  private lists = new Map<string, string[]>();

  async set(key: string, value: string, _px: string, ttl: number, nx: string) {
    const now = Date.now();
    const current = this.store.get(key);
    if (nx === "NX" && current && current.expiresAt > now) return null;
    this.store.set(key, { value, expiresAt: now + ttl });
    return "OK";
  }

  async get(key: string) {
    const row = this.store.get(key);
    if (!row || row.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }

  async eval(script: string, _n: number, key: string, owner: string, ttl?: string) {
    if (script.includes("pexpire")) {
      const row = this.store.get(key);
      if (row?.value === owner) {
        row.expiresAt = Date.now() + Number(ttl);
        return 1;
      }
      return 0;
    }
    const row = this.store.get(key);
    if (row?.value === owner) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }

  async rpush(key: string, value: string) {
    const list = this.lists.get(key) ?? [];
    list.push(value);
    this.lists.set(key, list);
    return list.length;
  }

  async lpop(key: string) {
    const list = this.lists.get(key) ?? [];
    const v = list.shift() ?? null;
    this.lists.set(key, list);
    return v;
  }

  async lrem(key: string, _count: number, value: string) {
    const list = (this.lists.get(key) ?? []).filter((x) => x !== value);
    this.lists.set(key, list);
    return 1;
  }

  async lrange(key: string) {
    return this.lists.get(key) ?? [];
  }

  async llen(key: string) {
    return (this.lists.get(key) ?? []).length;
  }
}

describe("channel lock", () => {
  it("allows only one owner", async () => {
    const redis = new MemoryRedis() as any;
    const lock = new ChannelLock(redis, 5000);
    expect(await lock.acquire("ch1", "agent1")).toBe(true);
    expect(await lock.acquire("ch1", "agent2")).toBe(false);
    expect(await lock.release("ch1", "agent2")).toBe(false);
    expect(await lock.release("ch1", "agent1")).toBe(true);
    expect(await lock.acquire("ch1", "agent2")).toBe(true);
  });
});

describe("four agents one channel", () => {
  it("queues three callers while one is active", async () => {
    const redis = new MemoryRedis() as any;
    const lock = new ChannelLock(redis, 30_000);
    const queue = new ChannelWaitQueue(redis);

    expect(await lock.acquire("wa1", "call-1")).toBe(true);
    const positions = [];
    for (const id of ["call-2", "call-3", "call-4"]) {
      expect(await lock.acquire("wa1", id)).toBe(false);
      positions.push(await queue.enqueue("wa1", id));
    }
    expect(positions).toEqual([1, 2, 3]);

    await lock.release("wa1", "call-1");
    const next = await queue.dequeue("wa1");
    expect(next).toBe("call-2");
    expect(await lock.acquire("wa1", next!)).toBe(true);
    expect(await queue.snapshot("wa1")).toEqual(["call-3", "call-4"]);
  });
});

describe("channelLockIsStale", () => {
  it("treats missing and terminal owners as stale", () => {
    expect(channelLockIsStale(null)).toBe(true);
    expect(channelLockIsStale({ status: "ENDED" })).toBe(true);
    expect(channelLockIsStale({ status: "FAILED" })).toBe(true);
  });

  it("steals a leftover RINGING lock after 35s", () => {
    const fresh = { status: "RINGING", startedAt: new Date(), createdAt: new Date() };
    const old = { status: "RINGING", startedAt: new Date(Date.now() - 40_000), createdAt: new Date() };
    expect(channelLockIsStale(fresh)).toBe(false);
    expect(channelLockIsStale(old)).toBe(true);
  });
});
