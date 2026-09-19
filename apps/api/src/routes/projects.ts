import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@wacalls/database";
import {
  createBusinessProject,
  getProjectsList,
  getProjectsStats,
  getProjectJourney,
  logProjectUpdate,
} from "../services/projects/project-service.js";

const createProjectBodySchema = z.object({
  projectCode: z.string().optional(),
  title: z.string().min(2, "Project title is required"),
  description: z.string().optional().nullable(),
  clientName: z.string().optional().nullable(),
  clientPhone: z.string().optional().nullable(),
  budget: z.number().optional().nullable(),
  currency: z.string().default("INR"),
  startDate: z.string().optional(),
  targetDeadline: z.string().optional().nullable(),
  status: z.enum(["PLANNING", "IN_PROGRESS", "REVIEW", "COMPLETED", "ON_HOLD", "CANCELLED"]).default("PLANNING"),
  progressPercent: z.number().min(0).max(100).default(0),
  healthStatus: z.enum(["ON_TRACK", "AT_RISK", "DELAYED"]).default("ON_TRACK"),
  keyDeliverables: z.array(z.string()).optional(),
  nextStepAction: z.string().optional().nullable(),
  nextStepOwner: z.string().optional().nullable(),
  nextStepDueAt: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  members: z
    .array(
      z.object({
        name: z.string(),
        phone: z.string(),
        roleInProject: z.string(),
        isLead: z.boolean().optional(),
      }),
    )
    .optional(),
  notifyMembersOnWhatsApp: z.boolean().default(true),
});

const updateProjectBodySchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  clientName: z.string().optional().nullable(),
  clientPhone: z.string().optional().nullable(),
  budget: z.number().optional().nullable(),
  targetDeadline: z.string().optional().nullable(),
  status: z.enum(["PLANNING", "IN_PROGRESS", "REVIEW", "COMPLETED", "ON_HOLD", "CANCELLED"]).optional(),
  progressPercent: z.number().min(0).max(100).optional(),
  healthStatus: z.enum(["ON_TRACK", "AT_RISK", "DELAYED"]).optional(),
  keyDeliverables: z.array(z.string()).optional(),
  nextStepAction: z.string().optional().nullable(),
  nextStepOwner: z.string().optional().nullable(),
  nextStepDueAt: z.string().optional().nullable(),
});

const logUpdateBodySchema = z.object({
  authorName: z.string().min(1, "Author name required"),
  authorPhone: z.string().default("Admin"),
  authorRole: z.string().optional().nullable(),
  updateText: z.string().min(2, "Update text required"),
  source: z.enum(["WHATSAPP", "WEB_PORTAL", "VOICE_NOTE", "SYSTEM"]).default("WEB_PORTAL"),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "BLOCKED"]).default("NEUTRAL"),
  blockers: z.string().optional().nullable(),
  nextStepSuggested: z.string().optional().nullable(),
  nextStepOwner: z.string().optional().nullable(),
  progressPercent: z.number().min(0).max(100).optional().nullable(),
  healthStatus: z.enum(["ON_TRACK", "AT_RISK", "DELAYED"]).optional().nullable(),
  notifyNextOwnerOnWhatsApp: z.boolean().default(false),
});

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // 1. Executive Stats Bar
  app.get("/projects/stats", async (req) => {
    const auth = await app.authenticate(req);
    const stats = await getProjectsStats(auth.orgId);
    return { success: true, data: stats };
  });

  // 2. List Projects (with search and status filters)
  app.get("/projects", async (req) => {
    const auth = await app.authenticate(req);
    const q = req.query as { status?: string; healthStatus?: string; search?: string };
    const projects = await getProjectsList(auth.orgId, q);
    return { success: true, data: projects };
  });

  // 3. Create Project
  app.post("/projects", async (req, reply) => {
    const auth = await app.authenticate(req);
    const body = createProjectBodySchema.parse(req.body);

    const project = await createBusinessProject({
      ...body,
      organizationId: auth.orgId,
    });

    return reply.status(201).send({ success: true, data: project });
  });

  // 4. Get Project Detail & Living Journey Timeline
  app.get("/projects/:id", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };

    const project = await getProjectJourney(auth.orgId, id);
    return { success: true, data: project };
  });

  // 5. Update Project
  app.patch("/projects/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = updateProjectBodySchema.parse(req.body);

    const data: any = { ...body };
    if (body.targetDeadline) data.targetDeadline = new Date(body.targetDeadline);
    if (body.nextStepDueAt) data.nextStepDueAt = new Date(body.nextStepDueAt);
    if (body.status === "COMPLETED") data.completedAt = new Date();

    const updated = await prisma.businessProject.update({
      where: { id, organizationId: auth.orgId },
      data,
    });

    return { success: true, data: updated };
  });

  // 6. Delete / Archive Project
  app.delete("/projects/:id", async (req) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };

    await prisma.businessProject.delete({
      where: { id, organizationId: auth.orgId },
    });

    return { success: true, message: "Project deleted successfully" };
  });

  // 7. Log Update into Project Timeline
  app.post("/projects/:id/updates", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const body = logUpdateBodySchema.parse(req.body);

    const logEntry = await logProjectUpdate({
      ...body,
      projectId: id,
      organizationId: auth.orgId,
    });

    return reply.status(201).send({ success: true, data: logEntry });
  });

  // 8. Add Member to Project
  app.post("/projects/:id/members", async (req, reply) => {
    const auth = await app.authenticate(req);
    const { id } = req.params as { id: string };
    const memberSchema = z.object({
      name: z.string().min(1),
      phone: z.string().min(5),
      roleInProject: z.string().default("Member"),
      isLead: z.boolean().default(false),
    });
    const body = memberSchema.parse(req.body);

    const member = await prisma.projectMember.create({
      data: {
        projectId: id,
        organizationId: auth.orgId,
        name: body.name.trim(),
        phone: body.phone.trim(),
        roleInProject: body.roleInProject.trim(),
        isLead: body.isLead,
      },
    });

    return reply.status(201).send({ success: true, data: member });
  });

  // 9. Remove Member from Project
  app.delete("/projects/:id/members/:memberId", async (req) => {
    const auth = await app.authenticate(req);
    const { id, memberId } = req.params as { id: string; memberId: string };

    await prisma.projectMember.deleteMany({
      where: { id: memberId, projectId: id, organizationId: auth.orgId },
    });

    return { success: true, message: "Member removed from project" };
  });
};
