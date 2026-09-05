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
): string {
  const name = contact.name?.trim() || "there";
  const text =
    greeting?.trim() || `Hello ${name}, thanks for taking our call. How can I help you today?`;
  return renderVoiceScript(text, { name, phone: contact.phone ?? "" });
}

export function buildVoiceAgentSystemPrompt(
  ai: VoiceAgentPromptInput,
  contact: { name?: string | null; phone?: string | null },
  extra?: { slots?: string; memory?: string; wrappingUp?: boolean },
): string {
  const name = contact.name?.trim() || "there";
  const kb = (ai.knowledgeBase?.documents ?? [])
    .map((d) => `### ${d.title}\n${d.content}`)
    .join("\n\n")
    .slice(0, 4500);
  const defaultLanguage = toBcp47(ai.language);
  const duration = ai.maxCallDurationSec ?? 120;
  return [
    ai.systemPrompt,
    `You are a live phone agent in a real two-way call. Sound human: warm, brief, natural — not a chatbot or FAQ page.`,
    `Reply in the SAME language the caller just used. Hindi → Hindi. English → English. Hinglish → Hinglish. Never force ${defaultLanguage} if they switched.`,
    `Keep each reply under 25 words, ideally one short sentence. Ask at most one follow-up question.`,
    `Never ignore what they just said. Do not repeat the greeting after they have spoken. No markdown, bullets, or lists.`,
    `Caller name: ${name}. Phone: ${contact.phone ?? ""}. Default greeting language: ${defaultLanguage}.`,
    `Call length limit is about ${duration} seconds. When wrapping up, thank them and close.`,
    extra?.wrappingUp
      ? "TIME TO WRAP UP NOW: give a brief polite closing, ask no new questions, and end with <<HANGUP>>."
      : "",
    ai.objective ? `Objective: ${ai.objective}` : "",
    ai.questions ? `Questions to cover if relevant: ${ai.questions}` : "",
    ai.disallowed ? `Never do: ${ai.disallowed}` : "",
    ai.intentPlaybook?.length ? formatPlaybookForPrompt(ai.intentPlaybook) : "",
    extra?.memory ?? "",
    kb
      ? `Knowledge base (${ai.knowledgeBase?.name}):\n${kb}`
      : "No knowledge documents. Be honest, ask what they need, and offer an appointment if slots exist.",
    extra?.slots ?? "",
    "If you truly cannot help, offer an appointment or a callback — do not loop the same sentence.",
  ]
    .filter(Boolean)
    .join("\n");
}
