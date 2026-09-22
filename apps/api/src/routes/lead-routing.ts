import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import { ok, NotFoundError } from "@wacalls/shared";
import { whatsappClient } from "../services/whatsapp-client.js";

const platformEnum = z.enum(["FACEBOOK", "INSTAGRAM", "WEBSITE", "GOOGLE", "OTHER"]);
const matchTypeEnum = z.enum(["CONTAINS", "EXACT", "STARTS_WITH", "REGEX"]);
const assignTypeEnum = z.enum(["USER", "GROUP", "ROUND_ROBIN", "NONE"]);

const ruleBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  channelId: z.string().uuid().nullable().optional(),
  sourcePlatform: platformEnum.default("FACEBOOK"),
  matchType: matchTypeEnum.default("CONTAINS"),
  matchContent: z.string().trim().min(1).max(500),
  assignType: assignTypeEnum.default("USER"),
  assignedUserId: z.string().uuid().nullable().optional(),
  assignedGroupJid: z.string().trim().nullable().optional(),
  assignedGroupName: z.string().trim().nullable().optional(),
  roundRobinUserIds: z.array(z.string().uuid()).default([]),
  notifyGroup: z.boolean().default(false),
  notifyGroupJid: z.string().trim().nullable().optional(),
  notifyGroupName: z.string().trim().nullable().optional(),
  notifyAssignee: z.boolean().default(true),
  autoReplyCustomer: z.boolean().default(false),
  autoReplyText: z.string().trim().max(1000).nullable().optional(),
  leadTags: z.array(z.string().trim()).default(["lead"]),
  leadStage: z.string().default("NEW"),
  leadValue: z.number().nullable().optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
});

export const leadRoutingRoutes: FastifyPluginAsync = async (app) => {
  // 1. List all rules
  app.get("/lead-routing/rules", async (req) => {
    const auth = await app.authenticate(req);
    const rules = await (prisma as any).leadRoutingRule.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        channel: { select: { id: true, displayName: true, phoneNumber: true } },
        assignedUser: { select: { id: true, name: true, email: true, phone: true } },
        _count: { select: { logs: true } },
      },
    });
    return ok(rules);
  });

  // 2. Create rule
  app.post("/lead-routing/rules", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req).catch(() => undefined);
    const data = ruleBodySchema.parse(req.body);

    const created = await (prisma as any).leadRoutingRule.create({
      data: {
        organizationId: auth.orgId,
        ...data,
      },
      include: {
        channel: { select: { id: true, displayName: true, phoneNumber: true } },
        assignedUser: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    return ok(created);
  });

  // 3. Get single rule
  app.get("/lead-routing/rules/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const rule = await (prisma as any).leadRoutingRule.findFirst({
      where: { id, organizationId: auth.orgId },
      include: {
        channel: { select: { id: true, displayName: true, phoneNumber: true } },
        assignedUser: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!rule) throw new NotFoundError("Lead routing rule not found");
    return ok(rule);
  });

  // 4. Update rule
  app.put("/lead-routing/rules/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req).catch(() => undefined);
    const { id } = req.params as { id: string };
    const data = ruleBodySchema.partial().parse(req.body);

    const existing = await (prisma as any).leadRoutingRule.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) throw new NotFoundError("Lead routing rule not found");

    const updated = await (prisma as any).leadRoutingRule.update({
      where: { id },
      data,
      include: {
        channel: { select: { id: true, displayName: true, phoneNumber: true } },
        assignedUser: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    return ok(updated);
  });

  // 5. Delete rule
  app.delete("/lead-routing/rules/:id", async (req) => {
    const auth = await app.authenticate(req);
    await app.requirePermission("messages.send")(req).catch(() => undefined);
    const { id } = req.params as { id: string };

    const existing = await (prisma as any).leadRoutingRule.findFirst({
      where: { id, organizationId: auth.orgId },
    });
    if (!existing) throw new NotFoundError("Lead routing rule not found");

    await (prisma as any).leadRoutingRule.delete({ where: { id } });
    return ok({ success: true });
  });

  // 6. List WhatsApp Groups for a channel
  app.get("/lead-routing/groups", async (req) => {
    const auth = await app.authenticate(req);
    const q = z.object({ channelId: z.string().uuid().optional() }).parse(req.query);

    let channelId = q.channelId;
    if (!channelId) {
      const activeChannel = await prisma.whatsAppChannel.findFirst({
        where: {
          organizationId: auth.orgId,
          OR: [{ status: "CONNECTED" }, { sessionStatus: "CONNECTED" }],
        },
        select: { id: true },
      });
      channelId = activeChannel?.id;
      if (!channelId) {
        const anyChannel = await prisma.whatsAppChannel.findFirst({
          where: { organizationId: auth.orgId },
          select: { id: true },
        });
        channelId = anyChannel?.id;
      }
    }

    if (!channelId) {
      return ok({ groups: [] });
    }

    try {
      const res = await whatsappClient.listGroups(channelId);
      return ok({ groups: res.groups || [] });
    } catch (err: any) {
      app.log.warn({ err: err?.message, channelId }, "Failed to fetch whatsapp groups");
      return ok({ groups: [] });
    }
  });

  // 7. List recent routing logs
  app.get("/lead-routing/logs", async (req) => {
    const auth = await app.authenticate(req);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        ruleId: z.string().uuid().optional(),
      })
      .parse(req.query);

    const logs = await (prisma as any).leadRoutingLog.findMany({
      where: {
        organizationId: auth.orgId,
        ...(q.ruleId ? { ruleId: q.ruleId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: q.limit,
      include: {
        rule: { select: { id: true, name: true, sourcePlatform: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });
    return ok(logs);
  });

  // 8. Test simulation
  app.post("/lead-routing/test", async (req) => {
    const auth = await app.authenticate(req);
    const body = z
      .object({
        text: z.string().trim().min(1),
        channelId: z.string().uuid().optional(),
      })
      .parse(req.body);

    const rules = await (prisma as any).leadRoutingRule.findMany({
      where: {
        organizationId: auth.orgId,
        enabled: true,
        OR: [{ channelId: null }, ...(body.channelId ? [{ channelId: body.channelId }] : [])],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
      },
    });

    const normText = body.text.toLowerCase().trim();
    let matchedRule: any = null;

    for (const r of rules) {
      const pattern = r.matchContent.toLowerCase().trim();
      let isMatch = false;
      if (r.matchType === "EXACT") isMatch = normText === pattern;
      else if (r.matchType === "STARTS_WITH") isMatch = normText.startsWith(pattern);
      else if (r.matchType === "REGEX") {
        try {
          isMatch = new RegExp(r.matchContent.trim(), "i").test(body.text);
        } catch {
          isMatch = false;
        }
      } else {
        isMatch = normText.includes(pattern);
      }

      if (isMatch) {
        matchedRule = r;
        break;
      }
    }

    if (!matchedRule) {
      return ok({ matched: false, message: "No active lead routing rule matched this text." });
    }

    return ok({
      matched: true,
      rule: {
        id: matchedRule.id,
        name: matchedRule.name,
        sourcePlatform: matchedRule.sourcePlatform,
        matchType: matchedRule.matchType,
        assignType: matchedRule.assignType,
        assignedUser: matchedRule.assignedUser,
        assignedGroupName: matchedRule.assignedGroupName,
        notifyGroup: matchedRule.notifyGroup,
        notifyGroupName: matchedRule.notifyGroupName,
        notifyAssignee: matchedRule.notifyAssignee,
        autoReplyCustomer: matchedRule.autoReplyCustomer,
        autoReplyText: matchedRule.autoReplyText,
        leadTags: matchedRule.leadTags,
      },
    });
  });
};
