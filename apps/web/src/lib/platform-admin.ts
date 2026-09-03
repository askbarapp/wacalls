export type PlatformPlan = {
  id: string;
  name: string;
  slug: string;
  description: string;
  maxChannels: number;
  maxAgents: number;
  maxKnowledgeBases?: number;
  maxAiAgents?: number;
  maxMessagesPerDay: number;
  maxCallsPerDay: number;
  allowCloudApi: boolean;
  allowSdk: boolean;
  priceMonthly: number;
  isPublic: boolean;
  isDefault: boolean;
};

export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planId?: string | null;
  billingEmail?: string | null;
  plan?: { id?: string; name: string; slug: string; priceMonthly?: number } | null;
  _count?: { users: number; channels: number; calls: number };
};

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  memberships: Array<{
    role: string;
    organization: {
      name: string;
      slug: string;
      status?: string;
      billingEmail?: string | null;
      plan?: { id: string; name: string; slug: string; priceMonthly: number } | null;
    };
  }>;
};

export type PlatformOverview = {
  users: number;
  organizations: number;
  plans: number;
  byPlan: Array<{ name: string; organizations: number; users: number }>;
  byStatus: { TRIAL: number; ACTIVE: number; SUSPENDED: number };
};

export function formatPlanPrice(paise: number) {
  return paise === 0 ? "Free" : `₹${(paise / 100).toFixed(0)}/mo`;
}
