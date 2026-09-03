-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- AlterTable
ALTER TABLE "ai_configs" ADD COLUMN "appointment_message" TEXT;

-- CreateTable
CREATE TABLE "appointment_slots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "ai_config_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "ai_config_id" TEXT NOT NULL,
    "slot_id" TEXT,
    "channel_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "call_id" TEXT,
    "phone" TEXT NOT NULL,
    "contact_name" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "notes" TEXT,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointment_slots_organization_id_idx" ON "appointment_slots"("organization_id");
CREATE INDEX "appointment_slots_ai_config_id_idx" ON "appointment_slots"("ai_config_id");
CREATE INDEX "appointments_organization_id_idx" ON "appointments"("organization_id");
CREATE INDEX "appointments_ai_config_id_idx" ON "appointments"("ai_config_id");
CREATE INDEX "appointments_phone_idx" ON "appointments"("phone");
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_ai_config_id_fkey" FOREIGN KEY ("ai_config_id") REFERENCES "ai_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ai_config_id_fkey" FOREIGN KEY ("ai_config_id") REFERENCES "ai_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "appointment_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "whatsapp_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
