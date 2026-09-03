import { renderVoiceScript, toBcp47 } from "./sarvam.js";

export type VoiceAgentPromptInput = {
  systemPrompt: string;
  objective?: string | null;
  questions?: string | null;
  disallowed?: string | null;
  language: string;
  knowledgeBase?: { name: string; documents: Array<{ title: string; content: string }> } | null;
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
  extra?: { slots?: string },
): string {
  const name = contact.name?.trim() || "there";
  const kb = (ai.knowledgeBase?.documents ?? [])
    .map((d) => `### ${d.title}\n${d.content}`)
    .join("\n\n")
    .slice(0, 8000);
  const language = toBcp47(ai.language);
  return [
    ai.systemPrompt,
    `You are a live phone agent having a two-way conversation. Listen to the person, answer their question, then ask one short follow-up. Keep replies under 40 words, spoken and natural, in language ${language}.`,
    `Never ignore what they just said. Do not repeat the greeting after they have spoken.`,
    `Caller name: ${name}. Phone: ${contact.phone ?? ""}.`,
    ai.objective ? `Objective: ${ai.objective}` : "",
    ai.questions ? `Questions to cover if relevant: ${ai.questions}` : "",
    ai.disallowed ? `Never do: ${ai.disallowed}` : "",
    kb ? `Knowledge base (${ai.knowledgeBase?.name}):\n${kb}` : "No knowledge documents. Be honest, ask what they need, and offer an appointment if slots exist.",
    extra?.slots ?? "",
    "If you truly cannot help, offer an appointment or a callback — do not loop the same sentence.",
  ]
    .filter(Boolean)
    .join("\n");
}
