-- CreateTable: lead_routing_rules
CREATE TABLE IF NOT EXISTS "lead_routing_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "name" TEXT NOT NULL,
    "source_platform" TEXT NOT NULL DEFAULT 'FACEBOOK',
    "match_type" TEXT NOT NULL DEFAULT 'CONTAINS',
    "match_content" TEXT NOT NULL,
    "assign_type" TEXT NOT NULL DEFAULT 'USER',
    "assigned_user_id" TEXT,
    "assigned_group_jid" TEXT,
    "assigned_group_name" TEXT,
    "round_robin_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_assigned_index" INTEGER NOT NULL DEFAULT 0,
    "notify_group" BOOLEAN NOT NULL DEFAULT false,
    "notify_group_jid" TEXT,
    "notify_group_name" TEXT,
    "notify_assignee" BOOLEAN NOT NULL DEFAULT true,
    "auto_reply_customer" BOOLEAN NOT NULL DEFAULT false,
    "auto_reply_text" TEXT,
    "lead_tags" TEXT[] DEFAULT ARRAY['lead']::TEXT[],
    "lead_stage" TEXT NOT NULL DEFAULT 'NEW',
    "lead_value" DOUBLE PRECISION,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_routing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: lead_routing_logs
CREATE TABLE IF NOT EXISTS "lead_routing_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "phone" TEXT NOT NULL,
    "sender_name" TEXT,
    "incoming_text" TEXT NOT NULL,
    "assign_type" TEXT NOT NULL,
    "assigned_user_id" TEXT,
    "assigned_user_name" TEXT,
    "assigned_group_jid" TEXT,
    "assigned_group_name" TEXT,
    "notified_group_jid" TEXT,
    "notified_group_name" TEXT,
    "auto_replied" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_routing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_routing_rules_organization_id_enabled_idx" ON "lead_routing_rules"("organization_id", "enabled");
CREATE INDEX IF NOT EXISTS "lead_routing_rules_channel_id_idx" ON "lead_routing_rules"("channel_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_routing_logs_organization_id_created_at_idx" ON "lead_routing_logs"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "lead_routing_logs_phone_idx" ON "lead_routing_logs"("phone");
CREATE INDEX IF NOT EXISTS "lead_routing_logs_rule_id_idx" ON "lead_routing_logs"("rule_id");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_organization_id_fkey'
    ) THEN
        ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_channel_id_fkey'
    ) THEN
        ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_rules_assigned_user_id_fkey'
    ) THEN
        ALTER TABLE "lead_routing_rules" ADD CONSTRAINT "lead_routing_rules_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_logs_organization_id_fkey'
    ) THEN
        ALTER TABLE "lead_routing_logs" ADD CONSTRAINT "lead_routing_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_logs_rule_id_fkey'
    ) THEN
        ALTER TABLE "lead_routing_logs" ADD CONSTRAINT "lead_routing_logs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "lead_routing_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'lead_routing_logs_assigned_user_id_fkey'
    ) THEN
        ALTER TABLE "lead_routing_logs" ADD CONSTRAINT "lead_routing_logs_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
