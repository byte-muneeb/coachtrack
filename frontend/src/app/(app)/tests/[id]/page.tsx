"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { testsApi, getUser, type Test, type TestRosterRow, type TestMarkInput } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { fmtDate } from "@/lib/date";
import { exportCsv } from "@/lib/exportCsv";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";

const CAN_WRITE = new Set(["entity_admin", "branch_manager", "teacher"]);
const cellCls = "w-[70px] rounded-md border border-outline-variant bg-surface px-sm py-[6px] text-right font-mono-data text-mono-data outline-none focus:border-secondary disabled:bg-surface-container disabled:opacity-60";

export default function TestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [test, setTest] = useState<Test | null>(null);
  const [roster, setRoster] = useState<TestRosterRow[]>([]);
  // marks[studentId]["total"] for single tests, or marks[studentId][subjectId] for subject-wise.
  const [marks, setMarks] = useState<Record<number, Record<string, string>>>({});
  const [absent, setAbsent] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const canWrite = useMemo(() => { const u = getUser(); return u ? CAN_WRITE.has(String(u.role)) : false; }, []);
  const subjects = test?.subjects ?? [];
  const hasSubjects = subjects.length > 0;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { test, roster } = await testsApi.results(id);
      setTest(test); setRoster(roster);
      const m: Record<number, Record<string, string>> = {}; const a: Record<number, boolean> = {};
      for (const r of roster) {
        a[r.studentId] = r.absent;
        const row: Record<string, string> = {};
        if ((test.subjects?.length ?? 0) > 0) {
          for (const s of r.subjects) row[String(s.subjectId)] = s.obtainedMarks != null ? String(s.obtainedMarks) : "";
        } else if (r.obtainedMarks != null) { row.total = String(r.obtainedMarks); }
        m[r.studentId] = row;
      }
      setMarks(m); setAbsent(a);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load test"); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (!isNaN(id)) load(); }, [id, load]);

  function setCell(sid: number, key: string, val: string) {
    setMarks((p) => ({ ...p, [sid]: { ...p[sid], [key]: val } })); setMsg(null);
  }
  function rowTotal(sid: number): number {
    if (absent[sid]) return 0;
    const row = marks[sid] || {};
    if (hasSubjects) return subjects.reduce((a, s) => a + (Number(row[String(s.id)]) || 0), 0);
    return Number(row.total) || 0;
  }

  async function save() {
    if (!test) return;
    const payload: TestMarkInput[] = roster
      .filter((r) => absent[r.studentId] || Object.values(marks[r.studentId] || {}).some((v) => v !== ""))
      .map((r) => hasSubjects
        ? { studentId: r.studentId, absent: absent[r.studentId], subjects: subjects.map((s) => ({ subjectId: s.id, marks: Number((marks[r.studentId] || {})[String(s.id)]) || 0 })) }
        : { studentId: r.studentId, absent: absent[r.studentId], total: Number((marks[r.studentId] || {}).total) || 0 });
    if (!payload.length) { setError("Enter marks for at least one student."); return; }
    setSaving(true); setError(null);
    try { const res = await testsApi.saveResults(id, payload); setMsg(`Saved ${res.saved} result(s).`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  function exportResults() {
    if (!test) return;
    exportCsv(`results-${test.name}`, roster, [
      { header: "Rank", value: (r: TestRosterRow) => r.rank != null ? String(r.rank) : "" },
      { header: "Registry ID", value: (r: TestRosterRow) => r.registryId },
      { header: "Student", value: (r: TestRosterRow) => r.studentName },
      ...subjects.map((s) => ({ header: s.name, value: (r: TestRosterRow) => { const x = r.subjects.find((y) => y.subjectId === s.id); return x && x.obtainedMarks != null ? String(x.obtainedMarks) : ""; } })),
      { header: "Total", value: (r: TestRosterRow) => r.absent ? "ABSENT" : (r.obtainedMarks != null ? String(r.obtainedMarks) : "") },
      { header: "Percentage", value: (r: TestRosterRow) => r.percentage != null ? `${r.percentage}%` : "" },
      { header: "Result", value: (r: TestRosterRow) => r.absent ? "Absent" : r.passed == null ? "" : r.passed ? "Pass" : "Fail" },
    ]);
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setImporting(true); setError(null); setMsg(null);
    try {
      const rows = await parseSpreadsheet(f);
      if (!rows.length) { setError("No rows found in that file."); return; }
      const dry = await testsApi.importRows(id, { rows, validateOnly: true });
      if (dry.created === 0) { setError(`Nothing to import — ${dry.errors.length} row error(s). First: ${dry.errors[0]?.reason || "—"}`); return; }
      const res = await testsApi.importRows(id, { rows });
      setMsg(`Imported ${res.created} result(s)${res.errors.length ? `, ${res.errors.length} error(s)` : ""}.`);
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : "Import failed"); }
    finally { setImporting(false); e.target.value = ""; }
  }

  const counts = useMemo(() => {
    let recorded = 0, absentN = 0, pass = 0;
    for (const r of roster) { if (r.recorded) recorded++; if (r.absent) absentN++; if (r.passed) pass++; }
    return { recorded, absentN, pass, total: roster.length };
  }, [roster]);

  const chip = "rounded-md px-sm py-[3px] font-label-md text-label-md font-semibold";

  if (loading) return <main className="ml-[280px] pt-16 min-h-screen p-lg"><p className="text-on-surface-variant">Loading…</p></main>;
  if (!test) return <main className="ml-[280px] pt-16 min-h-screen p-lg"><p className="text-on-surface-variant">{error || "Test not found."}</p><Link href="/tests" className="text-secondary hover:underline">← Back to tests</Link></main>;

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1000px] space-y-lg">
        <PageHeader
          title={test.name}
          subtitle={`${[test.courseName, test.batchName].filter(Boolean).join(" · ")} · ${test.testDate ? fmtDate(test.testDate) : "no date"} · total ${test.totalMarks} · pass ${test.passingMarks}${hasSubjects ? ` · ${subjects.length} subjects` : ""}`}
          icon="quiz"
          actions={
            <div className="flex items-center gap-sm">
              <Link href="/tests" className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">← All tests</Link>
              <button onClick={exportResults} disabled={roster.length === 0} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50">
                <span className="material-symbols-outlined text-[18px]">download</span> Export
              </button>
              {canWrite && (
                <label className={`flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container ${importing ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                  <span className="material-symbols-outlined text-[18px]">upload_file</span> {importing ? "Importing…" : "Import marks"}
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onImport} />
                </label>
              )}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-sm">
          <span className={`${chip} bg-secondary/10 text-secondary`}>Recorded {counts.recorded}/{counts.total}</span>
          <span className={`${chip} bg-emerald-50 text-emerald-700`}>Passed {counts.pass}</span>
          <span className={`${chip} bg-error-container text-on-error-container`}>Absent {counts.absentN}</span>
        </div>

        {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-md py-sm font-body-md text-body-md text-emerald-800">{msg}</div>}
        {error && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>}

        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">#</th>
                <th className="px-md py-sm">Student</th>
                {subjects.map((s) => <th key={s.id} className="px-sm py-sm text-right" title={`max ${s.maxMarks}`}>{s.name}<span className="ml-1 font-normal opacity-60">/{s.maxMarks}</span></th>)}
                <th className="px-md py-sm text-right">Total</th>
                <th className="px-md py-sm text-right">%</th>
                <th className="px-md py-sm text-center">Result</th>
                <th className="px-md py-sm text-center">Absent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {roster.length === 0 ? (
                <tr><td colSpan={6 + subjects.length} className="px-md py-xl text-center font-body-md text-on-surface-variant">No enrolled students for this test&apos;s course/batch. Enroll students first.</td></tr>
              ) : roster.map((r) => {
                const isAbsent = !!absent[r.studentId];
                const total = rowTotal(r.studentId);
                const pct = test.totalMarks > 0 ? Math.round((total / test.totalMarks) * 1000) / 10 : 0;
                const passed = total >= test.passingMarks;
                return (
                  <tr key={r.studentId} className="hover:bg-secondary/5">
                    <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{r.rank ?? "—"}</td>
                    <td className="px-md py-sm">
                      <p className="font-body-md text-body-md font-medium text-on-surface">{r.studentName}</p>
                      <p className="font-mono-data text-mono-data text-on-surface-variant">{r.registryId}</p>
                    </td>
                    {subjects.map((s) => (
                      <td key={s.id} className="px-sm py-sm text-right">
                        <input inputMode="numeric" disabled={!canWrite || isAbsent} className={cellCls} max={s.maxMarks} min={0}
                          value={(marks[r.studentId] || {})[String(s.id)] ?? ""} onChange={(e) => setCell(r.studentId, String(s.id), e.target.value)} />
                      </td>
                    ))}
                    <td className="px-md py-sm text-right">
                      {hasSubjects ? (
                        <span className="font-mono-data text-mono-data font-semibold text-primary">{isAbsent ? "—" : total}</span>
                      ) : (
                        <input inputMode="numeric" disabled={!canWrite || isAbsent} className={cellCls} max={test.totalMarks} min={0}
                          value={(marks[r.studentId] || {}).total ?? ""} onChange={(e) => setCell(r.studentId, "total", e.target.value)} />
                      )}
                    </td>
                    <td className="px-md py-sm text-right font-mono-data text-mono-data text-on-surface-variant">{isAbsent ? "—" : `${pct}%`}</td>
                    <td className="px-md py-sm text-center">
                      {isAbsent ? <span className={`${chip} bg-surface-container text-on-surface-variant`}>Absent</span>
                        : <span className={`${chip} ${passed ? "bg-emerald-50 text-emerald-700" : "bg-error-container text-on-error-container"}`}>{passed ? "Pass" : "Fail"}</span>}
                    </td>
                    <td className="px-md py-sm text-center">
                      <input type="checkbox" disabled={!canWrite} checked={isAbsent} onChange={(e) => { setAbsent((p) => ({ ...p, [r.studentId]: e.target.checked })); setMsg(null); }} className="h-4 w-4 accent-secondary" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canWrite && roster.length > 0 && (
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="rounded-lg bg-secondary px-xl py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60">
              {saving ? "Saving…" : "Save results"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
