// Parse a .csv or .xlsx file (client-side, via SheetJS) into an array of row
// objects keyed by the header row. Values come back as trimmed strings so the
// backend's case-insensitive matching sees consistent input.
import * as XLSX from "xlsx";

export async function parseSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  // defval:"" → missing cells become empty strings; raw:false → dates/numbers as strings.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  // Drop fully-empty rows.
  return rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
}
