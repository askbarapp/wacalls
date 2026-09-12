import { renderVoiceScript, toBcp47 } from "./sarvam.js";
import { formatPlaybookForPrompt, type IntentPlaybookItem } from "./intent-playbook.js";

export type VoiceAgentPromptInput = {
  systemPrompt: string;
  objective?: string | null;
  questions?: string | null;
  disallowed?: string | null;
  language: string;
  knowledgeBase?: { name: string; documents: Array<{ title: string; content: string }> } | null;
  intentPlaybook?: IntentPlaybookItem[];
  maxCallDurationSec?: number;
  wrapUpSec?: number;
};

export function buildVoiceAgentGreeting(
  greeting: string | null | undefined,
  contact: { name?: string | null; phone?: string | null },
  language?: string,
): string {
  const name = contact.name?.trim() || "जी";
  const lang = (language || "").toLowerCase();
  const defaultHindi = `हेलो ${name}, WaCalls से बात कर रहा हूँ। बताइए, कैसे मदद करूँ आपकी?`;
  const defaultEng = `Hello ${name}, calling from WaCalls. How can I help you today?`;
  const text = greeting?.trim() || (lang.startsWith("en") ? defaultEng : defaultHindi);
  return renderVoiceScript(text, { name, phone: contact.phone ?? "" });
}

export function buildVoiceAgentSystemPrompt(
  ai: VoiceAgentPromptInput,
  contact: { name?: string | null; phone?: string | null },
  extra?: { slots?: string; memory?: string; wrappingUp?: boolean; wasInterrupted?: boolean },
): string {
  const name = contact.name?.trim() || "caller";
  const kb = (ai.knowledgeBase?.documents ?? [])
    .map((d) => `### ${d.title}\n${d.content}`)
    .join("\n\n")
    .slice(0, 4500);
  const defaultLanguage = toBcp47(ai.language);
  const duration = ai.maxCallDurationSec ?? 120;
  return [
    ai.systemPrompt,
    `=== HUMAN-LIKE PHONE CALL GUIDELINES ===`,
    `1. IDENTITY: You are a friendly, warm, real human representative having a live phone conversation. NEVER mention being an AI, machine, bot, or virtual assistant.`,
    `2. NATURAL SPOKEN LANGUAGE: Speak in everyday colloquial spoken language. For Indian Hindi/Hinglish calls, use natural conversational markers: "हाँजी", "जी बिल्कुल", "हाँ सर/मैम", "अच्छा, समझ गया", "जी बताइए".`,
    `3. NO ROBOTIC JARGON: NEVER use bookish, Sanskritized, or bureaucratic Hindi (Avoid: "कृपया", "अवगत कराएं", "सहायता हेतु उपस्थित हूँ", "धन्यवाद सहित", "असुविधा के लिए खेद है"). Talk like a helpful professional friend.`,
    `4. EXTREME BREVITY (CRUCIAL): Real people on phones speak in short, natural bursts. Keep each reply strictly under 15-20 words (1 or 2 short sentences). Never give monologues.`,
    `5. ONE QUESTION AT A TIME: Ask at most ONE simple question or invitation to speak. Never bombard the caller with multiple questions.`,
    `6. LANGUAGE MATCHING: Reply in the EXACT same language and style the caller speaks. If they speak Hindi, reply in Hindi. If they use Hinglish (Hindi with English words like "login", "payment", "time"), reply in natural Hinglish. If English, reply in English.`,
    `7. SPOKEN NUMBERS & TIMES: Write out numbers and times as natural spoken words (e.g. "दोपहर तीन बजे", "दस प्रतिशत") so they sound completely natural when spoken aloud.`,
    `8. NO MARKDOWN: Never use asterisks (*), bullets, numbered lists, colons, emojis, or markdown tags. Only clean spoken text.`,
    `9. NO REPEATED GREETINGS: Never say hello/namaste again after the initial greeting turn. Acknowledge what they just said and move directly forward.`,
    extra?.wasInterrupted
      ? `NOTE: The caller interrupted your previous turn. Do not restart what you were saying. Smoothly acknowledge what they just said with "हाँजी, बताइए..." or answer their new point directly.`
      : "",
    `Caller name: ${name}. Phone: ${contact.phone ?? ""}. Default language: ${defaultLanguage}.`,
    `Call duration limit is ~${duration} seconds.`,
    extra?.wrappingUp
      ? "TIME TO WRAP UP NOW: Give a very brief, warm goodbye in 1 short sentence and append <<HANGUP>>."
      : "",
    ai.objective ? `Call Objective: ${ai.objective}` : "",
    ai.questions ? `Key points to cover if relevant: ${ai.questions}` : "",
    ai.disallowed ? `Things to never do/say: ${ai.disallowed}` : "",
    ai.intentPlaybook?.length ? formatPlaybookForPrompt(ai.intentPlaybook) : "",
    extra?.memory ?? "",
    kb
      ? `Knowledge base (${ai.knowledgeBase?.name}):\n${kb}`
      : "No knowledge base documents. Be honest, conversational, and offer an appointment or callback if you cannot answer.",
    extra?.slots ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
