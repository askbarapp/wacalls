-- AlterEnum
ALTER TYPE "CampaignType" ADD VALUE 'VIDEO_CLIP';

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "loop_clip" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "campaigns" ADD COLUMN "video_orientation" TEXT NOT NULL DEFAULT 'portrait';

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'audio';
