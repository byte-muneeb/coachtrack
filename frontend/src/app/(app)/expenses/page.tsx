"use client";

import { useCallback, useEffect, useState } from "react";
import { expensesApi, type Expense, type ExpenseSummary } from "@/lib/api";
import StatCard from "@/components/StatCard";
import PageHeader from "@/components/PageHeader";
import { inputCls } from "@/components/form";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");
const CATEGORIES = ["Rent", "Salaries", "Utilities", "Marketing", "Supplies", "Maintenance", "Other"];
const PAID_VIA = ["Cash", "JazzCash", "Easypaisa", "Bank Transfer (IBFT)", "Cheque"];
const todayStr = () => new Date().toISOString().slice(0, 10);

type EForm = { date: string; category: string; description: string; amount: string; paidVia: string };

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState<EForm>({ date: todayStr(), category: "Rent", description: "", amount: "0", paidVia: "Cash" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [list, sum] = await Promise.all([expensesApi.list(), expensesApi.summary()]);
      setExpenses(list); setSummary(sum);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (Number(form.amount) <= 0) { alert("Enter an amount"); return; }
    setSaving(true);
    try {
      await expensesApi.create({ date: form.date, category: form.category, description: form.description || null, amount: Number(form.amount), paidVia: form.paidVia });
      setModal(false); setForm({ date: todayStr(), category: "Rent", description: "", amount: "0", paidVia: "Cash" });
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }
  async function del(x: Expense) {
    if (!confirm("Delete this expense?")) return;
    try { await expensesApi.remove(x.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
  }
  const setF = (k: keyof EForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1240px] space-y-lg">
        <PageHeader
          title="Expenses &amp; Profit"
          subtitle="Track expenses; profit is income (collected fees) minus expenses."
          icon="account_balance_wallet"
          actions={
            <button onClick={() => setModal(true)} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">add</span> Add Expense
            </button>
          }
        />

        <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
          <StatCard label="Total Income (collected)" value={rs(summary?.totalIncome || 0)} icon="trending_up" tone="green" valueClass="text-green-700" />
          <StatCard label="Total Expenses" value={rs(summary?.totalExpenses || 0)} icon="trending_down" tone="red" valueClass="text-error" />
          <StatCard label="Net Profit" value={rs(summary?.netProfit || 0)} icon="savings" tone={(summary?.netProfit || 0) >= 0 ? "secondary" : "red"} valueClass={(summary?.netProfit || 0) >= 0 ? "text-primary" : "text-error"} />
        </div>

        {summary && summary.byCategory.length > 0 && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
            <p className="mb-sm font-label-md text-label-md uppercase text-on-surface-variant">Expenses by category</p>
            <div className="space-y-xs">
              {summary.byCategory.map((c) => {
                const pct = summary.totalExpenses > 0 ? (c.total / summary.totalExpenses) * 100 : 0;
                return (
                  <div key={c.category} className="flex items-center gap-md">
                    <span className="w-[120px] font-body-md text-body-md text-on-surface-variant">{c.category}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                      <div className="h-full rounded-full bg-secondary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-[110px] text-right font-mono-data text-mono-data">{rs(c.total)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">Date</th>
                <th className="px-md py-sm">Category</th>
                <th className="px-md py-sm">Description</th>
                <th className="px-md py-sm">Paid Via</th>
                <th className="px-md py-sm">Amount</th>
                <th className="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-error font-body-md">{error} — is the backend running on :4000?</td></tr>
              ) : expenses.length === 0 ? (
                <tr><td colSpan={6} className="px-md py-xl text-center text-on-surface-variant font-body-md">No expenses yet. Click “Add Expense”.</td></tr>
              ) : expenses.map((x) => (
                <tr key={x.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{x.date ? x.date.slice(0, 10) : "—"}</td>
                  <td className="px-md py-sm font-body-md text-body-md">{x.category || "—"}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{x.description || "—"}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{x.paidVia || "—"}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data">{rs(x.amount)}</td>
                  <td className="px-md py-sm text-right">
                    <button onClick={() => del(x)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete"><span className="material-symbols-outlined text-[20px]">delete</span></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={() => setModal(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="w-full max-w-[560px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">Add Expense</h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Date</span><input type="date" required className={inputCls} value={form.date} onChange={setF("date")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Category</span><select required className={inputCls} value={form.category} onChange={setF("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Description</span><input className={inputCls} value={form.description} onChange={setF("description")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Amount (Rs)</span><input type="number" required min={0} inputMode="numeric" className={inputCls} value={form.amount} onChange={setF("amount")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Paid Via</span><select className={inputCls} value={form.paidVia} onChange={setF("paidVia")}>{PAID_VIA.map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
            <div className="flex justify-end gap-sm pt-sm">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Add Expense"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
