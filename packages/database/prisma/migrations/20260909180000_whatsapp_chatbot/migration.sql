-- CreateEnum
CREATE TYPE "ChatConversationStatus" AS ENUM ('OPEN', 'HANDOFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatMessageDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "chat_bots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ai_config_id" TEXT,
    "knowledge_base_id" TEXT,
    "fallback_message" TEXT NOT NULL DEFAULT 'Thanks for your message. A teammate will get back to you shortly.',
    "opt_out_message" TEXT NOT NULL DEFAULT 'You are unsubscribed from WhatsApp replies. Send START to opt in again.',
    "handoff_message" TEXT NOT NULL DEFAULT 'Connecting you with a teammate. You can keep messaging here.',
    "unknown_handoff" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_bots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_keywords" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "chat_bot_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "match_type" TEXT NOT NULL DEFAULT 'exact',
    "reply" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'reply',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_keywords_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "phone" TEXT NOT NULL,
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'OPEN',
    "opt_out" BOOLEAN NOT NULL DEFAULT false,
    "assigned_user_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "ChatMessageDirection" NOT NULL,
    "source" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "keyword_id" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_bots_channel_id_key" ON "chat_bots"("channel_id");
CREATE INDEX "chat_bots_organization_id_idx" ON "chat_bots"("organization_id");
CREATE INDEX "chat_keywords_organization_id_idx" ON "chat_keywords"("organization_id");
CREATE INDEX "chat_keywords_chat_bot_id_sort_order_idx" ON "chat_keywords"("chat_bot_id", "sort_order");
CREATE UNIQUE INDEX "chat_keywords_chat_bot_id_trigger_match_type_key" ON "chat_keywords"("chat_bot_id", "trigger", "match_type");
CREATE UNIQUE INDEX "chat_conversations_organization_id_channel_id_phone_key" ON "chat_conversations"("organization_id", "channel_id", "phone");
CREATE INDEX "chat_conversations_organization_id_last_message_at_idx" ON "chat_conversations"("organization_id", "last_message_at");
CREATE INDEX "chat_conversations_organization_id_status_idx" ON "chat_conversations"("organization_id", "status");
CREATE INDEX "chat_conversations_channel_id_idx" ON "chat_conversations"("channel_id");
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");
CREATE INDEX "chat_messages_organization_id_created_at_idx" ON "chat_messages"("organization_id", "created_at");

ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_ai_config_id_fkey" FOREIGN KEY ("ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_keywords" ADD CONSTRAINT "chat_keywords_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_keywords" ADD CONSTRAINT "chat_keywords_chat_bot_id_fkey" FOREIGN KEY ("chat_bot_id") REFERENCES "chat_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
