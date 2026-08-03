"use client";

import { useCallback, useEffect, useState } from "react";
import { remindersApi, type ReminderRule, type ReminderQueueItem } from "@/lib/api";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");
const CHANNELS = ["whatsapp", "sms", "email"];
const VARS = ["{StudentName}", "{Amount}", "{DueDate}"];

export default function RemindersPage() {
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [template, setTemplate] = useState("");
  const [automation, setAutomation] = useState(true);
  const [queue, setQueue] = useState<ReminderQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedTpl, setSavedTpl] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [r, s, q] = await Promise.all([remindersApi.rules(), remindersApi.settings(), remindersApi.queue()]);
      setRules(r); setTemplate(s.template); setAutomation(s.automationActive); setQueue(q.queue);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addRule() {
    try { await remindersApi.addRule({ offsetType: "before", offsetDays: 3, channels: "whatsapp" }); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function updateRule(id: number, data: Partial<ReminderRule>) {
    try { await remindersApi.updateRule(id, data); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function removeRule(id: number) {
    try { await remindersApi.removeRule(id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  function toggleChannel(r: ReminderRule, ch: string) {
    const set = new Set((r.channels || "").split(",").filter(Boolean));
    if (set.has(ch)) set.delete(ch); else set.add(ch);
    updateRule(r.id, { channels: Array.from(set).join(",") });
  }
  async function saveTemplate() {
    try { await remindersApi.saveSettings({ template }); setSavedTpl(true); setTimeout(() => setSavedTpl(false), 1500); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function toggleAutomation() {
    const next = !automation; setAutomation(next);
    try { await remindersApi.saveSettings({ automationActive: next }); } catch { setAutomation(!next); }
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1240px] space-y-lg">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="font-display text-[26px] font-bold tracking-tight text-primary">Automated Fee Reminders</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">Configure when and how fee reminders go out.</p>
          </div>
          <label className="flex items-center gap-sm">
            <span className="font-label-md text-label-md text-on-surface-variant">Automation</span>
            <button onClick={toggleAutomation} className={`relative h-6 w-11 rounded-full transition-colors ${automation ? "bg-secondary" : "bg-surface-container-high"}`}>
              <span className={`absolute top-[2px] h-5 w-5 rounded-full bg-white transition-all ${automation ? "left-[22px]" : "left-[2px]"}`} />
            </button>
          </label>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 px-md py-sm font-body-md text-body-md text-amber-800">
          Rules &amp; templates are saved. <strong>Actual sending (WhatsApp/SMS) activates once the messaging integration is connected</strong> — the queue below is a live preview.
        </div>

        {loading ? (
          <p className="font-body-md text-on-surface-variant">Loading…</p>
        ) : error ? (
          <p className="font-body-md text-error">{error} — is the backend running on :4000?</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-lg lg:grid-cols-2">
              {/* Rules */}
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <div className="mb-md flex items-center justify-between">
                  <h2 className="font-headline-md text-headline-md font-semibold text-primary">Reminder Rules</h2>
                  <button onClick={addRule} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90"><span className="material-symbols-outlined text-[18px]">add</span> Add Rule</button>
                </div>
                {rules.length === 0 ? <p className="font-body-md text-on-surface-variant">No rules yet.</p> : (
                  <div className="space-y-sm">
                    {rules.map((r) => (
                      <div key={r.id} className="rounded-lg border border-outline-variant p-md">
                        <div className="flex flex-wrap items-center gap-sm">
                          <input type="number" value={r.offsetDays} disabled={r.offsetType === "on"} onChange={(e) => updateRule(r.id, { offsetDays: Number(e.target.value) })} className="w-[64px] rounded-md border border-outline-variant px-sm py-[3px] font-body-md text-body-md outline-none disabled:opacity-50" />
                          <select value={r.offsetType} onChange={(e) => updateRule(r.id, { offsetType: e.target.value as ReminderRule["offsetType"] })} className="rounded-md border border-outline-variant px-sm py-[3px] font-body-md text-body-md outline-none">
                            <option value="before">days before due</option>
                            <option value="on">on due date</option>
                            <option value="after">days after (overdue)</option>
                          </select>
                          <div className="ml-auto flex items-center gap-xs">
                            <button onClick={() => updateRule(r.id, { active: !r.active })} className={`rounded-full px-sm py-[2px] font-label-md text-label-md ${r.active ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{r.active ? "active" : "off"}</button>
                            <button onClick={() => removeRule(r.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-error hover:bg-error-container"><span className="material-symbols-outlined text-[18px]">delete</span></button>
                          </div>
                        </div>
                        <div className="mt-sm flex gap-xs">
                          {CHANNELS.map((ch) => {
                            const on = (r.channels || "").split(",").includes(ch);
                            return <button key={ch} onClick={() => toggleChannel(r, ch)} className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${on ? "bg-secondary text-on-secondary" : "bg-surface-container-high text-on-surface-variant"}`}>{ch}</button>;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Template */}
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Message Template</h2>
                <div className="mb-sm flex flex-wrap gap-xs">
                  {VARS.map((v) => (
                    <button key={v} onClick={() => setTemplate((t) => t + " " + v)} className="rounded-full bg-surface-container-high px-sm py-[2px] font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-highest">{v}</button>
                  ))}
                </div>
                <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={6} className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-md font-body-md text-body-md outline-none focus:border-secondary" />
                <div className="mt-sm flex items-center justify-end gap-sm">
                  {savedTpl && <span className="font-label-md text-label-md text-green-700">✓ Saved</span>}
                  <button onClick={saveTemplate} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">Save Template</button>
                </div>
              </div>
            </div>

            {/* Queue preview */}
            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
              <div className="border-b border-outline-variant bg-surface-container-low px-md py-sm font-label-md text-label-md uppercase text-on-surface-variant">
                Reminder Queue (preview from unpaid vouchers)
              </div>
              <table className="w-full text-left">
                <thead className="font-label-md text-label-md uppercase text-on-surface-variant">
                  <tr><th className="px-md py-sm">Scheduled</th><th className="px-md py-sm">Student</th><th className="px-md py-sm">Voucher</th><th className="px-md py-sm">Amount</th><th className="px-md py-sm">Rule</th><th className="px-md py-sm">Channels</th></tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {queue.length === 0 ? (
                    <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">No upcoming reminders (need active rules + unpaid vouchers with due dates).</td></tr>
                  ) : queue.slice(0, 30).map((q, i) => (
                    <tr key={i} className="hover:bg-secondary/5">
                      <td className="px-md py-sm font-mono-data text-mono-data">{q.scheduledFor}</td>
                      <td className="px-md py-sm font-body-md text-body-md">{q.studentName}</td>
                      <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{q.voucherNo}</td>
                      <td className="px-md py-sm font-mono-data text-mono-data">{rs(q.amount)}</td>
                      <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{q.rule}</td>
                      <td className="px-md py-sm font-label-md text-label-md text-on-surface-variant">{q.channels || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
