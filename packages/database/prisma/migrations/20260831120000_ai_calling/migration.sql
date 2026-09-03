-- AlterEnum
ALTER TYPE "CampaignType" ADD VALUE IF NOT EXISTS 'TTS';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "voice_template_id" TEXT;

-- AlterTable
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "knowledge_base_id" TEXT;
ALTER TABLE "ai_configs" ALTER COLUMN "provider" SET DEFAULT 'sarvam';
ALTER TABLE "ai_configs" ALTER COLUMN "model" SET DEFAULT 'sarvam-105b-conversations';
ALTER TABLE "ai_configs" ALTER COLUMN "voice" SET DEFAULT 'shubh';
ALTER TABLE "ai_configs" ALTER COLUMN "language" SET DEFAULT 'hi-IN';

-- CreateTable
CREATE TABLE IF NOT EXISTS "voice_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'hi-IN',
    "speaker" TEXT NOT NULL DEFAULT 'shubh',
    "pace" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "knowledge_bases" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "knowledge_base_documents" (
    "id" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_base_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "voice_templates_organization_id_idx" ON "voice_templates"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "knowledge_bases_organization_id_idx" ON "knowledge_bases"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "knowledge_base_documents_knowledge_base_id_idx" ON "knowledge_base_documents"("knowledge_base_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_configs_knowledge_base_id_idx" ON "ai_configs"("knowledge_base_id");

DO $$ BEGIN
  ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_voice_template_id_fkey" FOREIGN KEY ("voice_template_id") REFERENCES "voice_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "voice_templates" ADD CONSTRAINT "voice_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "knowledge_base_documents" ADD CONSTRAINT "knowledge_base_documents_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
