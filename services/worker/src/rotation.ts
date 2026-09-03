export type RotatableChannel = {
  id: string;
  status: string;
  provider?: string | null;
  displayName?: string | null;
};

export function rotationPool<T extends RotatableChannel>(channels: T[], rotationLimit: number): T[] {
  const unique: T[] = [];
  const seen = new Set<string>();
  for (const channel of channels) {
    if (seen.has(channel.id)) continue;
    seen.add(channel.id);
    unique.push(channel);
  }
  const n = rotationLimit > 0 ? Math.min(rotationLimit, unique.length) : unique.length;
  return unique.slice(0, n);
}

export function pickRotatedChannel<T extends RotatableChannel>(
  pool: T[],
  cursor: number,
  busyIds: Set<string>,
  opts?: { voice?: boolean },
): T | null {
  if (!pool.length) return null;
  const len = pool.length;
  const start = ((cursor % len) + len) % len;
  for (let i = 0; i < len; i += 1) {
    const channel = pool[(start + i) % len];
    if (!channel) continue;
    if (channel.status !== "CONNECTED") continue;
    if (opts?.voice && channel.provider === "CLOUD") continue;
    if (busyIds.has(channel.id)) continue;
    return channel;
  }
  return null;
}
