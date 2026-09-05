import { z } from "zod";

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type PageMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / Math.max(limit, 1))),
  };
}

export function pageSkip(page: number, limit: number) {
  return (page - 1) * limit;
}

export function okPage<T>(data: T, meta: PageMeta) {
  return { success: true as const, data, meta };
}
