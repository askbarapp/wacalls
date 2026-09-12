export const CHAT_KEYWORD_ACTIONS = ["reply", "handoff", "opt_out"] as const;
export type ChatKeywordAction = (typeof CHAT_KEYWORD_ACTIONS)[number];

export const CHAT_MATCH_TYPES = ["exact", "contains"] as const;
export type ChatMatchType = (typeof CHAT_MATCH_TYPES)[number];

export type ChatKeywordLike = {
  id?: string;
  trigger: string;
  matchType?: string | null;
  action?: string | null;
  enabled?: boolean | null;
  sortOrder?: number | null;
  reply?: string | null;
};

export const DEFAULT_CHAT_KEYWORDS: Array<{
  trigger: string;
  matchType: ChatMatchType;
  action: ChatKeywordAction;
  reply: string;
  sortOrder: number;
}> = [
  {
    trigger: "STOP",
    matchType: "exact",
    action: "opt_out",
    reply: "You are unsubscribed from WhatsApp replies. Send START to opt in again.",
    sortOrder: 0,
  },
  {
    trigger: "EXIT",
    matchType: "exact",
    action: "opt_out",
    reply: "You are unsubscribed from WhatsApp replies. Send START to opt in again.",
    sortOrder: 1,
  },
  {
    trigger: "AGENT",
    matchType: "exact",
    action: "handoff",
    reply: "Connecting you with a teammate. You can keep messaging here.",
    sortOrder: 10,
  },
  {
    trigger: "HUMAN",
    matchType: "exact",
    action: "handoff",
    reply: "Connecting you with a teammate. You can keep messaging here.",
    sortOrder: 11,
  },
  {
    trigger: "HI",
    matchType: "exact",
    action: "reply",
    reply: "Hi! Reply PRICE, DEMO, or SUPPORT. Send AGENT to talk to a person, or STOP to unsubscribe.",
    sortOrder: 20,
  },
  {
    trigger: "HELLO",
    matchType: "exact",
    action: "reply",
    reply: "Hello! Reply PRICE, DEMO, or SUPPORT. Send AGENT to talk to a person, or STOP to unsubscribe.",
    sortOrder: 21,
  },
  {
    trigger: "START",
    matchType: "exact",
    action: "reply",
    reply: "Welcome back. Reply PRICE, DEMO, or SUPPORT. Send AGENT for a teammate, or STOP to unsubscribe.",
    sortOrder: 22,
  },
  {
    trigger: "MENU",
    matchType: "exact",
    action: "reply",
    reply: "Menu: PRICE, DEMO, SUPPORT, AGENT. Send STOP to unsubscribe.",
    sortOrder: 23,
  },
  {
    trigger: "PRICE",
    matchType: "contains",
    action: "reply",
    reply: "Pricing depends on your plan. Tell us what you need, or send AGENT and a teammate will share details.",
    sortOrder: 30,
  },
  {
    trigger: "DEMO",
    matchType: "contains",
    action: "reply",
    reply: "We can arrange a demo. Share a good time, or send AGENT to book it with a teammate.",
    sortOrder: 31,
  },
  {
    trigger: "SUPPORT",
    matchType: "contains",
    action: "reply",
    reply: "Tell us what you need help with. Send AGENT if you want a person to take over.",
    sortOrder: 32,
  },
];

export function normalizeChatText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function isStopCommand(text: string): boolean {
  const n = normalizeChatText(text);
  return n === "STOP" || n === "EXIT" || n === "UNSUBSCRIBE" || n === "STOP ALL";
}

export function isHandoffCommand(text: string): boolean {
  const n = normalizeChatText(text);
  return n === "AGENT" || n === "HUMAN" || n === "OPERATOR";
}

export function isStartCommand(text: string): boolean {
  const n = normalizeChatText(text);
  return n === "HI" || n === "HELLO" || n === "HEY" || n === "START" || n === "MENU";
}

export function isGreetingText(text: string): boolean {
  const n = normalizeChatText(text);
  return (
    n === "HI" ||
    n === "HELLO" ||
    n === "HEY" ||
    n === "HEYY" ||
    n === "HEYYY" ||
    n === "NAMASTE" ||
    n === "NAMASKAR" ||
    n === "PRANAM" ||
    n === "HII" ||
    n === "HIII" ||
    n === "HOLA" ||
    n === "GREETINGS"
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchChatKeyword<T extends ChatKeywordLike>(text: string, keywords: T[]): T | null {
  const n = normalizeChatText(text);
  if (!n) return null;
  const enabled = keywords
    .filter((k) => k.enabled !== false)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.trigger.localeCompare(b.trigger));
  for (const k of enabled) {
    const trigger = normalizeChatText(k.trigger);
    if (!trigger) continue;
    const mode = (k.matchType || "exact").toLowerCase();
    if (mode === "contains") {
      const re = new RegExp(`(?:^|\\s)${escapeRegExp(trigger)}(?:\\s|$)`);
      if (re.test(n)) return k;
    } else if (n === trigger) {
      return k;
    }
  }
  return null;
}
