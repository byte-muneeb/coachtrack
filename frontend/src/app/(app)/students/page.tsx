"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { studentsApi, branchesApi, type Student, type Branch } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { exportCsv } from "@/lib/exportCsv";

const STATUS = ["all", "active", "pending", "graduated", "suspended"];
const PAGE_SIZE = 8;
const selCls =
  "min-w-[136px] rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-[9px] font-body-md text-body-md text-on-surface capitalize outline-none transition-colors hover:border-outline focus:border-secondary";

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    pending: "bg-amber-100 text-amber-800",
    graduated: "bg-blue-100 text-blue-800",
    suspended: "bg-error-container text-on-error-container",
  };
  const cls = map[status] || "bg-surface-container-high text-on-surface-variant";
  return (
    <span className={`inline-block rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${cls}`}>{status}</span>
  );
}

/** Fee status is derived automatically from the student's balance — no manual entry. */
function FeeBadge({ outstanding }: { outstanding: number }) {
  if (outstanding <= 0) {
    return (
      <span className="inline-flex items-center gap-[3px] rounded-full bg-green-100 px-sm py-[2px] font-label-md text-label-md text-green-800">
        <span className="material-symbols-outlined text-[14px]">check_circle</span> Cleared
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-[3px] rounded-full bg-error-container px-sm py-[2px] font-label-md text-label-md text-on-error-container">
      <span className="material-symbols-outlined text-[14px]">error</span> Due
    </span>
  );
}

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [feeFilter, setFeeFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStudents(await studentsApi.list({ search, status }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load students");
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => { branchesApi.list().then(setBranches).catch(() => setBranches([])); }, []);

  // Reset to first page whenever any filter/search changes.
  useEffect(() => setPage(1), [search, status, courseFilter, feeFilter, branchFilter]);

  const courseOptions = useMemo(
    () => Array.from(new Set(students.map((s) => s.course).filter(Boolean))) as string[],
    [students]
  );
  // Course + fee-status filters applied client-side to the loaded list.
  const filtered = useMemo(
    () => students.filter((s) => {
      if (courseFilter !== "all" && s.course !== courseFilter) return false;
      if (feeFilter === "cleared" && s.outstanding > 0) return false;
      if (feeFilter === "due" && s.outstanding <= 0) return false;
      if (branchFilter !== "all" && String(s.branchId ?? "") !== branchFilter) return false;
      return true;
    }),
    [students, courseFilter, feeFilter, branchFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  async function onDelete(s: Student) {
    if (!confirm(`Delete ${s.fullName}? This cannot be undone.`)) return;
    try {
      await studentsApi.remove(s.id);
      setStudents((prev) => prev.filter((x) => x.id !== s.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1440px] space-y-lg">
        <PageHeader
          title="Student Registry"
          subtitle="Manage enrollments, status, and financial records."
          icon="group"
          actions={
            <>
              <button
                onClick={() => exportCsv("students", filtered, [
                  { header: "Registry ID", value: (s) => s.registryId },
                  { header: "Name", value: (s) => s.fullName },
                  { header: "Phone", value: (s) => s.phone || "" },
                  { header: "Course", value: (s) => s.course || "" },
                  { header: "Batch", value: (s) => s.batch || "" },
                  { header: "Outstanding", value: (s) => s.outstanding },
                  { header: "Status", value: (s) => s.status },
                ])}
                className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[18px]">download</span> Export CSV
              </button>
              <Link
                href="/students/register"
                className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary transition-colors hover:opacity-90"
              >
                <span className="material-symbols-outlined text-[18px]">add</span> New Registration
              </Link>
            </>
          }
        />

        {/* Filters toolbar */}
        <div className="flex flex-col gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-sm xl:flex-row xl:items-center">
          <label className="flex flex-1 items-center gap-sm rounded-lg bg-surface-container-low px-md py-sm">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, roll no, course, or phone…"
              className="w-full bg-transparent font-body-md text-body-md outline-none placeholder:text-on-surface-variant"
            />
          </label>
          <div className="flex flex-wrap items-center gap-sm">
            <span className="hidden items-center px-xs text-on-surface-variant xl:flex">
              <span className="material-symbols-outlined text-[20px]">filter_list</span>
            </span>
            <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className={selCls} aria-label="Filter by course">
              <option value="all">All courses</option>
              {courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={feeFilter} onChange={(e) => setFeeFilter(e.target.value)} className={selCls} aria-label="Filter by fee status">
              <option value="all">All fee status</option>
              <option value="due">Fees due</option>
              <option value="cleared">Cleared</option>
            </select>
            {branches.length > 0 && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={selCls} aria-label="Filter by branch">
                <option value="all">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selCls} aria-label="Filter by enrollment status">
              {STATUS.map((s) => (
                <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
              ))}
            </select>
            {(search || courseFilter !== "all" || feeFilter !== "all" || branchFilter !== "all" || status !== "all") && (
              <button
                onClick={() => { setSearch(""); setCourseFilter("all"); setFeeFilter("all"); setBranchFilter("all"); setStatus("all"); }}
                className="flex items-center gap-xs rounded-lg px-sm py-[9px] font-label-md text-label-md text-secondary hover:bg-secondary/10"
              >
                <span className="material-symbols-outlined text-[18px]">close</span> Clear
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low">
              <tr className="font-label-md text-label-md uppercase text-on-surface-variant">
                <th className="px-md py-sm">Student</th>
                <th className="px-md py-sm">Registry ID</th>
                <th className="px-md py-sm">Course / Batch</th>
                <th className="px-md py-sm">Outstanding</th>
                <th className="px-md py-sm">Fee Status</th>
                <th className="px-md py-sm">Enrollment</th>
                <th className="px-md py-sm text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-md py-xl text-center font-body-md text-body-md text-on-surface-variant">Loading…</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-md py-xl text-center font-body-md text-body-md text-error">{error} — is the backend running on :4000?</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-md py-xl text-center font-body-md text-body-md text-on-surface-variant">No students match these filters.</td>
                </tr>
              ) : (
                pageRows.map((s) => (
                  <tr key={s.id} className="hover:bg-secondary/5">
                    <td className="px-md py-sm">
                      <div className="flex items-center gap-sm">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-fixed font-label-md text-label-md text-on-primary-fixed">
                          {initials(s.fullName)}
                        </div>
                        <span className="font-body-md text-body-md text-on-surface">{s.fullName}</span>
                      </div>
                    </td>
                    <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{s.registryId}</td>
                    <td className="px-md py-sm font-body-md text-body-md">
                      {s.course || "—"}
                      {s.batch ? <span className="text-on-surface-variant"> · {s.batch}</span> : null}
                    </td>
                    <td className="px-md py-sm font-mono-data text-mono-data">
                      <span className={s.outstanding > 0 ? "text-error" : "text-on-surface-variant"}>{rs(s.outstanding)}</span>
                    </td>
                    <td className="px-md py-sm"><FeeBadge outstanding={s.outstanding} /></td>
                    <td className="px-md py-sm"><StatusPill status={s.status} /></td>
                    <td className="px-md py-sm">
                      <div className="flex items-center justify-end gap-xs">
                        <Link href={`/students/${s.id}`} className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high" title="View profile">
                          <span className="material-symbols-outlined text-[20px]">visibility</span>
                        </Link>
                        <button onClick={() => onDelete(s)} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete">
                          <span className="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && !error && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <p className="font-label-md text-label-md text-on-surface-variant">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} students
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-xs">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`h-8 min-w-8 rounded-md border px-sm font-label-md text-label-md ${
                      n === safePage
                        ? "border-secondary bg-secondary text-on-secondary"
                        : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-outline-variant text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
