-- Add greeting fields to chat_bots
ALTER TABLE "chat_bots" ADD COLUMN IF NOT EXISTS "greeting_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "chat_bots" ADD COLUMN IF NOT EXISTS "greeting_message" TEXT NOT NULL DEFAULT 'नमस्ते! WaCalls में आपका स्वागत है। हम आपकी क्या सहायता कर सकते हैं?';
ALTER TABLE "chat_bots" ADD COLUMN IF NOT EXISTS "greeting_cooldown_days" INTEGER NOT NULL DEFAULT 14;

-- Add last_greeting_at to chat_conversations
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "last_greeting_at" TIMESTAMP(3);
