ALTER TABLE "campaigns" ADD COLUMN "message_template_id" TEXT;

CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_templates_organization_id_idx" ON "message_templates"("organization_id");

ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_message_template_id_fkey" FOREIGN KEY ("message_template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
