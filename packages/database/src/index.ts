import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export * from "@prisma/client";
export { PrismaClient };
export * from "./appointments.js";
export * from "./transcripts.js";
