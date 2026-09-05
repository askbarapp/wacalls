export type IntentAction = "continue" | "hangup";

export type IntentPlaybookItem = {
  intent: string;
  /** Comma / newline separated cues the caller might say */
  examples: string;
  reply: string;
  action: IntentAction;
};

export const DEFAULT_MAX_CALL_DURATION_SEC = 120;
export const DEFAULT_WRAP_UP_SEC = 25;

export const DEFAULT_INTENT_PLAYBOOK: IntentPlaybookItem[] = [
  {
    intent: "hangup_request",
    examples:
      "cut the call, hang up, phone cut, call band karo, band kar do, cut karo, baad mein, busy hun, mat call karo, stop calling, don't call, abhi nahi, not now, leave me alone, phone rakh, rakh do, disconnect",
    reply: "Theek hai, dhanyavaad. Aapse phir baat karenge. Alvida.",
    action: "hangup",
  },
  {
    intent: "refuse_style",
    examples:
      "aisi baat mat karo, is tarah mat bolo, don't talk like this, galat baat, rude, unwanted call, spam, pareshan mat karo, bakwas mat karo",
    reply: "Maafi chahta hoon. Main aapko disturb nahi karunga. Dhanyavaad, alvida.",
    action: "hangup",
  },
  {
    intent: "not_interested",
    examples: "not interested, nahi chahiye, interested nahi, no thanks, mat batao, skip, bilkul nahi, need nahi",
    reply: "Samajh gaya. Dhanyavaad aapka time dene ke liye. Alvida.",
    action: "hangup",
  },
  {
    intent: "price",
    examples: "price, cost, kitna, fees, charge, mahanga, rate, pricing, kitne paise, kitni fees",
    reply: "Pricing aapke plan pe depend karti hai — main short mein bataata hoon, ya detail bhej doon?",
    action: "continue",
  },
  {
    intent: "callback",
    examples: "callback, later, baad mein call, call back, phir se call, evening mein, kal call, thodi der baad",
    reply: "Zaroor — kab call karun, aap bataiye?",
    action: "continue",
  },
];

/** Normalize spoken text for matching (Hinglish-friendly). */
export function normalizeForIntentMatch(raw: string): string {
  let text = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const replacements: Array<[RegExp, string]> = [
    [/\bphone\s+cut\b/g, "hang up"],
    [/\bcut\s+(the\s+)?(call|phone)\b/g, "hang up"],
    [/\b(call|phone)\s+band\s+kar(o|do)?\b/g, "hang up"],
    [/\bband\s+kar(o|do)?\b/g, "hang up"],
    [/\bcut\s+kar(o|do)?\b/g, "hang up"],
    [/\brakh\s+(do|lo|de)\b/g, "hang up"],
    [/\bphone\s+rakh\b/g, "hang up"],
    [/\bmat\s+call\s+kar(o|na)?\b/g, "stop calling"],
    [/\bnahi\s+chahiye\b/g, "not interested"],
    [/\binterested\s+nahi\b/g, "not interested"],
    [/\bpareshan\s+mat\s+kar(o|na)?\b/g, "spam"],
    [/\bbad\s+mein\b/g, "baad mein"],
    [/\bphir\s+se\s+call\b/g, "callback"],
    [/\bcall\s+back\b/g, "callback"],
    [/\bkitne\s+(paise|rupees|rs)\b/g, "price"],
    [/\bkitni\s+fees\b/g, "price"],
  ];
  for (const [re, to] of replacements) text = text.replace(re, to);
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeIntentPlaybook(value: unknown): IntentPlaybookItem[] {
  if (!Array.isArray(value) || value.length === 0) return [...DEFAULT_INTENT_PLAYBOOK];
  const items: IntentPlaybookItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const intent = String(row.intent || "").trim().toLowerCase().replace(/\s+/g, "_");
    const reply = String(row.reply || "").trim();
    if (!intent || !reply) continue;
    const action: IntentAction = row.action === "hangup" ? "hangup" : "continue";
    items.push({
      intent,
      examples: String(row.examples || "").trim(),
      reply,
      action,
    });
  }
  const hasHangup = items.some((i) => i.action === "hangup");
  if (!hasHangup) {
    items.unshift(...DEFAULT_INTENT_PLAYBOOK.filter((i) => i.action === "hangup"));
  }
  return items.length ? items : [...DEFAULT_INTENT_PLAYBOOK];
}

function cueList(examples: string): string[] {
  return examples
    .split(/[\n,|]/)
    .map((s) => normalizeForIntentMatch(s))
    .filter((s) => s.length >= 2);
}

function tokenSet(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((t) => t.length >= 2));
}

function tokenOverlapScore(textTokens: Set<string>, cue: string): number {
  const cueTokens = [...tokenSet(cue)];
  if (!cueTokens.length) return 0;
  let hit = 0;
  for (const t of cueTokens) if (textTokens.has(t)) hit += 1;
  const ratio = hit / cueTokens.length;
  if (ratio < 0.6) return 0;
  return Math.round(ratio * Math.min(cue.length, 16));
}

export function matchIntentPlaybook(
  utterance: string,
  playbook: IntentPlaybookItem[],
): IntentPlaybookItem | null {
  const text = normalizeForIntentMatch(utterance);
  if (!text) return null;
  const tokens = tokenSet(text);
  let best: { item: IntentPlaybookItem; score: number } | null = null;
  for (const item of playbook) {
    let score = 0;
    const intentLabel = normalizeForIntentMatch(item.intent.replace(/_/g, " "));
    if (intentLabel && text.includes(intentLabel)) score += 5;
    for (const cue of cueList(item.examples)) {
      if (text.includes(cue)) score += Math.min(cue.length, 20);
      else score += tokenOverlapScore(tokens, cue);
    }
    // Prefer hangup intents slightly when tied — safer early exit.
    if (item.action === "hangup" && score > 0) score += 0.5;
    if (score > 0 && (!best || score > best.score)) best = { item, score };
  }
  return best && best.score >= 2.5 ? best.item : null;
}

export function isHangupUtterance(utterance: string, playbook?: IntentPlaybookItem[]): boolean {
  const matched = matchIntentPlaybook(utterance, playbook ?? DEFAULT_INTENT_PLAYBOOK);
  return matched?.action === "hangup";
}

export function parseHangupTag(reply: string): { spoken: string; hangup: boolean } {
  const hangup = /<<\s*HANGUP\s*>>/i.test(reply);
  const spoken = reply.replace(/<<\s*HANGUP\s*>>/gi, "").replace(/\s+\n/g, "\n").trim();
  return { spoken, hangup };
}

export function formatPlaybookForPrompt(playbook: IntentPlaybookItem[]): string {
  if (!playbook.length) return "";
  return [
    "Intent playbook — if the caller's meaning matches an intent, follow that reply style closely:",
    ...playbook.map(
      (item, i) =>
        `${i + 1}. Intent "${item.intent}" (cues: ${item.examples || item.intent}). Reply like: "${item.reply}". Action: ${item.action}.`,
    ),
    'If they clearly want to end / refuse the call, thank them briefly and end your message with <<HANGUP>> on a new line (never speak the tag).',
  ].join("\n");
}

export function defaultHangupReply(languageHint?: string): string {
  const hi = !languageHint || /hi|hin|hinglish/i.test(languageHint);
  return hi
    ? "Dhanyavaad aapka time dene ke liye. Alvida."
    : "Thank you for your time. Goodbye.";
}

export function defaultWrapUpReply(languageHint?: string): string {
  const hi = !languageHint || /hi|hin|hinglish/i.test(languageHint);
  return hi
    ? "Main jaldi wrap-up kar raha hoon — koi last sawal hai kya?"
    : "I need to wrap up shortly — any last question?";
}
