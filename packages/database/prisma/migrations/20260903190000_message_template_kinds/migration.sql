ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "header" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "footer" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "media_path" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "media_mime" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "buttons" JSONB;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "list_button" TEXT;
ALTER TABLE "message_templates" ADD COLUMN IF NOT EXISTS "sections" JSONB;
