-- CreateTable: business_profiles
CREATE TABLE IF NOT EXISTS "business_profiles" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "business_name" TEXT NOT NULL,
    "business_category" TEXT,
    "owner_name" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "brand_colors" TEXT,
    "brand_style" TEXT,
    "language" TEXT DEFAULT 'Hindi + English',
    "products" TEXT,
    "services" TEXT,
    "usp" TEXT,
    "target_customer" TEXT,
    "default_offer" TEXT,
    "creative_preferences" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: creative_assets
CREATE TABLE IF NOT EXISTS "creative_assets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "conversation_id" TEXT,
    "festival_id" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Untitled Creative',
    "concept" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "locked_at" TIMESTAMP(3),
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable: creative_versions
CREATE TABLE IF NOT EXISTS "creative_versions" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "prompt" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'usevelix',
    "provider_job_id" TEXT,
    "image_url" TEXT,
    "local_path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ai_jobs
CREATE TABLE IF NOT EXISTS "ai_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "feature" TEXT NOT NULL DEFAULT 'creative',
    "provider" TEXT NOT NULL DEFAULT 'usevelix',
    "provider_job_id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "prompt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "input_url" TEXT,
    "output_url" TEXT,
    "error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ai_credit_balances
CREATE TABLE IF NOT EXISTS "ai_credit_balances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 100,
    "monthly_limit" INTEGER NOT NULL DEFAULT 100,
    "used" INTEGER NOT NULL DEFAULT 0,
    "reset_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable: feature_entitlements
CREATE TABLE IF NOT EXISTS "feature_entitlements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "daily_limit" INTEGER NOT NULL DEFAULT 50,
    "monthly_limit" INTEGER NOT NULL DEFAULT 200,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: festivals
CREATE TABLE IF NOT EXISTS "festivals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "festival_date" TIMESTAMP(3) NOT NULL,
    "trigger_days_before" INTEGER NOT NULL DEFAULT 1,
    "creative_type" TEXT NOT NULL DEFAULT 'poster',
    "language" TEXT NOT NULL DEFAULT 'Hindi + English',
    "default_prompt" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "target_plans" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "festivals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: festival_campaigns
CREATE TABLE IF NOT EXISTS "festival_campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "festival_id" TEXT NOT NULL,
    "festival_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "creative_asset_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "festival_campaigns_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "business_profiles_organization_id_channel_id_key" ON "business_profiles"("organization_id", "channel_id");
CREATE INDEX IF NOT EXISTS "business_profiles_organization_id_idx" ON "business_profiles"("organization_id");

CREATE INDEX IF NOT EXISTS "creative_assets_organization_id_status_idx" ON "creative_assets"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "creative_assets_channel_id_idx" ON "creative_assets"("channel_id");

CREATE INDEX IF NOT EXISTS "creative_versions_asset_id_version_idx" ON "creative_versions"("asset_id", "version");

CREATE INDEX IF NOT EXISTS "ai_jobs_organization_id_status_idx" ON "ai_jobs"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "ai_jobs_provider_provider_job_id_idx" ON "ai_jobs"("provider", "provider_job_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ai_credit_balances_organization_id_key" ON "ai_credit_balances"("organization_id");

CREATE UNIQUE INDEX IF NOT EXISTS "feature_entitlements_organization_id_channel_id_feature_key" ON "feature_entitlements"("organization_id", "channel_id", "feature");
CREATE INDEX IF NOT EXISTS "feature_entitlements_organization_id_feature_idx" ON "feature_entitlements"("organization_id", "feature");

CREATE INDEX IF NOT EXISTS "festivals_festival_date_active_idx" ON "festivals"("festival_date", "active");

CREATE UNIQUE INDEX IF NOT EXISTS "festival_campaigns_organization_id_channel_id_festival_id_key" ON "festival_campaigns"("organization_id", "channel_id", "festival_id", "festival_date");
CREATE INDEX IF NOT EXISTS "festival_campaigns_organization_id_status_idx" ON "festival_campaigns"("organization_id", "status");

-- Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_organization_id_fkey') THEN
        ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_channel_id_fkey') THEN
        ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_organization_id_fkey') THEN
        ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_channel_id_fkey') THEN
        ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_conversation_id_fkey') THEN
        ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_festival_id_fkey') THEN
        ALTER TABLE "creative_assets" ADD CONSTRAINT "creative_assets_festival_id_fkey" FOREIGN KEY ("festival_id") REFERENCES "festivals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_versions_asset_id_fkey') THEN
        ALTER TABLE "creative_versions" ADD CONSTRAINT "creative_versions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "creative_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_jobs_organization_id_fkey') THEN
        ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_balances_organization_id_fkey') THEN
        ALTER TABLE "ai_credit_balances" ADD CONSTRAINT "ai_credit_balances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_entitlements_organization_id_fkey') THEN
        ALTER TABLE "feature_entitlements" ADD CONSTRAINT "feature_entitlements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'feature_entitlements_channel_id_fkey') THEN
        ALTER TABLE "feature_entitlements" ADD CONSTRAINT "feature_entitlements_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'festival_campaigns_organization_id_fkey') THEN
        ALTER TABLE "festival_campaigns" ADD CONSTRAINT "festival_campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'festival_campaigns_channel_id_fkey') THEN
        ALTER TABLE "festival_campaigns" ADD CONSTRAINT "festival_campaigns_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'festival_campaigns_festival_id_fkey') THEN
        ALTER TABLE "festival_campaigns" ADD CONSTRAINT "festival_campaigns_festival_id_fkey" FOREIGN KEY ("festival_id") REFERENCES "festivals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'festival_campaigns_creative_asset_id_fkey') THEN
        ALTER TABLE "festival_campaigns" ADD CONSTRAINT "festival_campaigns_creative_asset_id_fkey" FOREIGN KEY ("creative_asset_id") REFERENCES "creative_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
