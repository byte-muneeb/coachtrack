// Display dates as DD-MM-YYYY (Pakistani convention). Accepts 'YYYY-MM-DD',
// an ISO timestamp, a number, or a Date. Returns "" for empty/invalid input.
// Note: HTML <input type="date"> values stay in the native YYYY-MM-DD format —
// this helper is for DISPLAY only.
export function fmtDate(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD or ISO prefix
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

// DD-MM-YYYY with time (e.g. audit rows). Falls back to fmtDate on failure.
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return fmtDate(v);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${fmtDate(d)} ${time}`;
}
