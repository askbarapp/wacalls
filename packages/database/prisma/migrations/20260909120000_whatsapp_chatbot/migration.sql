-- CreateEnum
CREATE TYPE "ChatBotMode" AS ENUM ('RULES', 'AI', 'HYBRID');

-- CreateEnum
CREATE TYPE "ChatConversationStatus" AS ENUM ('OPEN', 'HANDOFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChatKeywordMatch" AS ENUM ('EXACT', 'CONTAINS');

-- CreateTable
CREATE TABLE "chat_bots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "ChatBotMode" NOT NULL DEFAULT 'HYBRID',
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT,
    "knowledge_base_id" TEXT,
    "ai_config_id" TEXT,
    "welcome_message" TEXT NOT NULL DEFAULT 'Hi! How can we help you today?',
    "fallback_message" TEXT NOT NULL DEFAULT 'Thanks for your message. A team member will reply shortly.',
    "handoff_message" TEXT NOT NULL DEFAULT 'Connecting you to a human agent. Please wait.',
    "system_prompt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_keywords" (
    "id" TEXT NOT NULL,
    "chat_bot_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "match_type" "ChatKeywordMatch" NOT NULL DEFAULT 'EXACT',
    "campaign_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "chat_bot_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" "ChatConversationStatus" NOT NULL DEFAULT 'OPEN',
    "bot_paused" BOOLEAN NOT NULL DEFAULT false,
    "welcome_sent" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT,
    "whatsapp_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_bots_channel_id_key" ON "chat_bots"("channel_id");

-- CreateIndex
CREATE INDEX "chat_bots_organization_id_idx" ON "chat_bots"("organization_id");

-- CreateIndex
CREATE INDEX "chat_keywords_chat_bot_id_enabled_idx" ON "chat_keywords"("chat_bot_id", "enabled");

-- CreateIndex
CREATE INDEX "chat_conversations_organization_id_last_message_at_idx" ON "chat_conversations"("organization_id", "last_message_at");

-- CreateIndex
CREATE INDEX "chat_conversations_channel_id_phone_idx" ON "chat_conversations"("channel_id", "phone");

-- CreateIndex
CREATE INDEX "chat_conversations_chat_bot_id_status_idx" ON "chat_conversations"("chat_bot_id", "status");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_idx" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_organization_id_idx" ON "chat_messages"("organization_id");

-- CreateIndex
CREATE INDEX "chat_messages_whatsapp_id_idx" ON "chat_messages"("whatsapp_id");

-- AddForeignKey
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_bots" ADD CONSTRAINT "chat_bots_ai_config_id_fkey" FOREIGN KEY ("ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_keywords" ADD CONSTRAINT "chat_keywords_chat_bot_id_fkey" FOREIGN KEY ("chat_bot_id") REFERENCES "chat_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_keywords" ADD CONSTRAINT "chat_keywords_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_chat_bot_id_fkey" FOREIGN KEY ("chat_bot_id") REFERENCES "chat_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
