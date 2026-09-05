-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "max_call_duration_sec" INTEGER;
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "memory_recall_mode" TEXT NOT NULL DEFAULT 'related_only';
