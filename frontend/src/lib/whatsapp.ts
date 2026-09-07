// Free "click-to-send" WhatsApp helper — builds wa.me links with a pre-filled
// message. No API, no per-message cost: staff clicks and sends from their own
// WhatsApp. Numbers are normalised to Pakistan (+92) format.

// Normalise a Pakistani phone number to bare international digits (e.g. 923001234567).
// Accepts 03001234567, 3001234567, +92 300 1234567, 0092..., etc. Returns null if
// it can't produce a plausible number.
export function normalizePkPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.startsWith("0092")) d = d.slice(2);        // 0092XXXXXXXXXX -> 92...
  else if (d.startsWith("92")) { /* already country-coded */ }
  else if (d.startsWith("0")) d = "92" + d.slice(1); // 03XXXXXXXXX -> 923XXXXXXXXX
  else if (d.length === 10 && d.startsWith("3")) d = "92" + d; // 3XXXXXXXXX -> 92...
  // A PK mobile is 92 + 10 digits = 12.
  return d.length >= 11 && d.length <= 13 ? d : null;
}

// Build a wa.me link, or null if the phone can't be normalised.
export function waLink(phone: string | null | undefined, message: string): string | null {
  const num = normalizePkPhone(phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

// Fill {Placeholder} tokens (case-insensitive) from a variables map. Unknown
// tokens are left as-is so a mis-typed template is visible rather than silent.
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  const lower: Record<string, string> = {};
  for (const k of Object.keys(vars)) lower[k.toLowerCase()] = String(vars[k]);
  return String(template || "").replace(/\{(\w+)\}/g, (m, key) => {
    const v = lower[String(key).toLowerCase()];
    return v !== undefined ? v : m;
  });
}
