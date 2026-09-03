ALTER TABLE "visits" ADD COLUMN "chat_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "visits" ADD COLUMN "call_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "visits" ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "visits" ADD COLUMN "ai_config_id" TEXT;
ALTER TABLE "visits" ALTER COLUMN "button_label" SET DEFAULT 'Chat with us';

CREATE INDEX "visits_ai_config_id_idx" ON "visits"("ai_config_id");

ALTER TABLE "visits" ADD CONSTRAINT "visits_ai_config_id_fkey" FOREIGN KEY ("ai_config_id") REFERENCES "ai_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "visit_departments" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_departments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_departments_visit_id_idx" ON "visit_departments"("visit_id");
CREATE INDEX "visit_departments_organization_id_idx" ON "visit_departments"("organization_id");
CREATE INDEX "visit_departments_channel_id_idx" ON "visit_departments"("channel_id");

CREATE TABLE "visit_sessions" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "current_url" TEXT NOT NULL DEFAULT '',
    "current_title" TEXT NOT NULL DEFAULT '',
    "referrer" TEXT NOT NULL DEFAULT '',
    "user_agent" TEXT NOT NULL DEFAULT '',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "visit_sessions_visit_id_session_key_key" ON "visit_sessions"("visit_id", "session_key");
CREATE INDEX "visit_sessions_visit_id_last_seen_at_idx" ON "visit_sessions"("visit_id", "last_seen_at");
CREATE INDEX "visit_sessions_organization_id_idx" ON "visit_sessions"("organization_id");

CREATE TABLE "visit_page_views" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_page_views_visit_id_created_at_idx" ON "visit_page_views"("visit_id", "created_at");
CREATE INDEX "visit_page_views_session_id_idx" ON "visit_page_views"("session_id");

CREATE TABLE "visit_conversations" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_conversations_visit_id_last_message_at_idx" ON "visit_conversations"("visit_id", "last_message_at");
CREATE INDEX "visit_conversations_organization_id_idx" ON "visit_conversations"("organization_id");
CREATE INDEX "visit_conversations_channel_id_phone_idx" ON "visit_conversations"("channel_id", "phone");
CREATE INDEX "visit_conversations_session_id_idx" ON "visit_conversations"("session_id");

CREATE TABLE "visit_chat_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "whatsapp_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visit_chat_messages_conversation_id_created_at_idx" ON "visit_chat_messages"("conversation_id", "created_at");
CREATE INDEX "visit_chat_messages_organization_id_idx" ON "visit_chat_messages"("organization_id");

ALTER TABLE "visit_departments" ADD CONSTRAINT "visit_departments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_departments" ADD CONSTRAINT "visit_departments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_departments" ADD CONSTRAINT "visit_departments_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visit_sessions" ADD CONSTRAINT "visit_sessions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_sessions" ADD CONSTRAINT "visit_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_sessions" ADD CONSTRAINT "visit_sessions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "visit_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "visit_page_views" ADD CONSTRAINT "visit_page_views_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_page_views" ADD CONSTRAINT "visit_page_views_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "visit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_page_views" ADD CONSTRAINT "visit_page_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visit_conversations" ADD CONSTRAINT "visit_conversations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_conversations" ADD CONSTRAINT "visit_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_conversations" ADD CONSTRAINT "visit_conversations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "visit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_conversations" ADD CONSTRAINT "visit_conversations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "visit_departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_conversations" ADD CONSTRAINT "visit_conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "visit_chat_messages" ADD CONSTRAINT "visit_chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "visit_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visit_chat_messages" ADD CONSTRAINT "visit_chat_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "visit_departments" ("id", "visit_id", "organization_id", "channel_id", "name", "sort_order")
SELECT gen_random_uuid()::text, v."id", v."organization_id", v."channel_id", p.name, p.ord
FROM "visits" v
CROSS JOIN LATERAL unnest(CASE WHEN cardinality(v."purposes") > 0 THEN v."purposes" ELSE ARRAY['Support'] END) WITH ORDINALITY AS p(name, ord);
