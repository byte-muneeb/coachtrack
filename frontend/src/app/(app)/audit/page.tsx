"use client";

import { useEffect, useState } from "react";
import { auditApi, type AuditEntry } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime } from "@/lib/date";

const actionTone: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  payment: "bg-green-100 text-green-800",
  generate: "bg-primary-fixed text-on-primary-fixed",
  delete: "bg-error-container text-on-error-container",
  update: "bg-amber-100 text-amber-800",
};

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    auditApi.list().then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed")).finally(() => setLoading(false));
  }, []);

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1100px] space-y-lg">
        <PageHeader title="Audit Log" subtitle="Recent activity — who did what, and when." icon="history" />

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">When</th>
                <th className="px-md py-sm">User</th>
                <th className="px-md py-sm">Action</th>
                <th className="px-md py-sm">Entity</th>
                <th className="px-md py-sm">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={5} className="px-md py-xl text-center text-on-surface-variant font-body-md">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="px-md py-xl text-center text-error font-body-md">{error}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-md py-xl text-center text-on-surface-variant font-body-md">No activity recorded yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/5">
                  <td className="px-md py-sm font-mono-data text-[12px] text-on-surface-variant">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-md py-sm font-body-md text-body-md">{r.username || "—"}</td>
                  <td className="px-md py-sm"><span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${actionTone[r.action] || "bg-surface-container-high text-on-surface-variant"}`}>{r.action}</span></td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{r.entity || "—"}{r.entityId ? ` #${r.entityId}` : ""}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{r.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
