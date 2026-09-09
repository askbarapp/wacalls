-- Align the earlier production chatbot tables (20260909120000) with the
-- current Prisma models. Idempotent so a database that already matches
-- 20260909180000 can apply this without errors.

-- ChatBot
ALTER TABLE "chat_bots" ADD COLUMN IF NOT EXISTS "ai_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "chat_bots" ADD COLUMN IF NOT EXISTS "opt_out_message" TEXT NOT NULL DEFAULT 'You are unsubscribed from WhatsApp replies. Send START to opt in again.';
ALTER TABLE "chat_bots" ADD COLUMN IF NOT EXISTS "unknown_handoff" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_bots' AND column_name = 'mode'
  ) THEN
    UPDATE "chat_bots" SET "ai_enabled" = ("mode"::text <> 'RULES');
  END IF;
END $$;

-- ChatKeyword
ALTER TABLE "chat_keywords" ADD COLUMN IF NOT EXISTS "organization_id" TEXT;
ALTER TABLE "chat_keywords" ADD COLUMN IF NOT EXISTS "trigger" TEXT;
ALTER TABLE "chat_keywords" ADD COLUMN IF NOT EXISTS "action" TEXT NOT NULL DEFAULT 'reply';

UPDATE "chat_keywords" k
SET "organization_id" = b."organization_id"
FROM "chat_bots" b
WHERE k."chat_bot_id" = b."id"
  AND (k."organization_id" IS NULL OR k."organization_id" = '');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_keywords' AND column_name = 'keyword'
  ) THEN
    UPDATE "chat_keywords" SET "trigger" = "keyword" WHERE "trigger" IS NULL OR "trigger" = '';
  END IF;
END $$;

UPDATE "chat_keywords" SET "trigger" = 'UNKNOWN' WHERE "trigger" IS NULL OR "trigger" = '';
ALTER TABLE "chat_keywords" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "chat_keywords" ALTER COLUMN "trigger" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_keywords' AND column_name = 'match_type'
      AND udt_name = 'ChatKeywordMatch'
  ) THEN
    ALTER TABLE "chat_keywords" ALTER COLUMN "match_type" DROP DEFAULT;
    ALTER TABLE "chat_keywords" ALTER COLUMN "match_type" TYPE TEXT USING lower("match_type"::text);
    ALTER TABLE "chat_keywords" ALTER COLUMN "match_type" SET DEFAULT 'exact';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_keywords_organization_id_fkey'
  ) THEN
    ALTER TABLE "chat_keywords"
      ADD CONSTRAINT "chat_keywords_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_keywords_organization_id_idx" ON "chat_keywords"("organization_id");
CREATE INDEX IF NOT EXISTS "chat_keywords_chat_bot_id_sort_order_idx" ON "chat_keywords"("chat_bot_id", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_keywords_chat_bot_id_trigger_match_type_key"
  ON "chat_keywords"("chat_bot_id", "trigger", "match_type");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_keywords' AND column_name = 'keyword'
  ) THEN
    ALTER TABLE "chat_keywords" ALTER COLUMN "keyword" DROP NOT NULL;
    ALTER TABLE "chat_keywords" ALTER COLUMN "keyword" DROP DEFAULT;
  END IF;
END $$;

-- ChatConversation
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "opt_out" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "assigned_user_id" TEXT;
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "last_inbound_at" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_conversations' AND column_name = 'bot_paused'
  ) THEN
    UPDATE "chat_conversations" SET "opt_out" = "bot_paused" WHERE "bot_paused" = true;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_conversations' AND column_name = 'chat_bot_id'
  ) THEN
    ALTER TABLE "chat_conversations" ALTER COLUMN "chat_bot_id" DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_assigned_user_id_fkey'
  ) THEN
    ALTER TABLE "chat_conversations"
      ADD CONSTRAINT "chat_conversations_assigned_user_id_fkey"
      FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_conversations_organization_id_status_idx"
  ON "chat_conversations"("organization_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "chat_conversations_organization_id_channel_id_phone_key"
  ON "chat_conversations"("organization_id", "channel_id", "phone");

-- ChatMessage
DO $$
BEGIN
  CREATE TYPE "ChatMessageDirection" AS ENUM ('IN', 'OUT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "direction" "ChatMessageDirection";
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "keyword_id" TEXT;
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "external_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'sender'
  ) THEN
    UPDATE "chat_messages"
    SET "direction" = CASE
      WHEN lower("sender") IN ('user', 'in', 'inbound', 'contact') THEN 'IN'::"ChatMessageDirection"
      ELSE 'OUT'::"ChatMessageDirection"
    END
    WHERE "direction" IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'whatsapp_id'
  ) THEN
    UPDATE "chat_messages"
    SET "external_id" = "whatsapp_id"
    WHERE "external_id" IS NULL AND "whatsapp_id" IS NOT NULL;
  END IF;
END $$;

UPDATE "chat_messages" SET "direction" = 'OUT' WHERE "direction" IS NULL;
ALTER TABLE "chat_messages" ALTER COLUMN "direction" SET NOT NULL;

UPDATE "chat_messages" SET "source" = 'whatsapp' WHERE "source" IS NULL OR "source" = '';
ALTER TABLE "chat_messages" ALTER COLUMN "source" SET DEFAULT 'whatsapp';
ALTER TABLE "chat_messages" ALTER COLUMN "source" SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_messages' AND column_name = 'sender'
  ) THEN
    ALTER TABLE "chat_messages" ALTER COLUMN "sender" DROP NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "chat_messages_organization_id_created_at_idx"
  ON "chat_messages"("organization_id", "created_at");
