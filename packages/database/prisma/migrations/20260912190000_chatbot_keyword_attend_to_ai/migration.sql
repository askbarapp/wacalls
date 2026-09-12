-- Add Attend to AI routing columns to chat_keywords
ALTER TABLE "chat_keywords" ADD COLUMN IF NOT EXISTS "target_ai_config_id" TEXT;
ALTER TABLE "chat_keywords" ADD COLUMN IF NOT EXISTS "target_knowledge_base_id" TEXT;

-- Add active_ai_config_id to chat_conversations
ALTER TABLE "chat_conversations" ADD COLUMN IF NOT EXISTS "active_ai_config_id" TEXT;

-- Foreign key constraints if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_keywords_target_ai_config_id_fkey'
  ) THEN
    ALTER TABLE "chat_keywords" ADD CONSTRAINT "chat_keywords_target_ai_config_id_fkey" 
      FOREIGN KEY ("target_ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_keywords_target_knowledge_base_id_fkey'
  ) THEN
    ALTER TABLE "chat_keywords" ADD CONSTRAINT "chat_keywords_target_knowledge_base_id_fkey" 
      FOREIGN KEY ("target_knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chat_conversations_active_ai_config_id_fkey'
  ) THEN
    ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_active_ai_config_id_fkey" 
      FOREIGN KEY ("active_ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL;
  END IF;
END $$;
