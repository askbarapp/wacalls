ALTER TABLE "plans" ADD COLUMN "max_knowledge_bases" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "plans" ADD COLUMN "max_ai_agents" INTEGER NOT NULL DEFAULT 1;

UPDATE "plans" SET "max_knowledge_bases" = 1, "max_ai_agents" = 1 WHERE "slug" = 'starter';
UPDATE "plans" SET "max_knowledge_bases" = 2, "max_ai_agents" = 3 WHERE "slug" = 'growth';
UPDATE "plans" SET "max_knowledge_bases" = 4, "max_ai_agents" = 8 WHERE "slug" = 'business';

ALTER TABLE "campaigns" ADD COLUMN "rotation_limit" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "campaign_channels" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaign_channels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_channels_campaign_id_channel_id_key" ON "campaign_channels"("campaign_id", "channel_id");
CREATE INDEX "campaign_channels_channel_id_idx" ON "campaign_channels"("channel_id");

ALTER TABLE "campaign_channels" ADD CONSTRAINT "campaign_channels_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaign_channels" ADD CONSTRAINT "campaign_channels_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "campaign_channels" ("id", "campaign_id", "channel_id", "sort_order")
SELECT gen_random_uuid()::text, "id", "channel_id", 0 FROM "campaigns";
