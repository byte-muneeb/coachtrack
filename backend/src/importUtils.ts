// Shared helpers for bulk CSV/XLSX import endpoints.
//
// Rows arrive already parsed (the frontend uses SheetJS to read .csv/.xlsx into
// JSON objects keyed by the sheet's header row). These helpers make matching
// case- and whitespace-insensitive for BOTH headers and values, per the
// requirement that upper/lower-case differences never cause an import error.

export const MAX_IMPORT_ROWS = 1000;

export type RowIssue = { row: number; reason: string };
export type ImportResult = {
  validateOnly: boolean;
  total: number;
  created: number;      // rows that were (or would be) inserted
  skipped: RowIssue[];  // e.g. duplicates
  errors: RowIssue[];   // e.g. missing course, missing required field
};

// Normalize a header/key: lowercase, drop spaces/underscores/dashes so
// "Full Name", "full_name", "fullname", "FULL-NAME" all collapse to "fullname".
export function normKey(s: string): string {
  return String(s || "").toLowerCase().replace(/[\s_\-]+/g, "");
}

// Lowercased+trimmed value, for case-insensitive lookups (course/branch names).
export function lc(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

// Trimmed string or null.
export function trimStr(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

// Lenient number parse (accepts "1,200", " 500 ", blanks → default).
export function toNum(v: unknown, def = 0): number {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return def;
  const n = Number(s);
  return isNaN(n) ? def : n;
}

// A date string normalized to YYYY-MM-DD, or null. Accepts YYYY-MM-DD,
// YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY; anything unparseable → null.
export function toDateStr(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Build a header-insensitive accessor over a raw row object. Call the returned
// getter with one or more header aliases; the first non-empty match wins.
export function rowGetter(raw: Record<string, unknown>): (...aliases: string[]) => unknown {
  const map: Record<string, unknown> = {};
  for (const k of Object.keys(raw || {})) map[normKey(k)] = raw[k];
  return (...aliases: string[]) => {
    for (const a of aliases) {
      const val = map[normKey(a)];
      if (val !== undefined && val !== null && String(val).trim() !== "") return val;
    }
    return undefined;
  };
}
