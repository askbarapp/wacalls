-- CreateTable: follow_up_cadences
CREATE TABLE IF NOT EXISTS "follow_up_cadences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "contact_phone" TEXT NOT NULL,
    "contact_name" TEXT,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "context" TEXT,
    "voice_ai_config_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_cadences_pkey" PRIMARY KEY ("id")
);

-- CreateTable: business_invoices
CREATE TABLE IF NOT EXISTS "business_invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "client_name" TEXT NOT NULL,
    "client_phone" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'QUOTATION',
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "amount_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "due_date" TIMESTAMP(3),
    "notes" TEXT,
    "pdf_path" TEXT,
    "reminders_sent" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_invoices_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys for follow_up_cadences
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_up_cadences_organization_id_fkey') THEN
        ALTER TABLE "follow_up_cadences" ADD CONSTRAINT "follow_up_cadences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_up_cadences_channel_id_fkey') THEN
        ALTER TABLE "follow_up_cadences" ADD CONSTRAINT "follow_up_cadences_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_up_cadences_conversation_id_fkey') THEN
        ALTER TABLE "follow_up_cadences" ADD CONSTRAINT "follow_up_cadences_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follow_up_cadences_voice_ai_config_id_fkey') THEN
        ALTER TABLE "follow_up_cadences" ADD CONSTRAINT "follow_up_cadences_voice_ai_config_id_fkey" FOREIGN KEY ("voice_ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Foreign Keys for business_invoices
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_invoices_organization_id_fkey') THEN
        ALTER TABLE "business_invoices" ADD CONSTRAINT "business_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_invoices_channel_id_fkey') THEN
        ALTER TABLE "business_invoices" ADD CONSTRAINT "business_invoices_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_invoices_conversation_id_fkey') THEN
        ALTER TABLE "business_invoices" ADD CONSTRAINT "business_invoices_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "follow_up_cadences_organization_id_status_idx" ON "follow_up_cadences"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "follow_up_cadences_channel_id_idx" ON "follow_up_cadences"("channel_id");
CREATE INDEX IF NOT EXISTS "follow_up_cadences_next_run_at_status_idx" ON "follow_up_cadences"("next_run_at", "status");

CREATE INDEX IF NOT EXISTS "business_invoices_organization_id_status_idx" ON "business_invoices"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "business_invoices_channel_id_idx" ON "business_invoices"("channel_id");
CREATE INDEX IF NOT EXISTS "business_invoices_due_date_idx" ON "business_invoices"("due_date");
