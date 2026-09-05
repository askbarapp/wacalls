-- AlterTable
ALTER TABLE "contact_memories" ADD COLUMN IF NOT EXISTS "opt_out" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "contact_memories_updated_at_idx" ON "contact_memories"("updated_at");

-- CreateTable
CREATE TABLE IF NOT EXISTS "intent_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "ai_config_id" TEXT,
    "call_id" TEXT,
    "phone" TEXT,
    "intent" TEXT NOT NULL,
    "action" TEXT,
    "utterance" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intent_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intent_events_organization_id_created_at_idx" ON "intent_events"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "intent_events_organization_id_intent_idx" ON "intent_events"("organization_id", "intent");
CREATE INDEX IF NOT EXISTS "intent_events_ai_config_id_idx" ON "intent_events"("ai_config_id");

DO $$ BEGIN
  ALTER TABLE "intent_events"
    ADD CONSTRAINT "intent_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
