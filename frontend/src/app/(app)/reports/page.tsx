"use client";

import { useEffect, useState } from "react";
import { statsApi, type ReportsData, type ReportFilters } from "@/lib/api";
import StatCard from "@/components/StatCard";
import PageHeader from "@/components/PageHeader";
import { inputCls } from "@/components/form";
import { exportCsv } from "@/lib/exportCsv";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");

/** "2026-07" -> "Jul 2026" */
function ymLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const emptyFilters: ReportFilters = { from: "", to: "", course: "", status: "" };

const cardCls = "rounded-xl border border-outline-variant bg-surface-container-lowest p-lg";
const sectionTitleCls = "font-headline-md text-headline-md font-semibold text-primary";
const inlineCls = `${inputCls} w-auto`;

export default function ReportsPage() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft filter state (edited via the filter bar; applied on "Apply").
  const [filters, setFilters] = useState<ReportFilters>(emptyFilters);

  const load = (f: ReportFilters) => {
    setLoading(true);
    setError(null);
    statsApi
      .reports(f)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reports"))
      .finally(() => setLoading(false));
  };

  // Load on mount.
  useEffect(() => {
    load(emptyFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    load(filters);
  };

  const reset = () => {
    setFilters(emptyFilters);
    load(emptyFilters);
  };

  const courses = data?.availableCourses ?? [];
  const maxMonth = data ? Math.max(1, ...data.monthlyCollections.map((m) => m.collected)) : 1;
  const maxBilling = data ? Math.max(1, ...data.billingByCourse.map((b) => b.expected)) : 1;

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1440px] space-y-lg">
        <PageHeader
          title="Financial & Academic Reports"
          subtitle="Filter and analyse collections, billing, and dues."
          icon="analytics"
          actions={
            data && data.defaulters.length > 0 ? (
              <button
                onClick={() => exportCsv("defaulters", data.defaulters, [
                  { header: "Registry ID", value: (d) => d.registryId },
                  { header: "Name", value: (d) => d.fullName },
                  { header: "Course", value: (d) => d.course || "" },
                  { header: "Overdue Vouchers", value: (d) => d.overdueCount },
                  { header: "Outstanding", value: (d) => d.outstanding },
                ])}
                className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[18px]">download</span> Export defaulters
              </button>
            ) : undefined
          }
        />

        {/* Filter bar */}
        <form onSubmit={apply} className={cardCls}>
          <div className="flex flex-wrap items-end gap-md">
            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">From date</span>
              <input
                type="date"
                value={filters.from ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                className={inlineCls}
              />
            </label>

            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">To date</span>
              <input
                type="date"
                value={filters.to ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                className={inlineCls}
              />
            </label>

            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Course</span>
              <select
                value={filters.course ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, course: e.target.value }))}
                className={inlineCls}
              >
                <option value="">All courses</option>
                {courses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-xs">
              <span className="font-label-md text-label-md text-on-surface-variant">Status</span>
              <select
                value={filters.status ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
                className={inlineCls}
              >
                <option value="">All statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            </label>

            <div className="flex items-center gap-sm">
              <button
                type="submit"
                className="rounded-lg bg-primary px-lg py-sm font-label-md text-label-md font-semibold text-on-primary transition-colors hover:bg-primary/90"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-lg py-sm font-label-md text-label-md font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                Reset
              </button>
            </div>
          </div>
        </form>

        {loading ? (
          <p className="font-body-md text-body-md text-on-surface-variant">Loading…</p>
        ) : error ? (
          <p className="font-body-md text-body-md text-error">{error} — is the backend running on :4000?</p>
        ) : data ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total Collected" value={rs(data.totalRevenue)} icon="trending_up" tone="green" valueClass="text-green-700" />
              <StatCard label="Outstanding" value={rs(data.totalOutstanding)} icon="account_balance_wallet" tone="red" valueClass="text-error" />
              <StatCard label="Collection Efficiency" value={`${data.collectionEfficiency}%`} icon="verified" tone="secondary" />
              <StatCard label="Overdue Vouchers" value={String(data.overdueVouchers)} icon="warning" tone="amber" valueClass="text-amber-700" />
            </div>

            {/* Monthly collections */}
            <div className={cardCls}>
              <p className={`mb-md ${sectionTitleCls}`}>Monthly Collections</p>
              {data.monthlyCollections.length === 0 ? (
                <p className="font-body-md text-body-md text-on-surface-variant">No collections in this range.</p>
              ) : (
                <div className="space-y-sm">
                  {data.monthlyCollections.map((m) => (
                    <div key={m.ym} className="flex items-center gap-md">
                      <span className="w-[100px] shrink-0 font-body-md text-body-md text-on-surface-variant">{ymLabel(m.ym)}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                        <div className="h-full rounded-full bg-secondary" style={{ width: `${(m.collected / maxMonth) * 100}%` }} />
                      </div>
                      <span className="w-[130px] shrink-0 text-right font-mono-data text-mono-data">{rs(m.collected)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Expected billing by course */}
            <div className={cardCls}>
              <p className={`mb-md ${sectionTitleCls}`}>Expected Billing by Course</p>
              {data.billingByCourse.length === 0 ? (
                <p className="font-body-md text-body-md text-on-surface-variant">No billing data.</p>
              ) : (
                <div className="space-y-sm">
                  {data.billingByCourse.map((b) => (
                    <div key={b.course} className="flex items-center gap-md">
                      <span className="w-[180px] shrink-0 truncate font-body-md text-body-md text-on-surface-variant">{b.course}</span>
                      <span className="w-[90px] shrink-0 font-label-md text-label-md text-on-surface-variant">{b.students} std</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(b.expected / maxBilling) * 100}%` }} />
                      </div>
                      <span className="w-[130px] shrink-0 text-right font-mono-data text-mono-data">{rs(b.expected)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Outstanding / defaulters */}
            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
              <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-md py-sm">
                <span className="font-label-md text-label-md uppercase text-on-surface-variant">Outstanding / Defaulters</span>
                <span className="font-label-md text-label-md text-on-surface-variant">{data.totalStudents} students in scope</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
                    <tr>
                      <th className="px-md py-sm">Student</th>
                      <th className="px-md py-sm">Course</th>
                      <th className="px-md py-sm">Overdue</th>
                      <th className="px-md py-sm">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {data.defaulters.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-md py-xl text-center font-body-md text-body-md text-on-surface-variant">
                          No outstanding balances.
                        </td>
                      </tr>
                    ) : (
                      data.defaulters.map((s) => (
                        <tr key={s.id} className="hover:bg-secondary/5">
                          <td className="px-md py-sm">
                            <div className="font-body-md text-body-md text-on-surface">{s.fullName}</div>
                            <div className="font-mono-data text-mono-data text-on-surface-variant">{s.registryId}</div>
                          </td>
                          <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{s.course || "—"}</td>
                          <td className="px-md py-sm">
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-sm py-[2px] font-label-md text-label-md font-semibold text-amber-700">
                              {s.overdueCount}
                            </span>
                          </td>
                          <td className="px-md py-sm font-mono-data text-mono-data text-error">{rs(s.outstanding)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
