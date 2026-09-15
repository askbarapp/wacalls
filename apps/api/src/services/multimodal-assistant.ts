import pino from "pino";
import { prisma } from "@wacalls/database";
import { normalizePhone } from "@wacalls/shared";
import { SarvamClient } from "@wacalls/audio-engine";
import { resolveSarvamApiKey, resolveGeminiApiKey, hasSarvamApiKey, hasGeminiApiKey } from "./sarvam-key.js";
import { sendWhatsAppText } from "./messaging.js";
import { handleOwnerCommand } from "./business-assistant.js";

const log = pino({ name: "multimodal-assistant" });

export interface VisionExtractionResult {
  category: "VISITING_CARD" | "INVOICE_BILL" | "HANDWRITTEN_NOTE" | "GENERAL";
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  designation?: string;
  address?: string;
  totalAmount?: number;
  items?: string;
  dueDate?: string;
  tasks?: string[];
  summary: string;
}

/**
 * Transcribe voice note buffer into text using Sarvam STT, falling back to Gemini STT.
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  mimeType: string,
  organizationId: string,
): Promise<string> {
  // 1. Try Sarvam STT first
  if (await hasSarvamApiKey(organizationId)) {
    try {
      const apiKey = await resolveSarvamApiKey(organizationId);
      const client = new SarvamClient(apiKey);
      const res = await client.transcribe(buffer, "hi-IN");
      if (res.transcript && res.transcript.trim()) {
        log.info({ transcript: res.transcript }, "Sarvam STT transcribed audio");
        return res.transcript.trim();
      }
    } catch (err: any) {
      log.warn({ err: err?.message }, "Sarvam STT failed, falling back to Gemini STT");
    }
  }

  // 2. Fallback to Gemini STT
  if (await hasGeminiApiKey(organizationId)) {
    try {
      const apiKey = await resolveGeminiApiKey(organizationId);
      const effectiveMime = mimeType && mimeType.includes("ogg") ? "audio/ogg" : "audio/wav";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: "Transcribe this WhatsApp voice note audio accurately into text. Return ONLY the spoken words (in Hindi, English, or Hinglish as spoken), with no introductory text or commentary.",
                  },
                  {
                    inlineData: {
                      mimeType: effectiveMime,
                      data: buffer.toString("base64"),
                    },
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
          }),
        },
      );

      if (res.ok) {
        const json = (await res.json()) as any;
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        if (text) {
          log.info({ text }, "Gemini STT transcribed audio");
          return text;
        }
      }
    } catch (err: any) {
      log.error({ err: err?.message }, "Gemini STT transcription error");
    }
  }

  return "";
}

/**
 * Analyze an image with Gemini 2.5 Flash Vision to extract visiting cards, receipts, or notes.
 */
export async function analyzeImageWithVision(
  buffer: Buffer,
  mimeType: string,
  organizationId: string,
  caption?: string,
): Promise<VisionExtractionResult | null> {
  const apiKey = await resolveGeminiApiKey(organizationId).catch(() => "");
  if (!apiKey) {
    log.warn("Gemini API key missing; cannot perform Vision OCR");
    return null;
  }

  const prompt = `You are a high-accuracy document & image analyzer for an executive WhatsApp Business Assistant.
Examine this image carefully. Caption if provided: "${caption || ""}".

Categorize the image into one of:
1. "VISITING_CARD" (Business card, personal card, contact slip)
2. "INVOICE_BILL" (Payment receipt, GST bill, estimate, invoice, handwritten bill)
3. "HANDWRITTEN_NOTE" (To-do list, meeting notes, action items)
4. "GENERAL" (Any other photo)

Return ONLY valid JSON adhering strictly to this schema:
{
  "category": "VISITING_CARD" | "INVOICE_BILL" | "HANDWRITTEN_NOTE" | "GENERAL",
  "name": "Extracted contact person name or null",
  "phone": "Extracted phone number with country code if available or null",
  "email": "Extracted email address or null",
  "company": "Company or business name or null",
  "designation": "Designation/title or null",
  "address": "Physical office address or null",
  "totalAmount": 12345 (number or null for invoices/bills),
  "items": "Summary of items/services or null",
  "dueDate": "Due date in YYYY-MM-DD format or null",
  "tasks": ["Task 1", "Task 2"] (array of strings or null for notes),
  "summary": "Short 1-line description of what this image shows"
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: mimeType || "image/jpeg",
                    data: buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            maxOutputTokens: 800,
          },
        }),
      },
    );

    if (!res.ok) {
      log.error({ status: res.status }, "Gemini Vision API error");
      return null;
    }

    const data = (await res.json()) as any;
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    if (!rawJson) return null;

    const parsed = JSON.parse(rawJson) as VisionExtractionResult;
    return parsed;
  } catch (err: any) {
    log.error({ err: err?.message }, "Vision OCR analysis exception");
    return null;
  }
}

/**
 * Handles incoming voice note from the business owner / commander.
 */
export async function handleVoiceNoteFromCommander(input: {
  channelId: string;
  phone: string;
  audioBuffer: Buffer;
  mimeType: string;
  messageId?: string;
}): Promise<boolean> {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: input.channelId },
  });
  if (!channel) return false;

  log.info({ phone: input.phone }, "Transcribing voice note from commander");
  const transcript = await transcribeAudioBuffer(input.audioBuffer, input.mimeType, channel.organizationId);

  if (!transcript) {
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: "⚠️ Voice note समझ नहीं आया या ऑडियो अस्पष्ट है। कृपया दोबारा बोलें या लिखकर भेजें।",
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // Notify owner what was heard
  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: input.phone,
    body: `🎙️ *Voice Command Received:*\n_"${transcript}"_\n\n⏳ Processing...`,
    chatSource: "bot",
  }).catch(() => undefined);

  // Route directly into the NLP commander command engine
  const handled = await handleOwnerCommand({
    channelId: channel.id,
    phone: input.phone,
    text: transcript,
    messageId: input.messageId,
  });

  if (!handled) {
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: `✅ सुना: *"${transcript}"*\n(लेकिन इसके लिए कोई specific command match नहीं हुआ। "आज के काम", "Hot leads", या "Call [नाम]" बोलें)`,
      chatSource: "bot",
    }).catch(() => undefined);
  }

  return true;
}

/**
 * Handles incoming photo / image from the business owner / commander (Visiting card, Bill, Notes).
 */
export async function handleImageFromCommander(input: {
  channelId: string;
  phone: string;
  imageBuffer: Buffer;
  mimeType: string;
  caption?: string;
  messageId?: string;
}): Promise<boolean> {
  const channel = await prisma.whatsAppChannel.findUnique({
    where: { id: input.channelId },
  });
  if (!channel) return false;

  log.info({ phone: input.phone }, "Analyzing photo from commander with Gemini Vision");
  const result = await analyzeImageWithVision(
    input.imageBuffer,
    input.mimeType,
    channel.organizationId,
    input.caption,
  );

  if (!result) {
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: "⚠️ फोटो को scan नहीं किया जा सका। कृपया साफ़ फोटो भेजें या Gemini API key चेक करें।",
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // 1. VISITING CARD
  if (result.category === "VISITING_CARD" && (result.name || result.phone)) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.pendingAction.create({
      data: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        actionType: "SAVE_CONTACT",
        summary: `Save Contact & Lead: ${result.name || "Contact"} (${result.company || "Company"})`,
        payload: {
          name: result.name || "New Contact",
          phone: result.phone || "",
          email: result.email || "",
          company: result.company || "",
          designation: result.designation || "",
          address: result.address || "",
        },
        expiresAt,
      },
    });

    const card = `📇 *WaCall Assistant — Visiting Card Detected*
👤 *Name:* ${result.name || "N/A"}
📞 *Phone:* ${result.phone || "N/A"}
🏢 *Company:* ${result.company || "N/A"}
💼 *Role:* ${result.designation || "N/A"}${result.email ? `\n✉️ *Email:* ${result.email}` : ""}

👉 Reply *"YES"* to save contact & create follow-up task, or *"NO"* to cancel.`;

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: card,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // 2. INVOICE / BILL
  if (result.category === "INVOICE_BILL" && result.totalAmount) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.pendingAction.create({
      data: {
        organizationId: channel.organizationId,
        channelId: channel.id,
        actionType: "RECORD_EXPENSE",
        summary: `Bill/Invoice: ₹${result.totalAmount} for ${result.items || result.name || "Items"}`,
        payload: {
          vendorName: result.name || result.company || "Vendor",
          amount: result.totalAmount,
          items: result.items || "Purchase",
          dueDate: result.dueDate,
        },
        expiresAt,
      },
    });

    const card = `🧾 *WaCall Assistant — Bill / Invoice Scanned*
🏢 *Party:* ${result.name || result.company || "Vendor"}
💰 *Total Amount:* ₹${result.totalAmount.toLocaleString("en-IN")}
📦 *Details:* ${result.items || "Items"}${result.dueDate ? `\n📅 *Due Date:* ${result.dueDate}` : ""}

👉 Reply *"YES"* to save task & record, or *"NO"* to cancel.`;

    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: card,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // 3. HANDWRITTEN / ACTION NOTES
  if (result.category === "HANDWRITTEN_NOTE" && result.tasks && result.tasks.length > 0) {
    for (const t of result.tasks.slice(0, 5)) {
      await prisma.businessTask.create({
        data: {
          organizationId: channel.organizationId,
          channelId: channel.id,
          title: t,
          priority: "HIGH",
          status: "PENDING",
          source: "photo_ocr",
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    const taskList = result.tasks.map((t, idx) => `${idx + 1}. ${t}`).join("\n");
    await sendWhatsAppText({
      organizationId: channel.organizationId,
      channelId: channel.id,
      phone: input.phone,
      body: `📝 *WaCall Assistant — Tasks Extracted from Notes:*\n\n${taskList}\n\n✅ Added to your Business Tasks!`,
      chatSource: "bot",
    }).catch(() => undefined);
    return true;
  }

  // 4. GENERAL SUMMARY
  await sendWhatsAppText({
    organizationId: channel.organizationId,
    channelId: channel.id,
    phone: input.phone,
    body: `📷 *Photo Received:*\n${result.summary || "Image scanned"}\n\n(No visiting card or bill detected)`,
    chatSource: "bot",
  }).catch(() => undefined);

  return true;
}
