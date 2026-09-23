import pino from "pino";
import { prisma } from "@wacalls/database";
import { redis } from "../../redis.js";
import { resolveGeminiApiKey, hasGeminiApiKey } from "../sarvam-key.js";
import {
  getTasksCategorized,
  createMultipleTasks,
  markTaskComplete,
  completeAllTasks,
  getIstDateBoundaries,
} from "../tasks/task-service.js";
import { fallbackRegexTaskParser } from "../tasks/task-interpreter.js";
import { getTodayCallMetrics } from "../business-assistant.js";
import { getPendingPaymentsSummary, createInvoiceOrQuote, sendInvoiceToClient } from "../invoice-service.js";
import { getTeamPerformanceScorecard } from "../team-performance.js";
import { listCampaignsForAgent, startCampaignFromAgent, pauseCampaignFromAgent } from "../campaign-agent-service.js";
import { prepareDialerMedia, enqueueCall } from "../calls.js";
import { getMemberPermissions, checkAndConsumeImageQuota } from "../member-permissions.js";
import { createCreativeRequest } from "../creative/creative-service.js";
import { getProjectsList, logProjectUpdate } from "../projects/project-service.js";

const log = pino({ name: "agent-controller", level: process.env.LOG_LEVEL ?? "info" });

export interface AgentCommanderContext {
  authorized: boolean;
  role: "OWNER" | "SALES_MANAGER" | "ACCOUNTS" | "SUPPORT" | "EXECUTIVE";
  name: string;
  phone: string;
  memberId?: string;
}

export interface AgentInput {
  organizationId: string;
  channelId: string;
  commander: AgentCommanderContext;
  text: string;
}

export interface AgentResponse {
  handled: boolean;
  replyText: string;
  toolUsed?: string;
}

interface ChatTurn {
  role: "user" | "model";
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>;
}

/**
 * Loads recent conversation history from Redis to provide sliding-window conversational memory.
 */
async function loadConversationMemory(channelId: string, phone: string): Promise<ChatTurn[]> {
  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const key = `wacall:agent:memory:${channelId}:${cleanPhone}`;
    const raw = await redis.get(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(-8); // Keep last 4 user-model exchanges
    }
    return [];
  } catch (err: any) {
    log.warn({ err: err?.message }, "Failed to load conversation memory from Redis");
    return [];
  }
}

/**
 * Appends a new user-model turn to Redis memory with a 24-hour expiration.
 */
async function saveConversationMemory(
  channelId: string,
  phone: string,
  userText: string,
  modelText: string,
): Promise<void> {
  try {
    const cleanPhone = phone.replace(/\D/g, "");
    const key = `wacall:agent:memory:${channelId}:${cleanPhone}`;
    const history = await loadConversationMemory(channelId, phone);
    history.push(
      { role: "user", parts: [{ text: userText }] },
      { role: "model", parts: [{ text: modelText }] },
    );
    // Keep max 10 messages
    const trimmed = history.slice(-10);
    await redis.set(key, JSON.stringify(trimmed), "EX", 24 * 3600);
  } catch (err: any) {
    log.warn({ err: err?.message }, "Failed to save conversation memory to Redis");
  }
}

/**
 * Tool Declarations provided to Gemini.
 */
const AGENT_TOOL_DECLARATIONS = [
  {
    name: "list_tasks_by_date",
    description:
      "Fetches tasks categorized strictly into: 1. Overdue/Incomplete from past dates, 2. Today's Scheduled Tasks, 3. Upcoming Tasks. Call this whenever the user asks for 'today task', 'aaj ke task', 'pending kaam', 'schedule', 'agenda', or incomplete tasks.",
    parameters: {
      type: "OBJECT",
      properties: {
        filter: {
          type: "STRING",
          description: "Optional filter: 'TODAY', 'OVERDUE', 'UPCOMING', or 'ALL'",
        },
      },
    },
  },
  {
    name: "create_tasks",
    description:
      "Creates one or multiple tasks with due dates, priorities, assigned persons, and WhatsApp reminders. Use this when the user mentions tasks to do, e.g. morning message reply or 'Rahul ko call karna hai 2 baje'.",
    parameters: {
      type: "OBJECT",
      properties: {
        tasks: {
          type: "ARRAY",
          description: "List of tasks to create and schedule",
          items: {
            type: "OBJECT",
            properties: {
              title: { type: "STRING", description: "Clean concise task title" },
              dueTimeString: {
                type: "STRING",
                description:
                  "Natural language or ISO time string, e.g. 'आज 3 PM', 'कल सुबह 11 AM', '14:00', 'sham 6 baje'",
              },
              priority: {
                type: "STRING",
                description: "URGENT, HIGH, MEDIUM, or LOW",
              },
              assignedTo: {
                type: "STRING",
                description: "Name of team member to assign, or 'Me' for owner",
              },
              contactName: {
                type: "STRING",
                description: "Name of client or contact mentioned, if any",
              },
              contactPhone: {
                type: "STRING",
                description: "Phone number of client or contact, if any",
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "complete_task",
    description:
      "Marks one specific task or ALL tasks as completed/done. Use when the user says 'Done 1', 'pehla task ho gaya', 'aaj ke sabhi task mark done kar do', 'sara task complete ho gaya', etc.",
    parameters: {
      type: "OBJECT",
      properties: {
        taskIdentifier: {
          type: "STRING",
          description: "Index number (e.g. '1', '2'), task title snippet (e.g. 'Rahul'), or 'ALL'/'TODAY' for bulk completion",
        },
        all: {
          type: "BOOLEAN",
          description: "Set to true if user wants to mark all tasks or today's tasks as completed",
        },
        scope: {
          type: "STRING",
          description: "Optional scope when completing all tasks: 'ALL', 'TODAY', or 'OVERDUE'",
        },
      },
    },
  },
  {
    name: "get_call_summary",
    description: "Fetches today's call statistics: total calls, answered calls, missed calls, and duration.",
  },
  {
    name: "get_financial_summary",
    description: "Fetches financial summary: total pending payments, overdue invoices, and unpaid count.",
  },
  {
    name: "generate_quotation_or_invoice",
    description:
      "Generates an official commercial Quotation (कोटेशन) or Tax Invoice (इनवॉइस) PDF and optionally sends it directly to the client via WhatsApp. Use when the user says 'Sharma ji ko quotation bhejo', 'create invoice', or mentions billing amounts.",
    parameters: {
      type: "OBJECT",
      properties: {
        clientName: { type: "STRING", description: "Client or company name" },
        clientPhone: { type: "STRING", description: "Client's WhatsApp phone number" },
        kind: { type: "STRING", description: "'QUOTATION' or 'INVOICE'" },
        description: { type: "STRING", description: "Service or product description" },
        totalAmount: { type: "NUMBER", description: "Total amount in Rupees (e.g. 25000)" },
        notes: { type: "STRING", description: "Optional notes or terms" },
        sendToClient: { type: "BOOLEAN", description: "Whether to dispatch PDF to client WhatsApp now (default true)" },
      },
      required: ["clientName", "totalAmount"],
    },
  },
  {
    name: "manage_campaigns",
    description:
      "Inspects, starts, or pauses automated bulk calling / messaging campaigns. Use when user says 'campaign status', 'start campaign [name]', 'calling campaign shuru karo'.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "'LIST', 'START', or 'PAUSE'" },
        campaignName: { type: "STRING", description: "Name or ID of campaign to start or pause" },
      },
      required: ["action"],
    },
  },
  {
    name: "audit_team_performance",
    description:
      "Generates an executive team performance scorecard showing tasks completed today, pending tasks, and overdue tasks per employee. Use when user asks for 'team report', 'team performance', or asks about a specific staff member's progress.",
    parameters: {
      type: "OBJECT",
      properties: {
        memberName: { type: "STRING", description: "Optional employee name to filter for" },
      },
    },
  },
  {
    name: "trigger_outbound_call",
    description:
      "Initiates a direct outbound phone call to a client or contact through the PBX line. Use when user says 'Call Rahul', 'Is number par call lagao'.",
    parameters: {
      type: "OBJECT",
      properties: {
        targetPhone: { type: "STRING", description: "Target phone number to dial" },
        contactName: { type: "STRING", description: "Name of the person being called" },
      },
      required: ["targetPhone"],
    },
  },
  {
    name: "generate_creative_image",
    description:
      "Generates marketing posters, festival greetings, promotional creatives, or product flyers using AI, and delivers them directly to the user's WhatsApp. Use when user says 'poster bana do', 'Holi image create karo', 'promotional poster design karo', 'creative banao'.",
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: { type: "STRING", description: "Visual description or concept of the image/poster" },
        aspect: { type: "STRING", description: "'1:1' (Square), '9:16' (Story/Status), or '16:9' (Banner). Default '1:1'" },
        headlineText: { type: "STRING", description: "Optional headline text on the poster" },
        festivalName: { type: "STRING", description: "Optional festival name if relevant" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list_projects",
    description:
      "Lists active multi-member business projects, overall progress, health status, deadlines, and active next steps. Use when user asks 'project status', 'projects', 'active project dikhao', 'sharma ji ke project ka kya status hai'.",
    parameters: {
      type: "OBJECT",
      properties: {
        search: { type: "STRING", description: "Optional project code or client/title snippet to filter" },
      },
    },
  },
  {
    name: "log_project_update",
    description:
      "Logs a progress update, site report, milestone completion, or blocker into a project's living journey timeline. Use when user says 'Project PRJ-101 update: site measurement complete' or 'Sharma Residency ka 3D model ready ho gaya'.",
    parameters: {
      type: "OBJECT",
      properties: {
        projectIdentifier: { type: "STRING", description: "Project Code (e.g. 'PRJ-101') or title snippet (e.g. 'Sharma Residency')" },
        updateText: { type: "STRING", description: "The update details, what was accomplished, or blocker" },
        progressPercent: { type: "NUMBER", description: "Optional updated progress percentage (0 to 100)" },
        nextStep: { type: "STRING", description: "Optional next step or deliverable" },
        nextOwner: { type: "STRING", description: "Name of the person who has the baton next" },
      },
      required: ["projectIdentifier", "updateText"],
    },
  },
];

/**
 * Executes a tool called by the Agent.
 */
async function executeAgentTool(
  toolName: string,
  args: any,
  input: AgentInput,
  botName: string,
): Promise<{ result: any; fastResponse?: string }> {
  log.info({ toolName, args }, "Agent executing tool");

  // Enterprise RBAC: Fetch effective permissions for this commander member
  const perms = await getMemberPermissions(
    input.channelId,
    input.commander.memberId,
    input.commander.role,
  );

  switch (toolName) {
    case "list_tasks_by_date": {
      // If member does not have broad assignment permission and is not Owner, isolate to their own tasks
      const isRestrictedStaff = !perms.canAssignTasks && input.commander.role !== "OWNER";
      const categorized = await getTasksCategorized({
        organizationId: input.organizationId,
        assignedPhone: isRestrictedStaff ? input.commander.phone : null,
        assignedName: isRestrictedStaff ? input.commander.name : null,
        botName,
      });
      return {
        result: {
          overdueCount: categorized.overdue.length,
          todayCount: categorized.today.length,
          upcomingCount: categorized.upcoming.length,
          overdueTasks: categorized.overdue.map((t) => ({
            id: t.id,
            title: t.title,
            dueAt: t.dueAt,
            contactName: t.contactName,
            status: t.status,
          })),
          todayTasks: categorized.today.map((t) => ({
            id: t.id,
            title: t.title,
            dueAt: t.dueAt,
            priority: t.priority,
            contactName: t.contactName,
          })),
        },
        fastResponse: categorized.formattedSummary,
      };
    }

    case "create_tasks": {
      const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
      const createdItems: any[] = [];
      const now = new Date();

      for (const item of rawTasks) {
        let targetDue: Date;
        if (item.dueTimeString) {
          const parsed = fallbackRegexTaskParser(item.dueTimeString, now);
          targetDue = parsed.dueAt;
        } else {
          // Default to today evening or +2 hours
          targetDue = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        }

        createdItems.push({
          title: item.title,
          dueAt: targetDue,
          priority: item.priority || "MEDIUM",
          assignedTo: item.assignedTo || input.commander.name || "Me",
          assignedPhone: input.commander.phone,
          contactName: item.contactName || null,
          contactPhone: item.contactPhone || null,
          reminderOffsets: [0], // Remind at exact time
        });
      }

      const saved = await createMultipleTasks(input.organizationId, input.channelId, createdItems);

      let confirmCard = `✅ *${saved.length} कार्य सफलतापूर्वक शेड्यूल व रिमाइंडर सक्रिय!* 📌\n━━━━━━━━━━━━━━━━━━━━\n`;
      saved.forEach((t, i) => {
        const timeStr = t.dueAt
          ? new Date(t.dueAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Today";
        confirmCard += `${i + 1}. *${t.title}*\n   ⏰ समय: ${timeStr} | 🔔 अलर्ट सेट\n`;
      });
      confirmCard += `━━━━━━━━━━━━━━━━━━━━\nTenSy समय होने पर WhatsApp पर 1-टैप ऐक्शन के साथ सूचित करेगा!`;

      return {
        result: {
          createdCount: saved.length,
          tasks: saved.map((s) => ({ id: s.id, title: s.title, dueAt: s.dueAt })),
        },
        fastResponse: confirmCard,
      };
    }

    case "complete_task": {
      const identifier = String(args.taskIdentifier || "").trim();
      const num = parseInt(identifier, 10);
      const isRestrictedStaff = !perms.canAssignTasks && input.commander.role !== "OWNER";
      const identifierUpper = identifier.toUpperCase();
      const isBulk =
        args.all === true ||
        ["ALL", "TODAY", "OVERDUE", "SARA", "SARAA", "SABHI", "SAB", "EVERY", "सारा", "सभी", "सब", "पूरे"].some((k) =>
          identifierUpper.includes(k),
        );

      if (isBulk) {
        let scope: "ALL" | "TODAY" | "OVERDUE" = "ALL";
        if (args.scope) {
          scope = args.scope;
        } else if (identifierUpper.includes("TODAY") || identifierUpper.includes("AAJ") || identifierUpper.includes("आज")) {
          scope = "TODAY";
        } else if (identifierUpper.includes("OVERDUE") || identifierUpper.includes("PURANA") || identifierUpper.includes("पुराना")) {
          scope = "OVERDUE";
        }

        const res = await completeAllTasks({
          organizationId: input.organizationId,
          channelId: input.channelId,
          assignedPhone: isRestrictedStaff ? input.commander.phone : undefined,
          assignedName: isRestrictedStaff ? input.commander.name : undefined,
          scope,
        });

        if (res.completedCount === 0) {
          return {
            result: { completed: false, count: 0 },
            fastResponse: `ℹ️ आपके पास पूर्ण करने के लिए कोई पेंडिंग कार्य नहीं था। सब कुछ पहले से ही अप-टू-डेट है! ✨`,
          };
        }

        const taskBullets = res.tasks.map((t, idx) => `${idx + 1}. ~${t.title}~`).join("\n");
        const fastResponse = `✅ *सभी कार्य पूर्ण दर्ज किए गए (All Tasks Completed)!* 🎉
━━━━━━━━━━━━━━━━━━━━
📊 *कुल पूर्ण किए गए कार्य:* ${res.completedCount}
${taskBullets}

शानदार काम! आपके सभी कार्य सफलतापूर्वक पूर्ण (Completed) दर्ज कर दिए गए हैं। 🚀`;

        return {
          result: { completed: true, count: res.completedCount, tasks: res.tasks },
          fastResponse,
        };
      }

      // Find candidates for single task
      const candidates = await prisma.businessTask.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ["TODO", "IN_PROGRESS", "PENDING", "OVERDUE"] },
          ...(isRestrictedStaff ? { assignedPhone: input.commander.phone } : {}),
        },
        orderBy: { dueAt: "asc" },
        take: 15,
      });

      let targetTask: any = null;
      if (!isNaN(num) && num > 0 && num <= candidates.length) {
        targetTask = candidates[num - 1];
      } else if (identifier) {
        targetTask = candidates.find(
          (t) =>
            t.title.toLowerCase().includes(identifier.toLowerCase()) ||
            (t.contactName && t.contactName.toLowerCase().includes(identifier.toLowerCase())),
        );
      }

      if (!targetTask && candidates.length > 0) {
        targetTask = candidates[0]; // Complete first active task
      }

      if (targetTask) {
        await markTaskComplete(targetTask.id, input.organizationId);

        // Also approve any open PendingAction for this task
        await prisma.pendingAction.updateMany({
          where: {
            organizationId: input.organizationId,
            channelId: input.channelId,
            status: "PENDING",
            actionType: "TASK_REMINDER_ACTION",
          },
          data: { status: "APPROVED" },
        });

        return {
          result: { completed: true, title: targetTask.title },
          fastResponse: `✅ *कार्य पूर्ण हुआ (Marked DONE)!* 🎉\n━━━━━━━━━━━━━━━━━━━━\n📌 *टास्क:* ${targetTask.title}\nशानदार! इसे सिस्टम में पूर्ण (Completed) दर्ज कर दिया गया है।`,
        };
      }

      return {
        result: { completed: false, error: "No matching pending task found" },
        fastResponse: `⚠️ कोई पेंडिंग टास्क नहीं मिला जिसे पूरा किया जा सके। आप 'आज के टास्क' लिखकर वर्तमान लिस्ट देख सकते हैं।`,
      };
    }

    case "get_call_summary": {
      const metrics = await getTodayCallMetrics(input.organizationId, input.channelId);
      let callCard = `📞 *आज का कॉल रिपोर्ट:*
━━━━━━━━━━━━━━━━━━━━
• कुल कॉल्स: ${metrics.totalCalls}
• उत्तर दिए गए (Answered): ${metrics.answeredCount}
• मिस्ड कॉल्स: ${metrics.missedCount}
• बातचीत का समय: ${metrics.durationStr}`;
      return {
        result: metrics,
        fastResponse: callCard,
      };
    }

    case "get_financial_summary": {
      if (!perms.canViewFinance) {
        return {
          result: { forbidden: true, reason: "FINANCE_LOCKED" },
          fastResponse: `🔒 *फाइनेंशियल डेटा एक्सेस प्रतिबंधित है!*
━━━━━━━━━━━━━━━━━━━━
कंपनी की वित्तीय स्थिति और पेमेंट रिकॉर्ड्स देखने की अनुमति केवल एडमिन (Owner) अथवा अधिकृत एकाउंट्स टीम को है।`,
        };
      }
      const fin = await getPendingPaymentsSummary(input.organizationId);
      let finCard = `💰 *फाइनेंशियल स्थिति (Pending Payments):*
━━━━━━━━━━━━━━━━━━━━
• बकाया इनवॉइस: ${fin.totalCount}
• कुल बकाया राशि: ₹${fin.totalOutstanding.toLocaleString("en-IN")}
• अतिदेय (Overdue) राशि: ₹${fin.overdueAmount.toLocaleString("en-IN")}`;
      return {
        result: fin,
        fastResponse: finCard,
      };
    }

    case "generate_quotation_or_invoice": {
      if (!perms.canViewFinance) {
        return {
          result: { forbidden: true, reason: "INVOICE_LOCKED" },
          fastResponse: `🔒 *कोटेशन या इनवॉइस जारी करने की अनुमति नहीं है!*
━━━━━━━━━━━━━━━━━━━━
आधिकारिक बिलिंग अथवा कोटेशन केवल अधिकृत एडमिन/एकाउंट्स टीम द्वारा ही जनरेट किए जा सकते हैं।`,
        };
      }
      const clientName = args.clientName || "Client";
      const clientPhone = args.clientPhone || "";
      const kind = args.kind === "INVOICE" ? "INVOICE" : "QUOTATION";
      const description = args.description || "Commercial Order";
      const totalAmount = Number(args.totalAmount) || 0;
      const notes = args.notes || undefined;
      const sendToClient = args.sendToClient !== false;

      const createdDoc = await createInvoiceOrQuote({
        organizationId: input.organizationId,
        channelId: input.channelId,
        clientName,
        clientPhone,
        kind,
        items: [
          { description, quantity: 1, unitPrice: totalAmount, amount: totalAmount },
        ],
        total: totalAmount,
        subtotal: totalAmount,
        notes,
      });

      let clientDeliveryStatus = "📄 केवल ड्राफ्ट बनाया गया";
      if (sendToClient && clientPhone) {
        await sendInvoiceToClient(createdDoc.id).catch((err) =>
          log.warn({ err: err?.message }, "Failed to deliver invoice to client via WhatsApp"),
        );
        clientDeliveryStatus = `📨 क्लाइंट (${clientPhone}) को WhatsApp पर PDF भेज दिया गया`;
      }

      const docTypeName = kind === "INVOICE" ? "Tax Invoice (इनवॉइस)" : "Commercial Quotation (कोटेशन)";
      const pdfUrl = `https://wacall.in/api/v1/invoices/public/${createdDoc.id}/pdf`;

      const card = `✅ *${docTypeName} सफलतापूर्वक तैयार!* 📄\n━━━━━━━━━━━━━━━━━━━━\n📌 *नंबर:* ${createdDoc.invoiceNumber}\n👤 *क्लाइंट:* ${clientName}${clientPhone ? ` (${clientPhone})` : ""}\n💰 *कुल राशि:* ₹${totalAmount.toLocaleString("en-IN")}\n📝 *विवरण:* ${description}\n📊 *डिलीवरी:* ${clientDeliveryStatus}\n\n📥 *PDF डाउनलोड लिंक:*\n${pdfUrl}`;

      return {
        result: { id: createdDoc.id, number: createdDoc.invoiceNumber, total: totalAmount, pdfUrl },
        fastResponse: card,
      };
    }

    case "manage_campaigns": {
      if (!perms.canManageCampaigns) {
        return {
          result: { forbidden: true, reason: "CAMPAIGNS_LOCKED" },
          fastResponse: `🔒 *कैंपेन प्रबंधन प्रतिबंधित है!*
━━━━━━━━━━━━━━━━━━━━
बल्क कॉलिंग अथवा मैसेजिंग कैंपेन शुरू अथवा रोकने की अनुमति केवल एडमिन या मैनेजर्स को है।`,
        };
      }
      const action = (args.action || "LIST").toUpperCase();
      const campaignName = args.campaignName || "";

      if (action === "START" && campaignName) {
        const res = await startCampaignFromAgent(input.organizationId, campaignName);
        return { result: res, fastResponse: res.message };
      }

      if (action === "PAUSE" && campaignName) {
        const res = await pauseCampaignFromAgent(input.organizationId, campaignName);
        return { result: res, fastResponse: res.message };
      }

      const listCard = await listCampaignsForAgent(input.organizationId);
      return { result: { listed: true }, fastResponse: listCard };
    }

    case "audit_team_performance": {
      if (input.commander.role !== "OWNER" && input.commander.role !== "SALES_MANAGER" && !perms.canAssignTasks) {
        return {
          result: { forbidden: true, reason: "TEAM_AUDIT_LOCKED" },
          fastResponse: `🔒 *टीम रिपोर्ट केवल एडमिन व मैनेजर्स के लिए सुलभ है।*`,
        };
      }
      const memberName = args.memberName || null;
      const res = await getTeamPerformanceScorecard({
        organizationId: input.organizationId,
        channelId: input.channelId,
        filterMemberName: memberName,
      });
      return { result: res.members, fastResponse: res.formattedSummary };
    }

    case "trigger_outbound_call": {
      // Outbound call is locked by default for regular staff to prevent unauthorized calls
      if (!perms.canMakeCalls) {
        return {
          result: { forbidden: true, reason: "OUTBOUND_CALL_LOCKED" },
          fastResponse: `🔒 *कॉलिंग अनुमति नहीं है (Call Permission Locked)!*
━━━━━━━━━━━━━━━━━━━━
कंपनी सुरक्षा नियमों के अनुसार आपके नंबर पर सर्वर द्वारा सीधी आउटबाउंड कॉलिंग लॉक है।
यदि आपको क्लाइंट्स को सीधे कॉल करने की आवश्यकता है, तो कृपया एडमिन से संपर्क करके अपने प्रोफाइल पर *Calling Permission* सक्षम करवाएं।`,
        };
      }

      const targetPhone = args.targetPhone || "";
      const contactName = args.contactName || "Contact";
      if (!targetPhone) {
        return {
          result: { error: "No phone number provided" },
          fastResponse: `⚠️ कृपया कॉल लगाने के लिए 10 अंकों का मोबाइल नंबर प्रदान करें।`,
        };
      }

      const firstAi = await prisma.aiConfig.findFirst({
        where: { organizationId: input.organizationId },
      });

      const mode = firstAi ? "ai" : "live";
      try {
        const media = await prepareDialerMedia({
          organizationId: input.organizationId,
          mode,
          phone: targetPhone,
          contactName,
          aiConfigId: firstAi?.id,
        });

        const enq = await enqueueCall({
          organizationId: input.organizationId,
          channelId: input.channelId,
          phone: targetPhone,
          contactName,
          ...media,
        });

        return {
          result: { enqueued: true, callId: enq.call.id },
          fastResponse: `📞 *आउटबाउंड कॉल शुरू किया गया!* 🚀\n━━━━━━━━━━━━━━━━━━━━\n👤 *संपर्क:* ${contactName} (${targetPhone})\n🤖 *मोड:* ${mode === "ai" ? "AI Voice Agent" : "Live Line"}\n\nकॉल लाइन पर डायल हो रहा है।`,
        };
      } catch (callErr: any) {
        return {
          result: { error: callErr?.message },
          fastResponse: `📞 सीधे कॉल करने के लिए लिंक: tel:${targetPhone}\n\n(सर्वर डायल स्टेटस: ${callErr?.message || "लाइन कनेक्ट हो रही है"})`,
        };
      }
    }

    case "generate_creative_image": {
      if (!perms.canGenerateImages) {
        return {
          result: { forbidden: true, reason: "IMAGE_GEN_LOCKED" },
          fastResponse: `🔒 *AI पोस्टर/इमेज जेनरेशन अनुमति नहीं है!*
━━━━━━━━━━━━━━━━━━━━
संसाधन व ब्रांड सुरक्षा के तहत आपके नंबर पर AI इमेज जेनरेशन अक्षम है। कृपया एडमिन से एक्सेस का अनुरोध करें।`,
        };
      }

      const quota = await checkAndConsumeImageQuota(
        input.commander.memberId || input.commander.phone,
        perms.dailyImageQuota,
      );

      if (!quota.allowed) {
        return {
          result: { quotaExceeded: true },
          fastResponse: `⚠️ *दैनिक AI इमेज कोटा समाप्त!*
━━━━━━━━━━━━━━━━━━━━
आपकी आज की दैनिक सीमा (${perms.dailyImageQuota} इमेजेस) पूरी हो चुकी है।
यह कोटा कल सुबह रीसेट होगा।`,
        };
      }

      try {
        await createCreativeRequest({
          organizationId: input.organizationId,
          channelId: input.channelId,
          userInstruction: args.prompt,
          aspect: (args.aspect as any) || "1:1",
          headlineText: args.headlineText,
          festivalName: args.festivalName,
          notifyPhone: input.commander.phone,
        });

        const remainingText = perms.dailyImageQuota >= 900 ? "असीमित (Unlimited)" : `${quota.remaining} इमेजेस`;

        return {
          result: { queued: true, remainingQuota: quota.remaining },
          fastResponse: `🎨 *AI क्रिएटिव तैयार किया जा रहा है!* 🚀
━━━━━━━━━━━━━━━━━━━━
📌 *कॉन्सेप्ट:* ${args.prompt}
📐 *साइज:* ${args.aspect || "1:1"}
📊 *आज का बचा हुआ कोटा:* ${remainingText}

जैसे ही पोस्टर जनरेट होगा, आपको इसी WhatsApp चैट में हाई-क्वालिटी इमेज प्राप्त हो जाएगी!`,
        };
      } catch (err: any) {
        return {
          result: { error: err?.message },
          fastResponse: `⚠️ इमेज जेनरेशन में समस्या: ${err?.message || "कृपया थोड़ी देर बाद पुनः प्रयास करें"}`,
        };
      }
    }

    case "list_projects": {
      const projects = await getProjectsList(input.organizationId, { search: args.search });
      if (projects.length === 0) {
        return {
          result: { count: 0, projects: [] },
          fastResponse: `🏗️ *सक्रिय प्रोजेक्ट्स:*
━━━━━━━━━━━━━━━━━━━━
वर्तमान में कोई सक्रिय प्रोजेक्ट नहीं मिला। आप वेब पोर्टल पर नया प्रोजेक्ट शुरू कर सकते हैं!`,
        };
      }

      let card = `🏗️ *सक्रिय बिज़नेस प्रोजेक्ट्स (${projects.length}):*
━━━━━━━━━━━━━━━━━━━━\n`;
      projects.slice(0, 5).forEach((p, idx) => {
        const health = p.healthStatus === "ON_TRACK" ? "🟢 On-Track" : p.healthStatus === "AT_RISK" ? "🟡 At-Risk" : "🔴 Delayed";
        const deadline = p.targetDeadline
          ? new Date(p.targetDeadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
          : "Open";

        card += `*${idx + 1}. ${p.title}* (${p.projectCode})
• प्रगति: ${p.progressPercent}% | ${health}
• समय सीमा: ${deadline} | टीम: ${p.members.length} सदस्य
${p.nextStepAction ? `• अगला कदम: ${p.nextStepAction} (${p.nextStepOwner || "Team"})\n` : ""}\n`;
      });

      card += `अपडेट दर्ज करने के लिए लिखें: *"Project [कोड] update: [विवरण]"*`;
      return {
        result: { count: projects.length, projects },
        fastResponse: card.trim(),
      };
    }

    case "log_project_update": {
      const identifier = String(args.projectIdentifier || "").trim().toLowerCase();
      const allProjects = await prisma.businessProject.findMany({
        where: { organizationId: input.organizationId },
        include: { members: true },
      });

      const matched = allProjects.find(
        (p) =>
          p.projectCode.toLowerCase() === identifier ||
          p.title.toLowerCase().includes(identifier) ||
          (p.clientName && p.clientName.toLowerCase().includes(identifier)),
      );

      if (!matched) {
        return {
          result: { success: false, error: "PROJECT_NOT_FOUND" },
          fastResponse: `⚠️ '${args.projectIdentifier}' से संबंधित कोई प्रोजेक्ट नहीं मिला। कृपया सही प्रोजेक्ट कोड (उदा. PRJ-101) या नाम लिखें।`,
        };
      }

      const logEntry = await logProjectUpdate({
        organizationId: input.organizationId,
        projectId: matched.id,
        authorName: input.commander.name || "Team Member",
        authorPhone: input.commander.phone,
        authorRole: input.commander.role,
        updateText: args.updateText,
        source: "WHATSAPP",
        sentiment: "NEUTRAL",
        progressPercent: args.progressPercent,
        nextStepSuggested: args.nextStep,
        nextStepOwner: args.nextOwner,
        notifyNextOwnerOnWhatsApp: Boolean(args.nextOwner),
      });

      let confirmCard = `✅ *प्रोजेक्ट टाइमलाइन में दर्ज हुआ!* 🚀
━━━━━━━━━━━━━━━━━━━━
📌 *प्रोजेक्ट:* ${matched.title} (${matched.projectCode})
📝 *अपडेट:* ${args.updateText}`;

      if (args.progressPercent != null) {
        confirmCard += `\n📊 *प्रगति:* ${args.progressPercent}%`;
      }
      if (args.nextStep) {
        confirmCard += `\n🎯 *अगला कदम:* ${args.nextStep} (${args.nextOwner || "Next Owner"})`;
      }
      confirmCard += `\n\nयह अपडेट वेब पोर्टल के लाइव ऑडिट लॉग में सुरक्षित कर दिया गया है। ✨`;

      return {
        result: { success: true, logId: logEntry.id },
        fastResponse: confirmCard,
      };
    }

    default:
      return { result: { error: `Unknown tool: ${toolName}` } };
  }
}

/**
 * Main Autonomous Agent Runner.
 * Processes commander message, handles tools, conversation memory, and returns dynamic intelligent response.
 */
export async function runAutonomousAgent(input: AgentInput): Promise<AgentResponse> {
  const profile = await prisma.businessProfile.findFirst({
    where: { organizationId: input.organizationId },
    select: { businessName: true, assistantName: true },
  });

  const botName = profile?.assistantName || "TenSy";
  const businessName = profile?.businessName || "WaCall";

  const hasKey = await hasGeminiApiKey(input.organizationId).catch(() => false);
  const apiKey = hasKey ? await resolveGeminiApiKey(input.organizationId).catch(() => "") : "";

  // If Gemini API is not available, execute smart local routing
  if (!apiKey) {
    return handleLocalSmartRouting(input, botName);
  }

  // Calculate IST Date & Time Context
  const { istDateStr } = getIstDateBoundaries();
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istNow = new Date(Date.now() + istOffsetMs);
  const istTimeStr = `${String(istNow.getUTCHours()).padStart(2, "0")}:${String(istNow.getUTCMinutes()).padStart(2, "0")}`;
  const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][istNow.getUTCDay()];

  const systemInstruction = `
You are ${botName}, the high-level Executive AI Personal & Business Assistant for ${businessName}.
You are conversing directly with the Business Commander: ${input.commander.name} (${input.commander.role}).

CURRENT REFERENCE TIME (Asia/Kolkata IST):
- Today's Date: ${istDateStr} (${dayOfWeek})
- Current Time: ${istTimeStr} IST

CORE BEHAVIOR & RULES:
1. Speak naturally, professionally, and warmly in Hindi or Hinglish (clean devanagari / roman hindi).
2. DO NOT repeat canned greeting templates or static menu cards. Answer directly and perform actions.
3. If the user asks about today's tasks, pending work, schedule, or incomplete tasks, ALWAYS use the 'list_tasks_by_date' tool.
4. If the user lists tasks or agenda (especially morning replies e.g. "12 baje meeting, 3 baje call"), ALWAYS use 'create_tasks' to parse and schedule them.
5. If the user says a task is completed (e.g. "Done 1", "ho gaya"), use 'complete_task'.
6. If the user asks about call performance, use 'get_call_summary'.
7. If the user asks about payments, finance, or invoices, use 'get_financial_summary'.
8. If the user wants to generate or send a quotation/invoice (e.g. "Sharma ji ko 25000 ka quotation bhejo", "invoicing"), use 'generate_quotation_or_invoice'.
9. If the user asks about bulk campaigns, calling campaigns, or starting/pausing a campaign, use 'manage_campaigns'.
10. If the user asks for team performance, staff report, or how an employee is doing, use 'audit_team_performance'.
11. If the user asks to call someone (e.g. "Call Rahul", "Is number par call lagao"), use 'trigger_outbound_call'.
12. If the user asks for marketing posters, festival greetings, flyers, or images (e.g. "poster bana do", "Holi image create karo", "creative design karo"), use 'generate_creative_image'.
13. If a tool returns a clean formatted card (fastResponse), you can present or refine it elegantly. Keep answers crisp for WhatsApp readability.
`.trim();

  try {
    const memory = await loadConversationMemory(input.channelId, input.commander.phone);

    const contents: any[] = [...memory, { role: "user", parts: [{ text: input.text }] }];

    const reqBody = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      tools: [{ functionDeclarations: AGENT_TOOL_DECLARATIONS }],
      generationConfig: {
        temperature: 0.2,
      },
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn({ status: res.status, errText }, "Gemini agent call returned error, using fallback routing");
      return handleLocalSmartRouting(input, botName);
    }

    const data: any = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Check if Gemini invoked a tool
    const functionCallPart = parts.find((p: any) => p.functionCall);

    if (functionCallPart && functionCallPart.functionCall) {
      const call = functionCallPart.functionCall;
      const toolName = call.name;
      const toolArgs = call.args || {};

      const { result, fastResponse } = await executeAgentTool(toolName, toolArgs, input, botName);

      if (fastResponse) {
        // Save to memory
        await saveConversationMemory(input.channelId, input.commander.phone, input.text, fastResponse);
        return {
          handled: true,
          replyText: fastResponse,
          toolUsed: toolName,
        };
      }

      // If no fastResponse, feed function output back to Gemini to generate natural response
      const secondTurnContents = [
        ...contents,
        { role: "model", parts: [{ functionCall: call }] },
        {
          role: "function",
          parts: [{ functionResponse: { name: toolName, response: { output: result } } }],
        },
      ];

      const secondRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: secondTurnContents,
          }),
        },
      );

      if (secondRes.ok) {
        const secondData: any = await secondRes.json();
        const finalText = secondData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (finalText) {
          await saveConversationMemory(input.channelId, input.commander.phone, input.text, finalText);
          return { handled: true, replyText: finalText, toolUsed: toolName };
        }
      }
    }

    // Direct text response from Gemini (conversational question, explanation, etc.)
    const textPart = parts.find((p: any) => p.text);
    if (textPart && textPart.text) {
      const reply = textPart.text.trim();
      await saveConversationMemory(input.channelId, input.commander.phone, input.text, reply);
      return { handled: true, replyText: reply };
    }

    return handleLocalSmartRouting(input, botName);
  } catch (err: any) {
    log.error({ err: err?.message }, "Error in runAutonomousAgent");
    return handleLocalSmartRouting(input, botName);
  }
}

/**
 * High-precision local router when LLM is unavailable or for instant deterministic queries.
 */
async function handleLocalSmartRouting(input: AgentInput, botName: string): Promise<AgentResponse> {
  const upper = input.text.toUpperCase().trim();

  // 1. Task Completion Intent (PRIORITY: Must evaluate BEFORE task listing!)
  const isDoneIntent =
    upper.includes("DONE") ||
    upper.includes("MARK DONE") ||
    upper.includes("COMPLETE") ||
    upper.includes("COMPLETED") ||
    upper.includes("HO GAYA") ||
    upper.includes("HO GAYI") ||
    upper.includes("HO GYA") ||
    upper.includes("NIPTA") ||
    upper.includes("NIPAT GAYA") ||
    upper.includes("KHATAM") ||
    upper.includes("पूर्ण") ||
    upper.includes("पूरा") ||
    upper.includes("समाप्त") ||
    /^(\d+)\s*(DONE|HO GAYA|COMPLETE)?$/i.test(input.text.trim());

  if (isDoneIntent) {
    const isBulk =
      upper.includes("ALL") ||
      upper.includes("SARA") ||
      upper.includes("SARAA") ||
      upper.includes("SABHI") ||
      upper.includes("SAB") ||
      upper.includes("EVERY") ||
      upper.includes("सारा") ||
      upper.includes("सभी") ||
      upper.includes("सब") ||
      upper.includes("पूरे");

    const scope =
      upper.includes("TODAY") || upper.includes("AAJ") || upper.includes("आज")
        ? "TODAY"
        : upper.includes("OVERDUE") || upper.includes("PURANA") || upper.includes("पुराना")
        ? "OVERDUE"
        : "ALL";

    const { fastResponse } = await executeAgentTool(
      "complete_task",
      {
        taskIdentifier: isBulk ? "ALL" : input.text,
        all: isBulk,
        scope,
      },
      input,
      botName,
    );

    return {
      handled: true,
      replyText: fastResponse || "कार्य पूर्ण दर्ज कर दिया गया है।",
      toolUsed: "complete_task",
    };
  }

  // 2. Task Listing Query
  if (
    upper.includes("TASK") ||
    upper.includes("टास्क") ||
    upper.includes("AAJ KA") ||
    upper.includes("SCHEDULE") ||
    upper.includes("AGENDA") ||
    upper.includes("PENDING") ||
    upper.includes("KAM") ||
    upper.includes("KAAM")
  ) {
    const categorized = await getTasksCategorized({
      organizationId: input.organizationId,
      assignedPhone: input.commander.role !== "OWNER" ? input.commander.phone : null,
      assignedName: input.commander.role !== "OWNER" ? input.commander.name : null,
      botName,
    });
    return {
      handled: true,
      replyText: categorized.formattedSummary,
      toolUsed: "list_tasks_by_date",
    };
  }

  // 3. Call metrics
  if (upper.includes("CALL") || upper.includes("कॉल")) {
    const { fastResponse } = await executeAgentTool("get_call_summary", {}, input, botName);
    return { handled: true, replyText: fastResponse || "Call metrics loaded", toolUsed: "get_call_summary" };
  }

  // 4. Payment / Finance
  if (upper.includes("PAYMENT") || upper.includes("INVOICE") || upper.includes("HISAB") || upper.includes("पेमेंट")) {
    const { fastResponse } = await executeAgentTool("get_financial_summary", {}, input, botName);
    return { handled: true, replyText: fastResponse || "Financial summary loaded", toolUsed: "get_financial_summary" };
  }

  // 5. Campaign status or actions
  if (upper.includes("CAMPAIGN") || upper.includes("कैंपेन")) {
    let action = "LIST";
    if (upper.includes("START") || upper.includes("SHURU") || upper.includes("शुरू")) action = "START";
    if (upper.includes("PAUSE") || upper.includes("ROKO") || upper.includes("रोक")) action = "PAUSE";
    const { fastResponse } = await executeAgentTool("manage_campaigns", { action }, input, botName);
    return { handled: true, replyText: fastResponse || "Campaigns loaded", toolUsed: "manage_campaigns" };
  }

  // 6. Team performance report
  if (upper.includes("TEAM") || upper.includes("टीम") || upper.includes("STAFF") || upper.includes("PERFORMANCE")) {
    const { fastResponse } = await executeAgentTool("audit_team_performance", {}, input, botName);
    return { handled: true, replyText: fastResponse || "Team scorecard loaded", toolUsed: "audit_team_performance" };
  }

  // 7. Project Status & Supervision Intent
  if (
    upper.includes("PROJECT") ||
    upper.includes("प्रोजेक्ट") ||
    upper.includes("PRJ-")
  ) {
    if (
      upper.includes("UPDATE") ||
      upper.includes("STATUS UPDATE") ||
      upper.includes("KAAM HO GAYA") ||
      upper.includes("REPORT") ||
      upper.includes("COMPLETED") ||
      upper.includes("READY")
    ) {
      const codeMatch = input.text.match(/PRJ-\d+/i);
      const splitParts = input.text.split(/update/i);
      const code = codeMatch ? codeMatch[0].toUpperCase() : (splitParts[0] || input.text).trim();
      const textAfter = (splitParts[1] || input.text).trim();

      const { fastResponse } = await executeAgentTool(
        "log_project_update",
        { projectIdentifier: code, updateText: textAfter },
        input,
        botName,
      );
      return { handled: true, replyText: fastResponse || "Project update logged", toolUsed: "log_project_update" };
    }

    const { fastResponse } = await executeAgentTool("list_projects", {}, input, botName);
    return { handled: true, replyText: fastResponse || "Projects loaded", toolUsed: "list_projects" };
  }

  // 7. AI Poster / Image generation
  if (
    upper.includes("POSTER") ||
    upper.includes("पोस्टर") ||
    upper.includes("IMAGE") ||
    upper.includes("फोटो") ||
    upper.includes("CREATIVE") ||
    upper.includes("क्रिएटिव")
  ) {
    const { fastResponse } = await executeAgentTool(
      "generate_creative_image",
      { prompt: input.text, aspect: "1:1" },
      input,
      botName,
    );
    return {
      handled: true,
      replyText: fastResponse || "Poster request received",
      toolUsed: "generate_creative_image",
    };
  }

  // 8. Natural Conversational Greetings & Pleasantries (Avoids robotic template dump)
  if (
    upper.includes("HELLO") ||
    upper.includes("HI") ||
    upper.includes("HEY") ||
    upper.includes("NAMASTE") ||
    upper.includes("नमस्ते") ||
    upper.includes("PRANAM") ||
    upper.includes("GOOD MORNING") ||
    upper.includes("SHUBH PRABHAT")
  ) {
    return {
      handled: true,
      replyText: `नमस्ते ${input.commander.name || "सर"}! 🙏\nमैं आपका AI असिस्टेंट ${botName} तैयार हूँ। आज के मुख्य काम, कॉल्स या रिपोर्ट्स के लिए मुझे कभी भी बता सकते हैं।`,
    };
  }

  if (
    upper.includes("THANKS") ||
    upper.includes("THANK YOU") ||
    upper.includes("DHANYAWAD") ||
    upper.includes("SHUKRIYA") ||
    upper.includes("धन्यवाद") ||
    upper.includes("शुक्रिया")
  ) {
    return {
      handled: true,
      replyText: `आपका बहुत स्वागत है ${input.commander.name || "सर"}! 😊 किसी भी अन्य कार्य या सहायता के लिए मैं हमेशा उपलब्ध हूँ।`,
    };
  }

  if (
    upper === "OK" ||
    upper === "THIK HAI" ||
    upper === "THEEK HAI" ||
    upper === "ALRIGHT" ||
    upper === "ACHHA" ||
    upper === "SAHI HAI"
  ) {
    return {
      handled: true,
      replyText: `जी बिल्कुल! 👍 जब भी कोई निर्देश या कार्य हो, मुझे बताएं।`,
    };
  }

  // Default natural conversational response (supportive, respectful, NO canned repetitive template)
  const defaultReply = `जी ${input.commander.name || "सर"}, मैंने आपका संदेश समझ लिया है।\nयदि आपको आज के पेंडिंग टास्क देखने हैं, नया काम जोड़ना है, या रिपोर्ट चाहिए, तो मुझे बता सकते हैं। ✨`;

  return { handled: true, replyText: defaultReply };
}
