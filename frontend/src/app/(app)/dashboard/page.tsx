"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { statsApi, type DashboardData } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (ym: string) => MONTHS[Number(ym.slice(5)) - 1] || ym;
const monthLong = (ym: string) => {
  const full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${full[Number(ym.slice(5)) - 1] || ""} ${ym.slice(0, 4)}`;
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function DashboardPage() {
  const [d, setD] = useState<DashboardData | null>(null);
  const [month, setMonth] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    statsApi
      .dashboard(month || undefined)
      .then((data) => {
        setD(data);
        if (!month) setMonth(data.selectedMonth);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [month]);

  const maxTrend = d ? Math.max(1, ...d.monthlyTrend.map((m) => m.collected)) : 1;

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1440px] space-y-lg">
        <PageHeader
          title="Executive Overview"
          subtitle="Real-time performance for your coaching centre."
          icon="dashboard"
          actions={
            <label className="flex items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm">
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">calendar_month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="bg-transparent font-label-md text-label-md font-medium text-on-surface outline-none"
              />
            </label>
          }
        />

        {loading && !d ? (
          <div className="flex h-64 items-center justify-center font-body-md text-on-surface-variant">Loading…</div>
        ) : error ? (
          <p className="rounded-xl border border-error bg-error-container px-md py-sm font-body-md text-on-error-container">
            {error} — is the backend running on :4000?
          </p>
        ) : d ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label={`Revenue · ${monthLong(d.selectedMonth)}`}
                value={
                  d.revenueMTD > 0
                    ? rs(d.revenueMTD)
                    : <span className="text-[19px] font-semibold text-on-surface-variant">No collections yet</span>
                }
                icon="trending_up"
                tone={d.revenueMTD > 0 ? "green" : "neutral"}
                valueClass={d.revenueMTD > 0 ? "text-green-700" : ""}
                sub={
                  <span className={d.revenueMTD > 0 ? "text-green-700" : "text-on-surface-variant"}>
                    {rs(d.totalCollected)} collected all-time
                  </span>
                }
              />
              <StatCard
                label="Outstanding Fees"
                value={rs(d.totalOutstanding)}
                icon="account_balance_wallet"
                tone="red"
                valueClass="text-error"
                sub={`${d.outstandingStudentsCount} student${d.outstandingStudentsCount === 1 ? "" : "s"} owe fees`}
              />
              <StatCard
                label="Total Students"
                value={String(d.studentsCount)}
                icon="group"
                tone="blue"
                sub={`+${d.newRegistrationsMTD} new in ${monthShort(d.selectedMonth)}`}
              />
              <StatCard
                label="Collection Efficiency"
                value={`${d.collectionEfficiency}%`}
                icon="verified"
                tone="secondary"
                sub="Collected vs billed"
              />
            </div>

            <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
              {/* Trend */}
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg lg:col-span-2">
                <div className="mb-lg flex items-center justify-between">
                  <div>
                    <h2 className="font-headline-md text-headline-md font-semibold text-primary">Fee Collection</h2>
                    <p className="font-label-md text-label-md text-on-surface-variant">6 months to {monthShort(d.selectedMonth)} {d.selectedMonth.slice(0, 4)}</p>
                  </div>
                  <span className="rounded-full bg-secondary-fixed px-sm py-[3px] font-label-md text-label-md text-on-secondary-fixed">
                    {rs(d.totalCollected)} total
                  </span>
                </div>
                {d.monthlyTrend.length === 0 ? (
                  <div className="flex h-[240px] flex-col items-center justify-center gap-sm text-on-surface-variant">
                    <span className="material-symbols-outlined text-[40px] opacity-40">bar_chart</span>
                    <p className="font-body-md text-body-md">No payments recorded in this range.</p>
                  </div>
                ) : (
                  <div className="relative flex h-[240px] items-end gap-lg border-b border-outline-variant pb-0">
                    {d.monthlyTrend.map((m) => (
                      <div key={m.ym} className="group flex flex-1 flex-col items-center justify-end gap-sm">
                        <span className="font-mono-data text-[11px] font-medium text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100">
                          {rs(m.collected)}
                        </span>
                        <div
                          className="w-full max-w-[56px] rounded-t-md bg-gradient-to-t from-secondary to-[#4a93f5] transition-all hover:opacity-90"
                          style={{ height: `${Math.max(6, (m.collected / maxTrend) * 190)}px` }}
                          title={rs(m.collected)}
                        />
                        <span className="font-label-md text-label-md text-on-surface-variant">{monthShort(m.ym)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent activity */}
              <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <h2 className="mb-md font-headline-md text-headline-md font-semibold text-primary">Recent Payments</h2>
                {d.recentPayments.length === 0 ? (
                  <p className="font-body-md text-body-md text-on-surface-variant">No payments yet.</p>
                ) : (
                  <ul className="space-y-md">
                    {d.recentPayments.map((p, i) => (
                      <li key={i} className="flex items-center gap-sm">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                          <span className="material-symbols-outlined text-[18px]">payments</span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-body-md text-body-md font-medium text-on-surface">{p.studentName}</p>
                          <p className="truncate font-label-md text-label-md text-on-surface-variant">{p.method || "—"} · {p.voucherNo}</p>
                        </div>
                        <span className="font-mono-data text-mono-data font-semibold text-green-700">{rs(p.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Outstanding students */}
            <div className="rounded-xl border border-outline-variant bg-surface-container-lowest">
              <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
                <div>
                  <h2 className="font-headline-md text-headline-md font-semibold text-primary">Outstanding Students</h2>
                  <p className="font-label-md text-label-md text-on-surface-variant">Students with pending fees, highest first.</p>
                </div>
                <Link href="/reports" className="font-label-md text-label-md text-secondary hover:underline">
                  View all →
                </Link>
              </div>
              {d.outstandingStudents.length === 0 ? (
                <div className="flex flex-col items-center gap-xs px-lg py-xl text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[36px] text-green-600">check_circle</span>
                  <p className="font-body-md text-body-md">No outstanding fees — everyone is paid up.</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="font-label-md text-label-md uppercase text-on-surface-variant">
                    <tr className="border-b border-outline-variant">
                      <th className="px-lg py-sm">Student</th>
                      <th className="px-lg py-sm">Course</th>
                      <th className="px-lg py-sm">Status</th>
                      <th className="px-lg py-sm text-right">Outstanding</th>
                      <th className="px-lg py-sm text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {d.outstandingStudents.map((s) => (
                      <tr key={s.id} className="hover:bg-secondary/5">
                        <td className="px-lg py-sm">
                          <div className="flex items-center gap-sm">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-fixed font-label-md text-label-md text-on-primary-fixed">
                              {initials(s.fullName)}
                            </span>
                            <div className="leading-tight">
                              <p className="font-body-md text-body-md text-on-surface">{s.fullName}</p>
                              <p className="font-mono-data text-[11px] text-on-surface-variant">{s.registryId}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-lg py-sm font-body-md text-body-md text-on-surface-variant">{s.course || "—"}</td>
                        <td className="px-lg py-sm">
                          {s.overdueCount > 0 ? (
                            <span className="rounded-full bg-error-container px-sm py-[2px] font-label-md text-label-md text-on-error-container">
                              {s.overdueCount} overdue
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-sm py-[2px] font-label-md text-label-md text-amber-800">Pending</span>
                          )}
                        </td>
                        <td className="px-lg py-sm text-right font-mono-data text-mono-data font-semibold text-error">{rs(s.outstanding)}</td>
                        <td className="px-lg py-sm text-right">
                          <Link href={`/students/${s.id}`} className="font-label-md text-label-md text-secondary hover:underline">
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-md sm:grid-cols-4">
              {[
                { href: "/students/register", icon: "person_add", label: "Register Student" },
                { href: "/vouchers", icon: "receipt_long", label: "Generate Vouchers" },
                { href: "/admissions", icon: "how_to_reg", label: "Inquiries" },
                { href: "/expenses", icon: "account_balance_wallet", label: "Add Expense" },
              ].map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="flex items-center gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-md hover:border-secondary hover:bg-secondary/5"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
                    <span className="material-symbols-outlined text-[22px]">{a.icon}</span>
                  </span>
                  <span className="font-body-md text-body-md font-medium text-on-surface">{a.label}</span>
                </Link>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
