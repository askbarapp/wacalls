-- WaCall OS: Business Assistant migration

-- 1. WhatsApp Channel ownerPhone
ALTER TABLE "whatsapp_channels" ADD COLUMN IF NOT EXISTS "owner_phone" TEXT;

-- 2. Chat Conversation Work Classification
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "work_category" TEXT;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "lead_stage" TEXT;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "intent" TEXT;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "sentiment" TEXT;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "deal_value" DOUBLE PRECISION;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "summary" TEXT;

-- 3. Business Tasks
CREATE TABLE IF NOT EXISTS "business_tasks" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assigned_to" TEXT,
  "contact_phone" TEXT,
  "contact_name" TEXT,
  "due_at" TIMESTAMP(3),
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL DEFAULT 'owner_command',
  "amount" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "business_tasks_pkey" PRIMARY KEY ("id")
);

-- 4. Pending Actions (Ask First Loop)
CREATE TABLE IF NOT EXISTS "pending_actions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "action_type" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys & Indexes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_tasks_organization_id_fkey') THEN
    ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_tasks_channel_id_fkey') THEN
    ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_channel_id_fkey"
      FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_tasks_conversation_id_fkey') THEN
    ALTER TABLE "business_tasks" ADD CONSTRAINT "business_tasks_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_actions_organization_id_fkey') THEN
    ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_actions_channel_id_fkey') THEN
    ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_channel_id_fkey"
      FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_actions_conversation_id_fkey') THEN
    ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_conversation_id_fkey"
      FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "business_tasks_organization_id_status_idx" ON "business_tasks"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "business_tasks_channel_id_idx" ON "business_tasks"("channel_id");
CREATE INDEX IF NOT EXISTS "business_tasks_due_at_idx" ON "business_tasks"("due_at");

CREATE INDEX IF NOT EXISTS "pending_actions_organization_id_status_idx" ON "pending_actions"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "pending_actions_channel_id_idx" ON "pending_actions"("channel_id");
