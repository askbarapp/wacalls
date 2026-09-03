ALTER TABLE "auto_reply_rules" ADD COLUMN IF NOT EXISTS "message_template_id" TEXT;
CREATE INDEX IF NOT EXISTS "auto_reply_rules_message_template_id_idx" ON "auto_reply_rules"("message_template_id");
ALTER TABLE "auto_reply_rules" DROP CONSTRAINT IF EXISTS "auto_reply_rules_message_template_id_fkey";
ALTER TABLE "auto_reply_rules"
  ADD CONSTRAINT "auto_reply_rules_message_template_id_fkey"
  FOREIGN KEY ("message_template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
