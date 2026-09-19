import pino from "pino";
import { redis } from "../redis.js";

const log = pino({ name: "member-permissions", level: process.env.LOG_LEVEL ?? "info" });

export interface MemberPermissions {
  canMakeCalls: boolean;
  canGenerateImages: boolean;
  dailyImageQuota: number;
  canViewFinance: boolean;
  canManageCampaigns: boolean;
  canAssignTasks: boolean;
}

/**
 * Default permissions by role (Enterprise Best Practices).
 * Outbound calls and AI Image Gen are LOCKED by default for regular staff.
 */
export function getDefaultPermissionsForRole(role: string): MemberPermissions {
  const r = (role || "EXECUTIVE").toUpperCase();

  switch (r) {
    case "OWNER":
      return {
        canMakeCalls: true,
        canGenerateImages: true,
        dailyImageQuota: 999, // Unlimited
        canViewFinance: true,
        canManageCampaigns: true,
        canAssignTasks: true,
      };

    case "MANAGER":
    case "SUPERVISOR":
      return {
        canMakeCalls: false, // Must be explicitly enabled by Owner!
        canGenerateImages: true,
        dailyImageQuota: 10,
        canViewFinance: false,
        canManageCampaigns: true,
        canAssignTasks: true,
      };

    case "SALES_MANAGER":
      return {
        canMakeCalls: false, // Must be explicitly enabled by Owner!
        canGenerateImages: true,
        dailyImageQuota: 10,
        canViewFinance: false,
        canManageCampaigns: true,
        canAssignTasks: true,
      };

    case "MARKETING":
      return {
        canMakeCalls: false,
        canGenerateImages: true,
        dailyImageQuota: 20,
        canViewFinance: false,
        canManageCampaigns: true,
        canAssignTasks: false,
      };

    case "ACCOUNTS":
      return {
        canMakeCalls: false,
        canGenerateImages: false,
        dailyImageQuota: 0,
        canViewFinance: true,
        canManageCampaigns: false,
        canAssignTasks: false,
      };

    case "SUPPORT":
    case "EXECUTIVE":
    default:
      return {
        canMakeCalls: false, // Strictly locked
        canGenerateImages: false, // Strictly locked
        dailyImageQuota: 0,
        canViewFinance: false, // Strictly locked
        canManageCampaigns: false, // Strictly locked
        canAssignTasks: false, // Can only complete their own tasks
      };
  }
}

/**
 * Retrieves resolved permissions for a specific Commander Member.
 * Combines role defaults with any custom overrides set by the Owner in the dashboard.
 */
export async function getMemberPermissions(
  channelId: string,
  memberId?: string | null,
  role: string = "EXECUTIVE",
): Promise<MemberPermissions> {
  const defaults = getDefaultPermissionsForRole(role);
  if (!memberId || role.toUpperCase() === "OWNER") {
    return defaults;
  }

  try {
    const key = `wacall:commander:permissions:${channelId}:${memberId}`;
    const raw = await redis.get(key);
    if (!raw) return defaults;

    const overrides = JSON.parse(raw);
    return {
      ...defaults,
      ...(overrides.canMakeCalls !== undefined ? { canMakeCalls: Boolean(overrides.canMakeCalls) } : {}),
      ...(overrides.canGenerateImages !== undefined ? { canGenerateImages: Boolean(overrides.canGenerateImages) } : {}),
      ...(overrides.dailyImageQuota !== undefined ? { dailyImageQuota: Number(overrides.dailyImageQuota) } : {}),
      ...(overrides.canViewFinance !== undefined ? { canViewFinance: Boolean(overrides.canViewFinance) } : {}),
      ...(overrides.canManageCampaigns !== undefined ? { canManageCampaigns: Boolean(overrides.canManageCampaigns) } : {}),
      ...(overrides.canAssignTasks !== undefined ? { canAssignTasks: Boolean(overrides.canAssignTasks) } : {}),
    };
  } catch (err: any) {
    log.warn({ err: err?.message, memberId }, "Failed to load member permissions override from Redis");
    return defaults;
  }
}

/**
 * Saves custom permission overrides for a specific Commander Member.
 */
export async function setMemberPermissions(
  channelId: string,
  memberId: string,
  overrides: Partial<MemberPermissions>,
): Promise<void> {
  try {
    const key = `wacall:commander:permissions:${channelId}:${memberId}`;
    await redis.set(key, JSON.stringify(overrides));
    log.info({ memberId, overrides }, "Saved member permissions overrides");
  } catch (err: any) {
    log.error({ err: err?.message, memberId }, "Failed to save member permissions");
    throw err;
  }
}

/**
 * Checks and increments the daily AI image generation quota for a team member.
 * Resets automatically every midnight in IST.
 */
export async function checkAndConsumeImageQuota(
  memberId: string,
  quotaLimit: number,
): Promise<{ allowed: boolean; remaining: number; countToday: number }> {
  if (quotaLimit <= 0) {
    return { allowed: false, remaining: 0, countToday: 0 };
  }
  if (quotaLimit >= 999) {
    return { allowed: true, remaining: 999, countToday: 0 }; // Unlimited for Owner
  }

  try {
    const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
    const istDate = new Date(Date.now() + istOffsetMs).toISOString().slice(0, 10);
    const key = `wacall:quota:image:${memberId}:${istDate}`;

    const currentCount = await redis.incr(key);
    if (currentCount === 1) {
      await redis.expire(key, 28 * 3600); // Expiry safely past midnight
    }

    if (currentCount > quotaLimit) {
      return { allowed: false, remaining: 0, countToday: currentCount };
    }

    return {
      allowed: true,
      remaining: Math.max(0, quotaLimit - currentCount),
      countToday: currentCount,
    };
  } catch (err: any) {
    log.warn({ err: err?.message, memberId }, "Quota check error, allowing by default");
    return { allowed: true, remaining: quotaLimit, countToday: 1 };
  }
}
