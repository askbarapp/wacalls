-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('WEB', 'CLOUD');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
ALTER TYPE "CampaignType" ADD VALUE 'MESSAGE';

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "max_channels" INTEGER NOT NULL DEFAULT 1,
    "max_agents" INTEGER NOT NULL DEFAULT 3,
    "max_messages_per_day" INTEGER NOT NULL DEFAULT 200,
    "max_calls_per_day" INTEGER NOT NULL DEFAULT 50,
    "allow_cloud_api" BOOLEAN NOT NULL DEFAULT false,
    "allow_sdk" BOOLEAN NOT NULL DEFAULT true,
    "price_monthly" INTEGER NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "status" "OrgStatus" NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "organizations" ADD COLUMN "plan_id" TEXT;
ALTER TABLE "organizations" ADD COLUMN "billing_email" TEXT;
CREATE INDEX "organizations_plan_id_idx" ON "organizations"("plan_id");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "whatsapp_channels" ADD COLUMN "provider" "ChannelProvider" NOT NULL DEFAULT 'WEB';
ALTER TABLE "whatsapp_channels" ADD COLUMN "cloud_phone_number_id" TEXT;
ALTER TABLE "whatsapp_channels" ADD COLUMN "cloud_access_token" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "message_body" TEXT;

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "scopes" TEXT[] DEFAULT ARRAY['calls:write','messages:write','channels:read']::TEXT[];

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "campaign_id" TEXT,
    "phone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'WEB',
    "external_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_organization_id_idx" ON "messages"("organization_id");
CREATE INDEX "messages_channel_id_idx" ON "messages"("channel_id");
CREATE INDEX "messages_status_idx" ON "messages"("status");
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
