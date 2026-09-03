import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { NotFoundError, ok } from "@wacalls/shared";
import { createVisit, submitVisitEnquiry, updateVisit, publicVisitConfig } from "../services/visits.js";
import {
  agentReplyVisitChat,
  createDepartment,
  deleteDepartment,
  getPublicConversation,
  getVisitConversation,
  heartbeatVisit,
  listDepartments,
  listVisitConversations,
  liveVisitVisitors,
  sendVisitChatMessage,
  startVisitCall,
  startVisitChat,
  updateDepartment,
  visitAnalytics,
} from "../services/visits-support.js";

const visitInclude = {
  channel: { select: { id: true, displayName: true, phoneNumber: true, status: true } },
  aiConfig: { select: { id: true, name: true } },
  departments: {
    include: { channel: { select: { id: true, displayName: true, phoneNumber: true, status: true } } },
    orderBy: { sortOrder: "asc" as const },
  },
  _count: { select: { leads: true, conversations: true, sessions: true } },
};

export const visitRoutes: FastifyPluginAsync = async (app) => {
  app.get("/visits", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const visits = await prisma.visit.findMany({
      where: { organizationId: auth.orgId },
      include: visitInclude,
      orderBy: { createdAt: "desc" },
    });
    return ok(visits);
  });

  app.get("/visits/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    const visit = await prisma.visit.findFirst({
      where: { id, organizationId: auth.orgId },
      include: visitInclude,
    });
    if (!visit) throw new NotFoundError("Website Visit not found");
    return ok(visit);
  });

  app.get("/visits/:id/live", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    return ok(await liveVisitVisitors(auth.orgId, id));
  });

  app.get("/visits/:id/analytics", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    return ok(await visitAnalytics(auth.orgId, id));
  });

  app.get("/visits/:id/conversations", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    return ok(await listVisitConversations(auth.orgId, id));
  });

  app.get("/visits/:id/conversations/:cid", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id, cid } = req.params as { id: string; cid: string };
    return ok(await getVisitConversation(auth.orgId, id, cid));
  });

  app.post("/visits/:id/conversations/:cid/messages", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id, cid } = req.params as { id: string; cid: string };
    const body = z.object({ body: z.string().min(1).max(2000) }).parse(req.body);
    return ok(await agentReplyVisitChat(auth.orgId, id, cid, body.body));
  });

  app.get("/visits/:id/departments", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    return ok(await listDepartments(auth.orgId, id));
  });

  app.post("/visits/:id/departments", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(40), channel_id: z.string().uuid() }).parse(req.body);
    return ok(await createDepartment(auth.orgId, id, body.name, body.channel_id));
  });

  app.patch("/visits/:id/departments/:did", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id, did } = req.params as { id: string; did: string };
    const body = z.object({ name: z.string().min(1).max(40).optional(), channel_id: z.string().uuid().optional() }).parse(req.body);
    return ok(await updateDepartment(auth.orgId, id, did, { name: body.name, channelId: body.channel_id }));
  });

  app.delete("/visits/:id/departments/:did", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id, did } = req.params as { id: string; did: string };
    return ok(await deleteDepartment(auth.orgId, id, did));
  });

  app.get("/visits/:id/leads", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    const visit = await prisma.visit.findFirst({ where: { id, organizationId: auth.orgId } });
    if (!visit) throw new NotFoundError("Website Visit not found");
    const leads = await prisma.visitLead.findMany({
      where: { visitId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok(leads);
  });

  app.post("/visits", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const body = z
      .object({
        channel_id: z.string().uuid(),
        name: z.string().min(2).max(80),
        target_phone: z.string().min(8),
        button_label: z.string().max(40).optional(),
        greeting: z.string().max(160).optional(),
        purposes: z.array(z.string().min(1).max(40)).max(12).optional(),
      })
      .parse(req.body);
    const visit = await createVisit({
      organizationId: auth.orgId,
      channelId: body.channel_id,
      name: body.name,
      targetPhone: body.target_phone,
      buttonLabel: body.button_label,
      greeting: body.greeting,
      purposes: body.purposes,
    });
    return ok(visit);
  });

  app.patch("/visits/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        channel_id: z.string().uuid().optional(),
        name: z.string().min(2).max(80).optional(),
        target_phone: z.string().min(8).optional(),
        button_label: z.string().max(40).optional(),
        greeting: z.string().max(160).optional(),
        purposes: z.array(z.string().min(1).max(40)).max(12).optional(),
        enabled: z.boolean().optional(),
        chat_enabled: z.boolean().optional(),
        call_enabled: z.boolean().optional(),
        ai_enabled: z.boolean().optional(),
        ai_config_id: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const visit = await updateVisit(auth.orgId, id, {
      name: body.name,
      channelId: body.channel_id,
      targetPhone: body.target_phone,
      buttonLabel: body.button_label,
      greeting: body.greeting,
      purposes: body.purposes,
      enabled: body.enabled,
      chatEnabled: body.chat_enabled,
      callEnabled: body.call_enabled,
      aiEnabled: body.ai_enabled,
      aiConfigId: body.ai_config_id,
    });
    return ok(visit);
  });

  app.delete("/visits/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("visits.manage")(req);
    const { id } = req.params as { id: string };
    const result = await prisma.visit.deleteMany({ where: { id, organizationId: auth.orgId } });
    if (!result.count) throw new NotFoundError("Website Visit not found");
    return ok({ deleted: true });
  });
};

export const publicVisitRoutes: FastifyPluginAsync = async (app) => {
  app.get("/public/visits/:key", async (req) => {
    const { key } = req.params as { key: string };
    return ok(await publicVisitConfig(key));
  });

  app.post(
    "/public/visits/:key/presence",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const { key } = req.params as { key: string };
      const body = z
        .object({
          session_key: z.string().max(80).optional(),
          url: z.string().max(500).optional(),
          title: z.string().max(160).optional(),
          referrer: z.string().max(500).optional(),
        })
        .parse(req.body ?? {});
      return ok(
        await heartbeatVisit({
          publicKey: key,
          sessionKey: body.session_key,
          url: body.url,
          title: body.title,
          referrer: body.referrer,
          userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : "",
        }),
      );
    },
  );

  app.post(
    "/public/visits/:key/chat/start",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { key } = req.params as { key: string };
      const body = z
        .object({
          session_key: z.string().min(8).max(80),
          department_id: z.string().uuid().optional(),
          name: z.string().min(2).max(80),
          phone: z.string().min(8).max(20),
          email: z.string().email().optional(),
        })
        .parse(req.body);
      return ok(
        await startVisitChat({
          publicKey: key,
          sessionKey: body.session_key,
          departmentId: body.department_id,
          name: body.name,
          phone: body.phone,
          email: body.email,
        }),
      );
    },
  );

  app.post(
    "/public/visits/:key/chat/:conversationId/messages",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (req) => {
      const { key, conversationId } = req.params as { key: string; conversationId: string };
      const body = z.object({ session_key: z.string().min(8).max(80), body: z.string().min(1).max(2000) }).parse(req.body);
      return ok(
        await sendVisitChatMessage({
          publicKey: key,
          conversationId,
          sessionKey: body.session_key,
          body: body.body,
        }),
      );
    },
  );

  app.get("/public/visits/:key/chat/:conversationId", async (req) => {
    const { key, conversationId } = req.params as { key: string; conversationId: string };
    const q = z.object({ session_key: z.string().min(8).max(80) }).parse(req.query);
    return ok(await getPublicConversation(key, conversationId, q.session_key));
  });

  app.post(
    "/public/visits/:key/call",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req) => {
      const { key } = req.params as { key: string };
      const body = z
        .object({
          session_key: z.string().max(80).optional(),
          conversation_id: z.string().uuid().optional(),
          department_id: z.string().uuid().optional(),
          name: z.string().min(2).max(80),
          phone: z.string().min(8).max(20),
          email: z.string().email().optional(),
        })
        .parse(req.body);
      const result = await startVisitCall({
        publicKey: key,
        sessionKey: body.session_key,
        conversationId: body.conversation_id,
        departmentId: body.department_id,
        name: body.name,
        phone: body.phone,
        email: body.email,
      });
      return { success: true, ...result };
    },
  );

  app.post(
    "/public/visits/:key/enquire",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req) => {
      const { key } = req.params as { key: string };
      const body = z
        .object({
          name: z.string().min(2).max(80),
          phone: z.string().min(8).max(20),
          email: z.string().email(),
          purpose: z.string().min(1).max(40),
        })
        .parse(req.body);
      const result = await submitVisitEnquiry({
        publicKey: key,
        name: body.name,
        phone: body.phone,
        email: body.email,
        purpose: body.purpose,
      });
      return { success: true, ...result };
    },
  );

  app.get("/public/visits/:key/calls/:callId", async (req) => {
    const { key, callId } = req.params as { key: string; callId: string };
    const visit = await prisma.visit.findUnique({ where: { publicKey: key } });
    if (!visit) throw new NotFoundError("Website Visit not found");
    const lead = await prisma.visitLead.findFirst({
      where: { visitId: visit.id, callId },
    });
    if (!lead?.callId) throw new NotFoundError("Call not found");
    const call = await prisma.call.findFirst({
      where: { id: lead.callId, organizationId: visit.organizationId },
      select: { id: true, status: true, failureReason: true },
    });
    if (!call) throw new NotFoundError("Call not found");
    return ok(call);
  });
};
