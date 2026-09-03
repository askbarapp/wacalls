ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "whatsapp_on" BOOLEAN;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "whatsapp_checked_at" TIMESTAMP(3);
