import { z } from "zod";

const schema = z.object({
  APP_NAME: z.string().default("WaCalls"),
  APP_ENV: z.enum(["development", "production", "test"]).default("production"),
  APP_URL: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.string().default("info"),
  API_PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("12h"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  ENCRYPTION_KEY: z.string().min(16),
  INTERNAL_TOKEN: z.string().min(8),
  WHATSAPP_URL: z.string().default("http://whatsapp:4010"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SARVAM_API_KEY: z.string().optional(),
  RECORDINGS_DIR: z.string().default("/data/recordings"),
  CALLING_ENGINE: z.string().default("selfhosted"),
});

export const env = schema.parse(process.env);
