"use client";

import { useEffect, useMemo, useState } from "react";

// Client-side pagination: slice an already-loaded list into pages and drive a
// compact 1·2·3 pager. Matches the Student Registry pager used across the app.
export function usePagination<T>(items: T[], pageSize = 15) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  // Snap back to a valid page if the list shrank (e.g. after filtering/deleting).
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  return {
    page: safePage, setPage, totalPages, pageItems, total, pageSize,
    rangeStart: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    rangeEnd: Math.min(safePage * pageSize, total),
  };
}

// Windowed page numbers: 1 … (p-1) p (p+1) … N, so large lists stay compact.
function pageWindow(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const lo = Math.max(2, page - 1), hi = Math.min(totalPages - 1, page + 1);
  if (lo > 2) out.push("…");
  for (let n = lo; n <= hi; n++) out.push(n);
  if (hi < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

export default function Pagination({
  page, totalPages, setPage, total, rangeStart, rangeEnd, unit = "items",
}: {
  page: number; totalPages: number; setPage: (n: number) => void;
  total: number; rangeStart: number; rangeEnd: number; unit?: string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-sm">
      <p className="font-label-md text-label-md text-on-surface-variant">
        Showing {rangeStart}–{rangeEnd} of {total} {unit}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-xs">
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40" aria-label="Previous page">
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>
          {pageWindow(page, totalPages).map((n, i) =>
            n === "…" ? (
              <span key={`e${i}`} className="px-xs text-on-surface-variant">…</span>
            ) : (
              <button key={n} onClick={() => setPage(n)}
                className={`h-8 min-w-8 rounded-md border px-sm font-label-md text-label-md ${
                  n === page ? "border-secondary bg-secondary text-on-secondary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                }`}>
                {n}
              </button>
            )
          )}
          <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40" aria-label="Next page">
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}
