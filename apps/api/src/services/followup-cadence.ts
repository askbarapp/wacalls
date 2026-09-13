import pino from "pino";
import { prisma } from "@wacalls/database";
import { normalizePhone } from "@wacalls/shared";
import { sendWhatsAppText } from "./messaging.js";
import { whatsappClient } from "./whatsapp-client.js";
import { enqueueCall } from "./calls.js";

const log = pino({ name: "followup-cadence" });

export interface EnrollCadenceInput {
  organizationId: string;
  channelId: string;
  conversationId?: string | null;
  contactPhone: string;
  contactName?: string | null;
  context?: string | null;
  voiceAiConfigId?: string | null;
  /** Optional delay in minutes for step 1 (defaults to 240 = 4 hours) */
  initialDelayMinutes?: number;
}

/**
 * Enrolls a lead or quotation recipient into the 3-step Follow-up Cadence (+4h, +24h, +3d Call).
 */
export async function enrollInCadence(input: EnrollCadenceInput) {
  const phoneParsed = normalizePhone(input.contactPhone);
  const normalizedPhone = phoneParsed.ok ? phoneParsed.e164 : input.contactPhone;

  // Cancel any prior active cadence for this contact
  await prisma.followUpCadence.updateMany({
    where: {
      organizationId: input.organizationId,
      contactPhone: normalizedPhone,
      status: "ACTIVE",
    },
    data: { status: "CANCELLED" },
  });

  const delayMs = (input.initialDelayMinutes ?? 240) * 60 * 1000;
  const nextRunAt = new Date(Date.now() + delayMs);

  const cadence = await prisma.followUpCadence.create({
    data: {
      organizationId: input.organizationId,
      channelId: input.channelId,
      conversationId: input.conversationId || null,
      contactPhone: normalizedPhone,
      contactName: input.contactName || null,
      stage: 1,
      status: "ACTIVE",
      nextRunAt,
      context: input.context || null,
      voiceAiConfigId: input.voiceAiConfigId || null,
    },
  });

  log.info(
    { cadenceId: cadence.id, phone: normalizedPhone, nextRunAt },
    "enrolled lead into follow-up cadence",
  );

  return cadence;
}

/**
 * Automatically cancels any active cadence when a customer sends a message.
 */
export async function cancelActiveCadenceOnReply(organizationId: string, rawPhone: string) {
  const phoneParsed = normalizePhone(rawPhone);
  const normalizedPhone = phoneParsed.ok ? phoneParsed.e164 : rawPhone;

  const result = await prisma.followUpCadence.updateMany({
    where: {
      organizationId,
      contactPhone: normalizedPhone,
      status: "ACTIVE",
    },
    data: { status: "REPLIED" },
  });

  if (result.count > 0) {
    log.info({ phone: normalizedPhone, cancelledCount: result.count }, "cancelled active cadence due to customer reply");
  }
}

/**
 * Background worker tick: processes due cadence steps.
 */
export async function processCadenceTick() {
  const now = new Date();

  // Pick up to 20 due active cadences
  const dueList = await prisma.followUpCadence.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { lte: now },
    },
    include: {
      channel: { select: { id: true, displayName: true, status: true, ownerPhone: true } },
      organization: { select: { id: true, name: true } },
      voiceAiConfig: { select: { id: true, name: true } },
    },
    take: 20,
  });

  for (const item of dueList) {
    try {
      const nameGreeting = item.contactName ? `${item.contactName} जी` : "जी";

      if (item.stage === 1) {
        // Step 1: +4 Hours Gentle WhatsApp Nudge
        const msg = [
          `नमस्ते ${nameGreeting}, आशा है आप सकुशल हैं।`,
          ``,
          `क्या आपको हमारे पिछले संदेश / प्रस्ताव को देखने का समय मिला? यदि आपका कोई प्रश्न या आवश्यकता हो तो कृपया यहाँ निसंकोच बताएं।`,
          ``,
          `— ${item.organization.name}`,
        ].join("\n");

        await sendWhatsAppText({
          organizationId: item.organizationId,
          channelId: item.channelId,
          phone: item.contactPhone,
          body: msg,
          chatSource: "followup_cadence_step1",
        });

        // Advance to Stage 2 (+20 hours = 24 hours total)
        await prisma.followUpCadence.update({
          where: { id: item.id },
          data: {
            stage: 2,
            nextRunAt: new Date(Date.now() + 20 * 3600 * 1000),
          },
        });
        log.info({ cadenceId: item.id, step: 1 }, "executed cadence step 1");
      } else if (item.stage === 2) {
        // Step 2: +24 Hours Value-add Reminder
        const msg = [
          `नमस्ते ${nameGreeting},`,
          ``,
          `हम यह सुनिश्चित करना चाहते थे कि आपकी आवश्यकता के अनुसार आपको सर्वोत्तम समाधान और जानकारी मिल सके।`,
          ``,
          `क्या हम इस पर 5 मिनट संक्षिप्त चर्चा या कॉल कर सकते हैं? आप अपनी सुविधा अनुसार उपयुक्त समय बता सकते हैं।`,
          ``,
          `— ${item.organization.name}`,
        ].join("\n");

        await sendWhatsAppText({
          organizationId: item.organizationId,
          channelId: item.channelId,
          phone: item.contactPhone,
          body: msg,
          chatSource: "followup_cadence_step2",
        });

        // Advance to Stage 3 (+48 hours = 72 hours / 3 days total)
        await prisma.followUpCadence.update({
          where: { id: item.id },
          data: {
            stage: 3,
            nextRunAt: new Date(Date.now() + 48 * 3600 * 1000),
          },
        });
        log.info({ cadenceId: item.id, step: 2 }, "executed cadence step 2");
      } else if (item.stage === 3) {
        // Step 3: +3 Days Autonomous AI Voice Call
        log.info({ cadenceId: item.id, phone: item.contactPhone }, "triggering 3-day follow-up AI voice call");

        // Resolve AI agent for the call
        let aiConfigId: string | undefined = item.voiceAiConfigId || undefined;
        if (!aiConfigId) {
          const defaultAgent = await prisma.aiConfig.findFirst({
            where: { organizationId: item.organizationId },
            select: { id: true },
          });
          aiConfigId = defaultAgent?.id || undefined;
        }

        if (aiConfigId) {
          await enqueueCall({
            organizationId: item.organizationId,
            channelId: item.channelId,
            phone: item.contactPhone,
            contactName: item.contactName || undefined,
            aiConfigId,
            mode: "ai",
            source: "dialer",
          }).catch((err) => log.warn({ err: err.message }, "enqueueCall for cadence failed"));
        }

        // Mark cadence completed
        await prisma.followUpCadence.update({
          where: { id: item.id },
          data: {
            status: "COMPLETED",
          },
        });

        // Notify owner on WhatsApp
        if (item.channel.ownerPhone) {
          const ownerMsg = `📞 *WaCall Cadence Alert:*\n${item.contactName || item.contactPhone} को 3-Day Follow-up AI Voice Call लगाया गया है।`;
          await sendWhatsAppText({
            organizationId: item.organizationId,
            channelId: item.channelId,
            phone: item.channel.ownerPhone,
            body: ownerMsg,
            chatSource: "cadence_owner_alert",
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      log.warn({ err, cadenceId: item.id }, "failed to process cadence step");
    }
  }
}
