"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS, type ListMeta, type PageSize } from "@/lib/csv";

export function ListPagination({
  meta,
  loading,
  pageSize,
  onPageChange,
  onPageSizeChange,
  className = "",
}: {
  meta: ListMeta;
  loading?: boolean;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: PageSize) => void;
  className?: string;
}) {
  const start = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const end = Math.min(meta.page * meta.limit, meta.total);
  const range = meta.total === 0 ? "0 of 0" : `${start}–${end} of ${meta.total}`;

  return (
    <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span>{range}</span>
        {onPageSizeChange ? (
          <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
            Show
            <select
              className="min-w-[4.5rem] py-1.5 text-sm normal-case tracking-normal"
              value={pageSize}
              disabled={loading}
              onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200 disabled:opacity-40"
          disabled={meta.page <= 1 || loading}
          onClick={() => onPageChange(Math.max(1, meta.page - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>
        <span className="min-w-[5.5rem] text-center tabular-nums">
          {meta.page} / {meta.totalPages}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200 disabled:opacity-40"
          disabled={meta.page >= meta.totalPages || loading}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
