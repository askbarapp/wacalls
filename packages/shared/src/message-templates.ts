import { MESSAGE_TEMPLATE_KINDS, type MessageTemplateKind } from "./enums.js";

export type TemplateButtonType = "reply" | "url" | "call";

export type TemplateButton = {
  id: string;
  type: TemplateButtonType;
  text: string;
  url?: string;
  phone?: string;
};

export type TemplateListRow = {
  id: string;
  title: string;
  description?: string;
};

export type TemplateListSection = {
  title: string;
  rows: TemplateListRow[];
};

export type MessageTemplatePayload = {
  kind: MessageTemplateKind;
  header?: string | null;
  body: string;
  footer?: string | null;
  mediaPath?: string | null;
  buttons?: TemplateButton[];
  listButton?: string | null;
  sections?: TemplateListSection[];
};

export type TemplateVars = {
  name?: string | null;
  phone?: string | null;
  company?: string | null;
  email?: string | null;
};

function fill(text: string | null | undefined, vars: TemplateVars): string {
  return (text ?? "")
    .replaceAll("{{name}}", vars.name?.trim() || "ji")
    .replaceAll("{{phone}}", vars.phone ?? "")
    .replaceAll("{{company}}", vars.company?.trim() || "")
    .replaceAll("{{email}}", vars.email?.trim() || "");
}

export function parseTemplateButtons(value: unknown): TemplateButton[] {
  if (!Array.isArray(value)) return [];
  const out: TemplateButton[] = [];
  for (let i = 0; i < value.length; i++) {
    const btn = value[i] as Partial<TemplateButton> | null;
    const text = String(btn?.text ?? "").trim();
    if (!text) continue;
    out.push({
      id: String(btn?.id ?? `btn-${i + 1}`),
      type: btn?.type === "url" || btn?.type === "call" ? btn.type : "reply",
      text,
      url: btn?.url,
      phone: btn?.phone,
    });
  }
  return out;
}

export function parseTemplateSections(value: unknown): TemplateListSection[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const section = row as TemplateListSection;
    return {
      title: String(section?.title ?? "Options"),
      rows: Array.isArray(section?.rows)
        ? section.rows.map((item, i) => ({
            id: String(item?.id ?? `row-${i + 1}`),
            title: String(item?.title ?? ""),
            description: item?.description,
          }))
        : [],
    };
  });
}

export function templateFromRecord(row: {
  kind?: string | null;
  header?: string | null;
  body: string;
  footer?: string | null;
  mediaPath?: string | null;
  buttons?: unknown;
  listButton?: string | null;
  sections?: unknown;
}): MessageTemplatePayload {
  const kind = MESSAGE_TEMPLATE_KINDS.includes(row.kind as MessageTemplateKind)
    ? (row.kind as MessageTemplateKind)
    : "TEXT";
  return {
    kind,
    header: row.header,
    body: row.body,
    footer: row.footer,
    mediaPath: row.mediaPath,
    buttons: parseTemplateButtons(row.buttons),
    listButton: row.listButton,
    sections: parseTemplateSections(row.sections),
  };
}

export function composeSimpleBody(header: string, body: string, footer: string): string {
  return [header.trim(), body.trim(), footer.trim()].filter(Boolean).join("\n\n");
}

export function fillMessageTemplate(input: MessageTemplatePayload, vars: TemplateVars): MessageTemplatePayload {
  return {
    kind: input.kind,
    header: fill(input.header, vars) || null,
    body: fill(input.body, vars),
    footer: fill(input.footer, vars) || null,
    mediaPath: input.mediaPath ?? null,
    listButton: fill(input.listButton, vars) || null,
    buttons: (input.buttons ?? []).map((btn, i) => ({
      id: btn.id || `btn-${i + 1}`,
      type: btn.type === "url" || btn.type === "call" ? btn.type : "reply",
      text: fill(btn.text, vars).slice(0, 20),
      url: fill(btn.url, vars),
      phone: fill(btn.phone, vars),
    })),
    sections: (input.sections ?? []).map((section) => ({
      title: fill(section.title, vars).slice(0, 24),
      rows: (section.rows ?? []).map((row, i) => ({
        id: row.id || `row-${i + 1}`,
        title: fill(row.title, vars).slice(0, 24),
        description: fill(row.description, vars).slice(0, 72),
      })),
    })),
  };
}

export function templatePreviewText(input: Pick<MessageTemplatePayload, "kind" | "header" | "body" | "footer">): string {
  if (input.kind === "SIMPLE") return composeSimpleBody(input.header ?? "", input.body, input.footer ?? "");
  return input.body;
}

export function nativeMessagePayload(filled: MessageTemplatePayload) {
  const kind = filled.kind === "SIMPLE" ? "TEXT" : filled.kind;
  return {
    kind,
    text:
      filled.kind === "SIMPLE"
        ? composeSimpleBody(filled.header ?? "", filled.body, filled.footer ?? "")
        : filled.body,
    header: filled.header ?? "",
    footer: filled.footer ?? "",
    imagePath: filled.mediaPath ?? "",
    buttons: filled.buttons ?? [],
    listButton: filled.listButton ?? "Options",
    sections: filled.sections ?? [],
  };
}

export function cloudInteractivePayload(filled: MessageTemplatePayload): Record<string, unknown> | null {
  if (filled.kind === "BUTTON") {
    const replies = (filled.buttons ?? [])
      .filter((b) => b.type === "reply" && b.text.trim())
      .slice(0, 3)
      .map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.text.slice(0, 20) },
      }));
    if (!replies.length) return null;
    return {
      messaging_product: "whatsapp",
      type: "interactive",
      interactive: {
        type: "button",
        ...(filled.header ? { header: { type: "text", text: filled.header.slice(0, 60) } } : {}),
        body: { text: filled.body },
        ...(filled.footer ? { footer: { text: filled.footer.slice(0, 60) } } : {}),
        action: { buttons: replies },
      },
    };
  }
  if (filled.kind === "LIST") {
    const sections = (filled.sections ?? [])
      .map((section) => ({
        title: (section.title || "Options").slice(0, 24),
        rows: (section.rows ?? [])
          .filter((row) => row.title.trim())
          .slice(0, 10)
          .map((row) => ({
            id: row.id,
            title: row.title.slice(0, 24),
            ...(row.description ? { description: row.description.slice(0, 72) } : {}),
          })),
      }))
      .filter((section) => section.rows.length);
    if (!sections.length) return null;
    return {
      messaging_product: "whatsapp",
      type: "interactive",
      interactive: {
        type: "list",
        ...(filled.header ? { header: { type: "text", text: filled.header.slice(0, 60) } } : {}),
        body: { text: filled.body },
        ...(filled.footer ? { footer: { text: filled.footer.slice(0, 60) } } : {}),
        action: { button: (filled.listButton || "Options").slice(0, 20), sections },
      },
    };
  }
  return null;
}
