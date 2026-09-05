-- AlterTable
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "max_call_duration_sec" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "wrap_up_sec" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "intent_playbook" JSONB;

-- CreateTable
CREATE TABLE IF NOT EXISTS "contact_memories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "summary" TEXT,
    "facts" JSONB,
    "last_intent" TEXT,
    "last_outcome" TEXT,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "last_call_at" TIMESTAMP(3),
    "last_call_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_memories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_memories_organization_id_phone_key" ON "contact_memories"("organization_id", "phone");
CREATE INDEX IF NOT EXISTS "contact_memories_organization_id_idx" ON "contact_memories"("organization_id");
CREATE INDEX IF NOT EXISTS "contact_memories_phone_idx" ON "contact_memories"("phone");

DO $$ BEGIN
  ALTER TABLE "contact_memories"
    ADD CONSTRAINT "contact_memories_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
