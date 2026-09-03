-- AlterTable
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "transcript" JSONB;
