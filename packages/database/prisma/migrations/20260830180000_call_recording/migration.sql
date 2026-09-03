-- Call recordings written by the WhatsApp media path (mixed uplink+downlink PCM).
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "recording_path" TEXT;
