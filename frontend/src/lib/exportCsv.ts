// Minimal client-side CSV export — opens directly in Excel/Sheets.
// (PDF export is covered by the print views: Print -> "Save as PDF".)

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote if it contains comma, quote, or newline.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV from rows of objects and trigger a download.
 * `columns` maps header label -> accessor.
 */
export function exportCsv<T>(
  filename: string,
  rows: T[],
  columns: { header: string; value: (row: T) => unknown }[]
) {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")).join("\n");
  const csv = "﻿" + head + "\n" + body; // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
