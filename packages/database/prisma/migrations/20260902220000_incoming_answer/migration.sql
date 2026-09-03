CREATE TABLE "incoming_answer_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ai_config_id" TEXT,
    "send_message" BOOLEAN NOT NULL DEFAULT false,
    "message_body" TEXT,
    "message_when" TEXT NOT NULL DEFAULT 'answered',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_answer_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "incoming_answer_configs_channel_id_key" ON "incoming_answer_configs"("channel_id");
CREATE INDEX "incoming_answer_configs_organization_id_idx" ON "incoming_answer_configs"("organization_id");

ALTER TABLE "incoming_answer_configs" ADD CONSTRAINT "incoming_answer_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incoming_answer_configs" ADD CONSTRAINT "incoming_answer_configs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incoming_answer_configs" ADD CONSTRAINT "incoming_answer_configs_ai_config_id_fkey" FOREIGN KEY ("ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
