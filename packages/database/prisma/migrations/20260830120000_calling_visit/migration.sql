CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "target_phone" TEXT NOT NULL,
    "button_label" TEXT NOT NULL DEFAULT 'Call now',
    "greeting" TEXT NOT NULL DEFAULT 'Talk to us on WhatsApp',
    "purposes" TEXT[] DEFAULT ARRAY['Sales', 'Support', 'Partnership', 'Other']::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visits_public_key_key" ON "visits"("public_key");
CREATE INDEX "visits_organization_id_idx" ON "visits"("organization_id");
CREATE INDEX "visits_channel_id_idx" ON "visits"("channel_id");

CREATE TABLE "visit_leads" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "message_id" TEXT,
    "call_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_leads_visit_id_idx" ON "visit_leads"("visit_id");
CREATE INDEX "visit_leads_organization_id_idx" ON "visit_leads"("organization_id");
CREATE INDEX "visit_leads_created_at_idx" ON "visit_leads"("created_at");

ALTER TABLE "visits" ADD CONSTRAINT "visits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_leads" ADD CONSTRAINT "visit_leads_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_leads" ADD CONSTRAINT "visit_leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
