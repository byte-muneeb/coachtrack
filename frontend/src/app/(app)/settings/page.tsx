"use client";

import { useEffect, useState } from "react";
import { settingsApi, type InstituteProfile } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Field, TextInput, Select, Textarea } from "@/components/form";

const CURRENCIES = ["PKR", "USD", "AED", "SAR", "GBP"];

function initials(name: string) {
  return (name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function SettingsPage() {
  const [form, setForm] = useState<InstituteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsApi
      .profile()
      .then(setForm)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const set = (k: keyof InstituteProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((p) => (p ? { ...p, [k]: e.target.value } : p));
    setSaved(false);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await settingsApi.saveProfile(form);
      setForm(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[960px] space-y-lg">
        <PageHeader title="Settings" subtitle="Institute profile, preferences, and voucher branding." icon="settings" />

        {loading ? (
          <p className="font-body-md text-on-surface-variant">Loading…</p>
        ) : !form ? (
          <p className="font-body-md text-error">{error || "Failed to load settings."}</p>
        ) : (
          <form onSubmit={save} className="space-y-lg">
            {error && (
              <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>
            )}

            {/* Identity banner */}
            <div className="flex items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-secondary to-[#0a49a0] text-[22px] font-bold text-white">
                {initials(form.name)}
              </span>
              <div>
                <p className="font-display text-[20px] font-bold text-primary">{form.name || "Your institute"}</p>
                <p className="font-body-md text-body-md text-on-surface-variant">{form.tagline || "Set a tagline below"}</p>
              </div>
            </div>

            {/* Institute profile */}
            <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
              <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Institute Profile</h2>
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <Field label="Institute Name" required className="sm:col-span-2">
                  <TextInput value={form.name} onChange={set("name")} required placeholder="e.g. Ali Academy" />
                </Field>
                <Field label="Tagline" className="sm:col-span-2">
                  <TextInput value={form.tagline} onChange={set("tagline")} placeholder="e.g. Excellence in MDCAT & FSc preparation" />
                </Field>
                <Field label="Phone">
                  <TextInput type="tel" value={form.phone} onChange={set("phone")} placeholder="042-xxxxxxx / 03xx-xxxxxxx" />
                </Field>
                <Field label="Email">
                  <TextInput type="email" value={form.email} onChange={set("email")} placeholder="info@academy.pk" />
                </Field>
                <Field label="Address" className="sm:col-span-2">
                  <TextInput value={form.address} onChange={set("address")} placeholder="Street / area" />
                </Field>
                <Field label="City">
                  <TextInput value={form.city} onChange={set("city")} placeholder="e.g. Lahore" />
                </Field>
              </div>
            </section>

            {/* Preferences */}
            <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
              <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Preferences</h2>
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <Field label="Currency" hint="Used across fees, vouchers, and reports">
                  <Select value={form.currency} onChange={set("currency")}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label="Academic Year">
                  <TextInput value={form.academicYear} onChange={set("academicYear")} placeholder="e.g. 2026–27" />
                </Field>
              </div>
            </section>

            {/* Voucher / branding */}
            <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
              <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Voucher &amp; Branding</h2>
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                <Field label="Voucher Prefix" hint="Shown on generated voucher numbers">
                  <TextInput value={form.voucherPrefix} onChange={set("voucherPrefix")} placeholder="e.g. CT" />
                </Field>
                <Field label="Logo Text" hint="Short text mark if you have no image logo">
                  <TextInput value={form.logoText} onChange={set("logoText")} placeholder="e.g. AA" />
                </Field>
                <Field label="Voucher Footer Note" className="sm:col-span-2">
                  <Textarea value={form.voucherFooter} onChange={set("voucherFooter")} rows={3} placeholder="Printed at the bottom of every voucher" />
                </Field>
              </div>
            </section>

            {/* Fee policy */}
            <section className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
              <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Fee Policy</h2>
              <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
                <Field label="Late Fee Mode" hint="Applied to overdue vouchers">
                  <Select value={form.lateFeeMode} onChange={set("lateFeeMode")}>
                    <option value="none">No late fee</option>
                    <option value="fixed">Fixed (Rs)</option>
                    <option value="percent">Percent of balance</option>
                  </Select>
                </Field>
                <Field label={form.lateFeeMode === "percent" ? "Late Fee (%)" : "Late Fee (Rs)"}>
                  <TextInput type="number" min={0} inputMode="numeric" value={form.lateFeeValue} onChange={set("lateFeeValue")} disabled={form.lateFeeMode === "none"} />
                </Field>
                <Field label="Auto-generate day" hint="Day of month (0 = manual only)">
                  <TextInput type="number" min={0} max={28} inputMode="numeric" value={form.autoGenDay} onChange={set("autoGenDay")} />
                </Field>
              </div>
              <p className="mt-sm font-label-md text-label-md text-on-surface-variant">
                Late fees are applied from the Vouchers page (“Apply Late Fees”). If auto-generate day &gt; 0, monthly vouchers are generated automatically on that day.
              </p>
            </section>

            {/* Save bar */}
            <div className="flex items-center justify-end gap-md">
              {saved && (
                <span className="flex items-center gap-xs font-label-md text-label-md text-green-700">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span> Saved
                </span>
              )}
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-xs rounded-lg bg-secondary px-lg py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[18px]">save</span> {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
