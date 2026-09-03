-- CreateEnum
CREATE TYPE "AutoReplyTrigger" AS ENUM ('ANSWERED', 'NO_ANSWER', 'REJECTED', 'NOT_CONNECTED');

-- CreateTable
CREATE TABLE "auto_reply_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "name" TEXT NOT NULL,
    "trigger" "AutoReplyTrigger" NOT NULL,
    "body" TEXT NOT NULL,
    "image_path" TEXT,
    "image_mime" TEXT,
    "delay_seconds" INTEGER NOT NULL DEFAULT 3,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 1440,
    "show_typing" BOOLEAN NOT NULL DEFAULT true,
    "typing_seconds" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_reply_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auto_reply_sends" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_reply_sends_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auto_reply_rules_organization_id_enabled_idx" ON "auto_reply_rules"("organization_id", "enabled");
CREATE INDEX "auto_reply_rules_organization_id_trigger_idx" ON "auto_reply_rules"("organization_id", "trigger");
CREATE INDEX "auto_reply_rules_campaign_id_idx" ON "auto_reply_rules"("campaign_id");
CREATE INDEX "auto_reply_sends_rule_id_phone_created_at_idx" ON "auto_reply_sends"("rule_id", "phone", "created_at");
CREATE UNIQUE INDEX "auto_reply_sends_rule_id_call_id_key" ON "auto_reply_sends"("rule_id", "call_id");

ALTER TABLE "auto_reply_rules" ADD CONSTRAINT "auto_reply_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auto_reply_rules" ADD CONSTRAINT "auto_reply_rules_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auto_reply_sends" ADD CONSTRAINT "auto_reply_sends_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "auto_reply_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
