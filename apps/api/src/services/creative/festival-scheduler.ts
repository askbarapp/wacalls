import pino from "pino";
import { prisma } from "@wacalls/database";
import { createCreativeRequest } from "./creative-service.js";

const log = pino({ name: "festival-scheduler" });

export interface SeedFestivalItem {
  name: string;
  festivalDate: Date;
  triggerDaysBefore: number;
  creativeType: "poster" | "banner" | "status";
  language: string;
  defaultPrompt: string;
}

/**
 * Standard Indian festivals & national days for auto-pilot generation.
 */
export const STANDARD_FESTIVALS: Omit<SeedFestivalItem, "festivalDate">[] = [
  {
    name: "Navratri",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Auspicious Navratri festival poster with vibrant traditional colors, divine festive aura, dandiya raas silhouettes and joyous celebration.",
  },
  {
    name: "Dussehra",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Grand Vijayadashami Dussehra poster celebrating victory of good over evil with majestic golden bow and arrow, festive lights and triumph greetings.",
  },
  {
    name: "Karwa Chauth",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Traditional Karwa Chauth festive poster with glowing full moon, traditional puja thali, sieve, diya lamps and heartfelt marital blessings.",
  },
  {
    name: "Dhanteras",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Prosperous Dhanteras festival poster with shimmering gold coins, kalash, diya lamps, wealth and auspicious blessings for all customers.",
  },
  {
    name: "Diwali",
    triggerDaysBefore: 3,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Magnificent Diwali festival of lights poster with radiant glowing oil lamps, traditional rangoli, golden sparkles and warm prosperity wishes.",
  },
  {
    name: "Govardhan Puja",
    triggerDaysBefore: 1,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Auspicious Govardhan Puja and Annakut celebration poster with traditional sacred elements, floral decorations and festive devotion.",
  },
  {
    name: "Bhai Dooj",
    triggerDaysBefore: 1,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Loving Bhai Dooj festival poster celebrating sacred sibling bond with traditional tilak thali, sweets and joyous celebratory atmosphere.",
  },
  {
    name: "Chhath Puja",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Sacred Chhath Puja festival poster with radiant rising sun, river bank arghya offering, traditional bamboo soop and divine morning glow.",
  },
  {
    name: "Guru Nanak Jayanti",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Peaceful Prakash Utsav Guru Nanak Jayanti poster with Golden Temple illumination, ik onkar symbol, divine light and peaceful harmony wishes.",
  },
  {
    name: "Christmas",
    triggerDaysBefore: 3,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Festive Christmas celebration poster with sparkling Xmas tree, golden baubles, snowflakes, warm holiday lights and season greetings.",
  },
  {
    name: "New Year",
    triggerDaysBefore: 3,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Grand Happy New Year celebration poster with glittering champagne gold fireworks, elegant typography, luxury celebration vibes and success wishes.",
  },
  {
    name: "Makar Sankranti / Pongal",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Vibrant Makar Sankranti and Pongal harvest poster with colorful sky kites, sugarcane, clay pot, harvest blessings and warm wishes.",
  },
  {
    name: "Republic Day",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Proud Indian Republic Day 26 January poster with radiant saffron, white and green tricolor flag waves, Ashok Chakra and patriotic pride.",
  },
  {
    name: "Maha Shivratri",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Divine Maha Shivratri festival poster with sacred trishul, damru, glowing crescent moon, meditation aura and Har Har Mahadev blessings.",
  },
  {
    name: "Holi",
    triggerDaysBefore: 3,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Joyous colorful Holi festival poster with splashing organic gulal powders in air, joyful festive radiance, pichkari and cheerful wishes.",
  },
  {
    name: "Eid ul-Fitr",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Blessed Eid Mubarak celebration poster with glowing crescent moon, illuminated mosque minarets, lantern light and warm peace greetings.",
  },
  {
    name: "Raksha Bandhan",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Warm Raksha Bandhan festival poster with embellished designer rakhi thread, sweets thali, celebration colors and heartfelt sibling wishes.",
  },
  {
    name: "Independence Day",
    triggerDaysBefore: 3,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Vibrant 15th August Independence Day poster with soaring Indian tricolor flag, patriotic glory, peace doves and national pride.",
  },
  {
    name: "Ganesh Chaturthi",
    triggerDaysBefore: 2,
    creativeType: "poster",
    language: "Hindi + English",
    defaultPrompt: "Divine Ganesh Chaturthi festival poster with auspicious Lord Ganesha silhouette, modak sweets, festive marigold flowers and Ganpati Bappa Morya.",
  },
];

/**
 * Seeds or updates upcoming festival calendar in database.
 */
export async function seedStandardFestivals(): Promise<{ seeded: number; updated: number }> {
  let seeded = 0;
  let updated = 0;

  // Approximate relative dates for 2026/2027 calendar
  const currentYear = new Date().getFullYear();

  const festivalDates: Record<string, { month: number; day: number }> = {
    "Navratri": { month: 9, day: 20 },
    "Dussehra": { month: 9, day: 30 },
    "Karwa Chauth": { month: 10, day: 10 },
    "Dhanteras": { month: 10, day: 28 },
    "Diwali": { month: 10, day: 31 },
    "Govardhan Puja": { month: 11, day: 1 },
    "Bhai Dooj": { month: 11, day: 2 },
    "Chhath Puja": { month: 11, day: 6 },
    "Guru Nanak Jayanti": { month: 11, day: 15 },
    "Christmas": { month: 11, day: 25 },
    "New Year": { month: 0, day: 1 },
    "Makar Sankranti / Pongal": { month: 0, day: 14 },
    "Republic Day": { month: 0, day: 26 },
    "Maha Shivratri": { month: 1, day: 26 },
    "Holi": { month: 2, day: 14 },
    "Eid ul-Fitr": { month: 2, day: 30 },
    "Independence Day": { month: 7, day: 15 },
    "Raksha Bandhan": { month: 7, day: 28 },
    "Ganesh Chaturthi": { month: 8, day: 14 },
  };

  for (const item of STANDARD_FESTIVALS) {
    const config = festivalDates[item.name];
    if (!config) continue;

    let targetYear = currentYear;
    // If month is earlier in the year, project into current or next year
    const testDate = new Date(targetYear, config.month, config.day, 0, 0, 0);
    if (testDate.getTime() < Date.now() - 30 * 24 * 3600 * 1000) {
      targetYear += 1;
    }

    const festivalDate = new Date(Date.UTC(targetYear, config.month, config.day, 0, 0, 0));

    const existing = await prisma.festival.findFirst({
      where: { name: item.name },
    });

    if (existing) {
      await prisma.festival.update({
        where: { id: existing.id },
        data: {
          festivalDate,
          triggerDaysBefore: item.triggerDaysBefore,
          defaultPrompt: item.defaultPrompt,
          active: true,
        },
      });
      updated++;
    } else {
      await prisma.festival.create({
        data: {
          name: item.name,
          festivalDate,
          triggerDaysBefore: item.triggerDaysBefore,
          creativeType: item.creativeType,
          language: item.language,
          defaultPrompt: item.defaultPrompt,
          active: true,
        },
      });
      seeded++;
    }
  }

  log.info({ seeded, updated }, "Seeded standard festivals calendar");
  return { seeded, updated };
}

/**
 * Executes a single run of the Festival Autopilot Ticker.
 * Checks upcoming active festivals and initiates creative generation for all eligible accounts.
 */
export async function runFestivalAutopilotTick(): Promise<{
  triggered: number;
  skipped: number;
  errors: number;
}> {
  const now = new Date();
  log.info("Running Festival Autopilot tick...");

  let triggered = 0;
  let skipped = 0;
  let errors = 0;

  // 1. Fetch all active festivals
  const festivals = await prisma.festival.findMany({
    where: { active: true },
  });

  if (festivals.length === 0) {
    log.info("No active festivals configured in database");
    return { triggered, skipped, errors };
  }

  for (const fest of festivals) {
    const festDate = new Date(fest.festivalDate);
    const diffMs = festDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (24 * 3600 * 1000));

    // Check if within the trigger window (e.g. exactly triggerDaysBefore or 0 to triggerDaysBefore days away)
    const isDue = diffDays >= 0 && diffDays <= fest.triggerDaysBefore;
    if (!isDue) {
      continue;
    }

    log.info({ festival: fest.name, diffDays, triggerDaysBefore: fest.triggerDaysBefore }, "Festival is due for autopilot trigger");

    // 2. Find all connected channels
    const channels = await prisma.whatsAppChannel.findMany({
      where: { status: "CONNECTED" },
      include: { organization: true },
    });

    for (const channel of channels) {
      try {
        // Check feature entitlement (festival_autopilot)
        const entitlement = await prisma.featureEntitlement.findFirst({
          where: {
            organizationId: channel.organizationId,
            channelId: channel.id,
            feature: "festival_autopilot",
          },
        });

        if (entitlement && !entitlement.enabled) {
          skipped++;
          continue;
        }

        // Strict Idempotency Check: Don't trigger twice for same channel + festival + date!
        const existingCampaign = await prisma.festivalCampaign.findUnique({
          where: {
            organizationId_channelId_festivalId_festivalDate: {
              organizationId: channel.organizationId,
              channelId: channel.id,
              festivalId: fest.id,
              festivalDate: fest.festivalDate,
            },
          },
        });

        if (existingCampaign) {
          skipped++;
          continue;
        }

        // Create campaign record in SCHEDULED / GENERATING status
        const campaign = await prisma.festivalCampaign.create({
          data: {
            organizationId: channel.organizationId,
            channelId: channel.id,
            festivalId: fest.id,
            festivalDate: fest.festivalDate,
            status: "GENERATING",
          },
        });

        const notifyPhone = channel.ownerPhone || channel.phoneNumber || undefined;

        // Trigger creative generation with rich festive prompt
        const promptInstruction = fest.defaultPrompt || `${fest.name} festive marketing poster celebrating auspicious blessings`;

        const res = await createCreativeRequest({
          organizationId: channel.organizationId,
          channelId: channel.id,
          festivalName: fest.name,
          userInstruction: promptInstruction,
          creativeType: (fest.creativeType as any) || "poster",
          aspect: "1:1",
          notifyPhone,
        });

        await prisma.festivalCampaign.update({
          where: { id: campaign.id },
          data: {
            creativeAssetId: res.assetId,
            status: "READY",
            sentAt: new Date(),
          },
        });

        triggered++;
        log.info({ channelId: channel.id, festival: fest.name, assetId: res.assetId }, "Festival autopilot creative triggered successfully");
      } catch (channelErr: any) {
        errors++;
        log.error({ channelId: channel.id, festival: fest.name, err: channelErr?.message }, "Failed to run festival autopilot for channel");
      }
    }
  }

  return { triggered, skipped, errors };
}

let tickerTimer: NodeJS.Timeout | null = null;

/**
 * Starts the periodic background cron ticker (runs every hour to check IST scheduled triggers).
 */
export function startFestivalAutopilotScheduler(): void {
  if (tickerTimer) return;

  // Run initial seed if empty
  void prisma.festival.count().then((count) => {
    if (count === 0) {
      void seedStandardFestivals();
    }
  });

  // Run once on startup after 15 seconds
  setTimeout(() => {
    void runFestivalAutopilotTick();
  }, 15000);

  // Run every 60 minutes
  tickerTimer = setInterval(() => {
    void runFestivalAutopilotTick();
  }, 60 * 60 * 1000);

  log.info("Festival Autopilot scheduler started (hourly ticker)");
}
