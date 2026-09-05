import { prisma } from "@wacalls/database";
import { randomToken } from "@wacalls/auth";
import { ConflictError, normalizePhone, NotFoundError } from "@wacalls/shared";
import { createVoiceAiClient, buildVoiceAgentSystemPrompt, defaultModelForProvider, normalizeVoiceProvider, normalizeIntentPlaybook } from "@wacalls/audio-engine";
import { sendWhatsAppText } from "./messaging.js";
import { enqueueCall } from "./calls.js";
import { enqueueWebhook } from "./webhooks.js";
import { resolveVoiceApiKey } from "./sarvam-key.js";
import { publishEvent } from "./events.js";

const LIVE_MS = 45_000;
const DEFAULT_DEPARTMENTS = ["Sales", "Support", "Partnership", "Other"];

function sessionKey() {
  return `vs_${randomToken(16)}`;
}

async function requireVisitByKey(publicKey: string) {
  const visit = await prisma.visit.findUnique({
    where: { publicKey },
    include: {
      channel: { select: { id: true, status: true, displayName: true, phoneNumber: true } },
      departments: {
        include: { channel: { select: { id: true, status: true, displayName: true, phoneNumber: true } } },
        orderBy: { sortOrder: "asc" },
      },
      aiConfig: { select: { id: true, name: true } },
    },
  });
  if (!visit || !visit.enabled) throw new NotFoundError("This Website Visit is not available.");
  return visit;
}

async function requireDepartment(visitId: string, departmentId?: string) {
  const rows = await prisma.visitDepartment.findMany({
    where: { visitId },
    include: { channel: true },
    orderBy: { sortOrder: "asc" },
  });
  if (!rows.length) throw new ConflictError("Add a department and assign a WhatsApp instance first.");
  const dept = departmentId ? rows.find((d) => d.id === departmentId) : rows[0];
  if (!dept) throw new NotFoundError("Department not found");
  if (dept.channel.status !== "CONNECTED") {
    throw new ConflictError(`${dept.name} WhatsApp line is not connected.`);
  }
  return dept;
}

async function ensureContact(organizationId: string, phone: string, name: string, email?: string) {
  return prisma.contact.upsert({
    where: { organizationId_phone: { organizationId, phone } },
    create: {
      organizationId,
      name,
      phone,
      email: email || undefined,
      tags: ["visit"],
      notes: "Website Visit",
    },
    update: {
      name,
      ...(email ? { email } : {}),
    },
  });
}

export async function seedVisitDepartments(visitId: string, organizationId: string, channelId: string, names: string[]) {
  const existing = await prisma.visitDepartment.count({ where: { visitId } });
  if (existing) return;
  const labels = names.map((n) => n.trim()).filter(Boolean);
  const list = labels.length ? labels : DEFAULT_DEPARTMENTS;
  await prisma.visitDepartment.createMany({
    data: list.map((name, i) => ({
      visitId,
      organizationId,
      channelId,
      name,
      sortOrder: i,
    })),
  });
}

export async function publicVisitWidget(publicKey: string) {
  const visit = await requireVisitByKey(publicKey);
  return {
    name: visit.name,
    buttonLabel: visit.buttonLabel,
    greeting: visit.greeting,
    purposes: visit.departments.length ? visit.departments.map((d) => d.name) : visit.purposes,
    chatEnabled: visit.chatEnabled,
    callEnabled: visit.callEnabled,
    aiEnabled: visit.aiEnabled,
    channelConnected: visit.channel.status === "CONNECTED" || visit.departments.some((d) => d.channel.status === "CONNECTED"),
    departments: visit.departments.map((d) => ({
      id: d.id,
      name: d.name,
      connected: d.channel.status === "CONNECTED",
    })),
  };
}

export async function heartbeatVisit(input: {
  publicKey: string;
  sessionKey?: string;
  url?: string;
  title?: string;
  referrer?: string;
  userAgent?: string;
}) {
  const visit = await requireVisitByKey(input.publicKey);
  const key = input.sessionKey?.trim() || sessionKey();
  const url = (input.url ?? "").slice(0, 500);
  const title = (input.title ?? "").slice(0, 160);
  const referrer = (input.referrer ?? "").slice(0, 500);
  const userAgent = (input.userAgent ?? "").slice(0, 240);

  const existing = await prisma.visitSession.findUnique({
    where: { visitId_sessionKey: { visitId: visit.id, sessionKey: key } },
  });

  const session = existing
    ? await prisma.visitSession.update({
        where: { id: existing.id },
        data: { currentUrl: url, currentTitle: title, referrer: referrer || existing.referrer, userAgent: userAgent || existing.userAgent, lastSeenAt: new Date() },
      })
    : await prisma.visitSession.create({
        data: {
          visitId: visit.id,
          organizationId: visit.organizationId,
          sessionKey: key,
          currentUrl: url,
          currentTitle: title,
          referrer,
          userAgent,
        },
      });

  if (url && url !== existing?.currentUrl) {
    await prisma.visitPageView.create({
      data: {
        visitId: visit.id,
        sessionId: session.id,
        organizationId: visit.organizationId,
        url,
        title,
      },
    });
  }

  await publishEvent({
    type: "visit.presence",
    organizationId: visit.organizationId,
    visitId: visit.id,
    sessionId: session.id,
    url,
    title,
  }).catch(() => undefined);

  return { sessionKey: session.sessionKey, sessionId: session.id };
}

export async function startVisitChat(input: {
  publicKey: string;
  sessionKey: string;
  departmentId?: string;
  name: string;
  phone: string;
  email?: string;
}) {
  const visit = await requireVisitByKey(input.publicKey);
  if (!visit.chatEnabled) throw new ConflictError("Chat is turned off for this website.");
  const name = input.name.trim();
  if (name.length < 2) throw new ConflictError("Enter your name.");
  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new ConflictError("Enter a valid WhatsApp number with country code.");
  const dept = await requireDepartment(visit.id, input.departmentId);

  let session = await prisma.visitSession.findUnique({
    where: { visitId_sessionKey: { visitId: visit.id, sessionKey: input.sessionKey } },
  });
  if (!session) {
    session = await prisma.visitSession.create({
      data: {
        visitId: visit.id,
        organizationId: visit.organizationId,
        sessionKey: input.sessionKey || sessionKey(),
        name,
        phone: phone.e164,
        email: input.email?.trim() || null,
        departmentId: dept.id,
      },
    });
  } else {
    session = await prisma.visitSession.update({
      where: { id: session.id },
      data: { name, phone: phone.e164, email: input.email?.trim() || session.email, departmentId: dept.id, lastSeenAt: new Date() },
    });
  }

  const contact = await ensureContact(visit.organizationId, phone.e164, name, input.email);

  const open = await prisma.visitConversation.findFirst({
    where: { visitId: visit.id, sessionId: session.id, departmentId: dept.id, status: "open" },
    orderBy: { createdAt: "desc" },
  });
  const conversation =
    open ??
    (await prisma.visitConversation.create({
      data: {
        visitId: visit.id,
        organizationId: visit.organizationId,
        sessionId: session.id,
        departmentId: dept.id,
        channelId: dept.channelId,
        phone: phone.e164,
        name,
        status: "open",
      },
    }));

  const greeting =
    visit.greeting?.trim() ||
    `Hi ${name}, you are chatting with ${dept.name}. This conversation continues on WhatsApp.`;
  const alreadyGreeted = await prisma.visitChatMessage.count({ where: { conversationId: conversation.id } });
  if (!alreadyGreeted) {
    await prisma.visitChatMessage.create({
      data: {
        conversationId: conversation.id,
        organizationId: visit.organizationId,
        sender: visit.aiEnabled ? "ai" : "agent",
        body: greeting,
      },
    });
    await sendWhatsAppText({
      organizationId: visit.organizationId,
      channelId: dept.channelId,
      phone: phone.e164,
      body: greeting,
      contactId: contact.id,
    }).catch(() => undefined);
  }

  await enqueueWebhook(visit.organizationId, "visit.chat.started", {
    visit_id: visit.id,
    conversation_id: conversation.id,
    department: dept.name,
    phone: phone.e164,
  }).catch(() => undefined);

  return serializeConversation(conversation.id);
}

export async function sendVisitChatMessage(input: {
  publicKey: string;
  conversationId: string;
  sessionKey: string;
  body: string;
}) {
  const visit = await requireVisitByKey(input.publicKey);
  const text = input.body.trim();
  if (!text) throw new ConflictError("Type a message.");
  const conversation = await prisma.visitConversation.findFirst({
    where: { id: input.conversationId, visitId: visit.id, status: "open" },
    include: { session: true, department: { include: { channel: true } } },
  });
  if (!conversation || conversation.session.sessionKey !== input.sessionKey) {
    throw new NotFoundError("Chat not found");
  }
  if (conversation.department.channel.status !== "CONNECTED") {
    throw new ConflictError("WhatsApp line is not connected.");
  }

  const contact = await ensureContact(visit.organizationId, conversation.phone, conversation.name);
  await prisma.visitChatMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: visit.organizationId,
      sender: "visitor",
      body: text,
    },
  });
  await prisma.visitConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  if (visit.aiEnabled && visit.aiConfigId) {
    const reply = await generateVisitAiReply(visit.organizationId, visit.aiConfigId, conversation.id, conversation.name, conversation.phone);
    if (reply) {
      await prisma.visitChatMessage.create({
        data: {
          conversationId: conversation.id,
          organizationId: visit.organizationId,
          sender: "ai",
          body: reply,
        },
      });
      await sendWhatsAppText({
        organizationId: visit.organizationId,
        channelId: conversation.channelId,
        phone: conversation.phone,
        body: reply,
        contactId: contact.id,
      }).catch(() => undefined);
    }
  }

  await publishEvent({
    type: "visit.chat",
    organizationId: visit.organizationId,
    visitId: visit.id,
    conversationId: conversation.id,
  }).catch(() => undefined);

  return serializeConversation(conversation.id);
}

export async function getPublicConversation(publicKey: string, conversationId: string, sessionKey: string) {
  const visit = await requireVisitByKey(publicKey);
  const conversation = await prisma.visitConversation.findFirst({
    where: { id: conversationId, visitId: visit.id },
    include: { session: true },
  });
  if (!conversation || conversation.session.sessionKey !== sessionKey) throw new NotFoundError("Chat not found");
  return serializeConversation(conversation.id);
}

export async function startVisitCall(input: {
  publicKey: string;
  sessionKey?: string;
  conversationId?: string;
  departmentId?: string;
  name: string;
  phone: string;
  email?: string;
}) {
  const visit = await requireVisitByKey(input.publicKey);
  if (!visit.callEnabled) throw new ConflictError("Calling is turned off for this website.");
  const name = input.name.trim();
  if (name.length < 2) throw new ConflictError("Enter your name.");
  const phone = normalizePhone(input.phone);
  if (!phone.ok) throw new ConflictError("Enter a valid WhatsApp number with country code.");
  const dept = await requireDepartment(visit.id, input.departmentId);

  const contact = await ensureContact(visit.organizationId, phone.e164, name, input.email);
  const lead = await prisma.visitLead.create({
    data: {
      visitId: visit.id,
      organizationId: visit.organizationId,
      name,
      phone: phone.e164,
      email: input.email?.trim() || "",
      purpose: dept.name,
      status: "submitted",
    },
  });

  try {
    const { call, position } = await enqueueCall({
      organizationId: visit.organizationId,
      channelId: dept.channelId,
      phone: phone.e164,
      contactName: name,
      contactId: contact.id,
      source: "visit",
      aiConfigId: visit.aiEnabled ? visit.aiConfigId ?? undefined : undefined,
    });
    await prisma.visitLead.update({
      where: { id: lead.id },
      data: { callId: call.id, status: "calling" },
    });
    if (input.conversationId) {
      await prisma.visitChatMessage.create({
        data: {
          conversationId: input.conversationId,
          organizationId: visit.organizationId,
          sender: "agent",
          body: "WhatsApp call started from the website chat.",
        },
      });
    }
    await enqueueWebhook(visit.organizationId, "visit.submitted", {
      visit_id: visit.id,
      lead_id: lead.id,
      call_id: call.id,
      phone: phone.e164,
      purpose: dept.name,
    }).catch(() => undefined);
    return {
      leadId: lead.id,
      callId: call.id,
      queuePosition: position,
      status: "calling" as const,
      message: position > 1 ? `You are in queue. Position #${position}` : "Calling your WhatsApp now. Please answer.",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Could not start the call";
    await prisma.visitLead.update({ where: { id: lead.id }, data: { status: "failed", error } });
    throw err instanceof ConflictError ? err : new ConflictError(error);
  }
}

export async function liveVisitVisitors(organizationId: string, visitId: string) {
  await requireOrgVisit(organizationId, visitId);
  const since = new Date(Date.now() - LIVE_MS);
  return prisma.visitSession.findMany({
    where: { visitId, lastSeenAt: { gte: since } },
    include: { department: { select: { id: true, name: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: 200,
  });
}

export async function visitAnalytics(organizationId: string, visitId: string) {
  await requireOrgVisit(organizationId, visitId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const views = await prisma.visitPageView.findMany({
    where: { visitId, createdAt: { gte: since } },
    select: { url: true, title: true },
  });
  const pageMap = new Map<string, { url: string; title: string; views: number }>();
  for (const row of views) {
    const cur = pageMap.get(row.url) ?? { url: row.url, title: row.title, views: 0 };
    cur.views += 1;
    if (row.title) cur.title = row.title;
    pageMap.set(row.url, cur);
  }
  const [live, chats, calls] = await Promise.all([
    prisma.visitSession.count({ where: { visitId, lastSeenAt: { gte: new Date(Date.now() - LIVE_MS) } } }),
    prisma.visitConversation.count({ where: { visitId, lastMessageAt: { gte: since } } }),
    prisma.visitLead.count({ where: { visitId, createdAt: { gte: since } } }),
  ]);
  return {
    live,
    chats24h: chats,
    calls24h: calls,
    pages: [...pageMap.values()].sort((a, b) => b.views - a.views).slice(0, 20),
  };
}

export async function listVisitConversations(organizationId: string, visitId: string) {
  await requireOrgVisit(organizationId, visitId);
  return prisma.visitConversation.findMany({
    where: { visitId, organizationId },
    include: {
      department: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 80,
  });
}

export async function getVisitConversation(organizationId: string, visitId: string, conversationId: string) {
  await requireOrgVisit(organizationId, visitId);
  const row = await prisma.visitConversation.findFirst({
    where: { id: conversationId, visitId, organizationId },
    include: {
      department: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
  if (!row) throw new NotFoundError("Chat not found");
  return row;
}

export async function agentReplyVisitChat(organizationId: string, visitId: string, conversationId: string, body: string) {
  const text = body.trim();
  if (!text) throw new ConflictError("Type a reply.");
  const conversation = await prisma.visitConversation.findFirst({
    where: { id: conversationId, visitId, organizationId, status: "open" },
    include: { department: { include: { channel: true } } },
  });
  if (!conversation) throw new NotFoundError("Chat not found");
  const contact = await ensureContact(organizationId, conversation.phone, conversation.name);
  const message = await prisma.visitChatMessage.create({
    data: { conversationId: conversation.id, organizationId, sender: "agent", body: text },
  });
  await prisma.visitConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
  await sendWhatsAppText({
    organizationId,
    channelId: conversation.channelId,
    phone: conversation.phone,
    body: text,
    contactId: contact.id,
  });
  return message;
}

export async function listDepartments(organizationId: string, visitId: string) {
  await requireOrgVisit(organizationId, visitId);
  return prisma.visitDepartment.findMany({
    where: { visitId },
    include: { channel: { select: { id: true, displayName: true, phoneNumber: true, status: true } } },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createDepartment(organizationId: string, visitId: string, name: string, channelId: string) {
  const visit = await requireOrgVisit(organizationId, visitId);
  const channel = await prisma.whatsAppChannel.findFirst({ where: { id: channelId, organizationId } });
  if (!channel) throw new NotFoundError("WhatsApp instance not found");
  if (channel.provider === "CLOUD") throw new ConflictError("Use a WhatsApp Web instance for calling and chat.");
  const count = await prisma.visitDepartment.count({ where: { visitId } });
  return prisma.visitDepartment.create({
    data: { visitId: visit.id, organizationId, channelId: channel.id, name: name.trim() || "Support", sortOrder: count },
  });
}

export async function updateDepartment(
  organizationId: string,
  visitId: string,
  departmentId: string,
  patch: { name?: string; channelId?: string },
) {
  await requireOrgVisit(organizationId, visitId);
  const dept = await prisma.visitDepartment.findFirst({ where: { id: departmentId, visitId } });
  if (!dept) throw new NotFoundError("Department not found");
  let channelId = dept.channelId;
  if (patch.channelId) {
    const channel = await prisma.whatsAppChannel.findFirst({ where: { id: patch.channelId, organizationId } });
    if (!channel) throw new NotFoundError("WhatsApp instance not found");
    channelId = channel.id;
  }
  return prisma.visitDepartment.update({
    where: { id: dept.id },
    data: { name: patch.name?.trim() || dept.name, channelId },
  });
}

export async function deleteDepartment(organizationId: string, visitId: string, departmentId: string) {
  await requireOrgVisit(organizationId, visitId);
  const count = await prisma.visitDepartment.count({ where: { visitId } });
  if (count <= 1) throw new ConflictError("Keep at least one department.");
  await prisma.visitDepartment.deleteMany({ where: { id: departmentId, visitId } });
  return { deleted: true };
}

export async function syncVisitIncomingAi(organizationId: string, visitId: string) {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, organizationId },
    include: { departments: true },
  });
  if (!visit) return;
  const channelIds = [...new Set([visit.channelId, ...visit.departments.map((d) => d.channelId)])];
  if (!visit.aiEnabled || !visit.aiConfigId) return;
  for (const channelId of channelIds) {
    await prisma.incomingAnswerConfig.upsert({
      where: { channelId },
      update: { enabled: true, aiConfigId: visit.aiConfigId },
      create: {
        organizationId,
        channelId,
        enabled: true,
        aiConfigId: visit.aiConfigId,
        sendMessage: false,
        messageWhen: "answered",
      },
    });
  }
}

export async function ingestInboundWhatsApp(input: { channelId: string; phone: string; text: string; whatsappId?: string }) {
  const text = input.text.trim();
  if (!text) return;
  const digits = input.phone.replace(/\D/g, "");
  if (digits.length < 8) return;
  const conversation = await prisma.visitConversation.findFirst({
    where: {
      channelId: input.channelId,
      status: "open",
      OR: [{ phone: { endsWith: digits } }, { phone: { contains: digits } }],
    },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) return;
  if (input.whatsappId) {
    const dup = await prisma.visitChatMessage.findFirst({
      where: { conversationId: conversation.id, whatsappId: input.whatsappId },
    });
    if (dup) return;
  }
  await prisma.visitChatMessage.create({
    data: {
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      sender: "whatsapp",
      body: text,
      whatsappId: input.whatsappId,
    },
  });
  await prisma.visitConversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  const visit = await prisma.visit.findUnique({ where: { id: conversation.visitId } });
  if (visit?.aiEnabled && visit.aiConfigId) {
    const reply = await generateVisitAiReply(
      conversation.organizationId,
      visit.aiConfigId,
      conversation.id,
      conversation.name,
      conversation.phone,
    );
    if (reply) {
      await prisma.visitChatMessage.create({
        data: {
          conversationId: conversation.id,
          organizationId: conversation.organizationId,
          sender: "ai",
          body: reply,
        },
      });
      await sendWhatsAppText({
        organizationId: conversation.organizationId,
        channelId: conversation.channelId,
        phone: conversation.phone,
        body: reply,
      }).catch(() => undefined);
    }
  }
  await publishEvent({
    type: "visit.chat",
    organizationId: conversation.organizationId,
    visitId: conversation.visitId,
    conversationId: conversation.id,
  }).catch(() => undefined);
}

async function generateVisitAiReply(
  organizationId: string,
  aiConfigId: string,
  conversationId: string,
  name: string,
  phone: string,
) {
  const ai = await prisma.aiConfig.findFirst({
    where: { id: aiConfigId, organizationId },
    include: { knowledgeBase: { include: { documents: { take: 40 } } } },
  });
  if (!ai) return "";
  const historyRows = await prisma.visitChatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const history = historyRows
    .reverse()
    .filter((m) => m.sender === "visitor" || m.sender === "ai" || m.sender === "whatsapp")
    .map((m) => ({
      role: m.sender === "visitor" || m.sender === "whatsapp" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }));
  const provider = normalizeVoiceProvider(ai.provider);
  const { apiKey } = await resolveVoiceApiKey(organizationId, provider);
  const last = history[history.length - 1];
  const prior = history.slice(0, -1);
  return createVoiceAiClient(provider, apiKey).chat(
    [
      {
        role: "system",
        content: [
          buildVoiceAgentSystemPrompt(
            {
              systemPrompt: ai.systemPrompt,
              objective: ai.objective,
              questions: ai.questions,
              disallowed: ai.disallowed,
              language: ai.language,
              knowledgeBase: ai.knowledgeBase,
              intentPlaybook: normalizeIntentPlaybook(ai.intentPlaybook),
              maxCallDurationSec: ai.maxCallDurationSec,
              wrapUpSec: ai.wrapUpSec,
            },
            { name, phone },
          ),
          "You are also the website support chat agent. Replies appear in the website chat box and on WhatsApp. Keep answers short and helpful.",
        ].join("\n"),
      },
      ...prior.slice(-10),
      last ?? { role: "user", content: "Hello" },
    ],
    { model: ai.model || defaultModelForProvider(provider) },
  );
}

async function requireOrgVisit(organizationId: string, visitId: string) {
  const visit = await prisma.visit.findFirst({ where: { id: visitId, organizationId } });
  if (!visit) throw new NotFoundError("Website Visit not found");
  return visit;
}

async function serializeConversation(id: string) {
  const row = await prisma.visitConversation.findUnique({
    where: { id },
    include: {
      department: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, take: 200 },
    },
  });
  if (!row) throw new NotFoundError("Chat not found");
  return row;
}
