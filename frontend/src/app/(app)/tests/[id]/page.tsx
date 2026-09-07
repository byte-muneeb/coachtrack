"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { testsApi, settingsApi, getUser, type Test, type TestRosterRow, type TestStats, type TestMarkInput, type InstituteProfile } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { fmtDate } from "@/lib/date";
import { exportCsv } from "@/lib/exportCsv";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";

const CAN_WRITE = new Set(["entity_admin", "branch_manager", "teacher"]);
const cellCls = "w-[64px] rounded-md border border-outline-variant bg-surface px-sm py-[6px] text-right font-mono-data text-mono-data outline-none focus:border-secondary disabled:bg-surface-container disabled:opacity-60";

// Grade bands must mirror the backend (a failed result is always F).
const GRADE_BANDS: [number, string][] = [[80, "A+"], [70, "A"], [60, "B"], [50, "C"], [40, "D"]];
function clientGrade(pct: number | null, passed: boolean | null): string | null {
  if (pct == null || passed == null) return null;
  if (!passed) return "F";
  for (const [m, g] of GRADE_BANDS) if (pct >= m) return g;
  return "F";
}

export default function TestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [test, setTest] = useState<Test | null>(null);
  const [roster, setRoster] = useState<TestRosterRow[]>([]);
  const [stats, setStats] = useState<TestStats | null>(null);
  const [profile, setProfile] = useState<InstituteProfile | null>(null);
  const [marks, setMarks] = useState<Record<number, Record<string, string>>>({});
  const [absent, setAbsent] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showCards, setShowCards] = useState(false);

  const canWrite = useMemo(() => { const u = getUser(); return u ? CAN_WRITE.has(String(u.role)) : false; }, []);
  const subjects = test?.subjects ?? [];
  const hasSubjects = subjects.length > 0;
  const locked = !!test?.published;
  const courseWide = test != null && test.batchId == null;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { test, roster, stats } = await testsApi.results(id);
      setTest(test); setRoster(roster); setStats(stats);
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
  useEffect(() => { settingsApi.profile().then(setProfile).catch(() => {}); }, []);

  function setCell(sid: number, key: string, val: string) {
    setMarks((p) => ({ ...p, [sid]: { ...p[sid], [key]: val } })); setMsg(null);
  }
  function subjVal(sid: number, subId: number) { return Number((marks[sid] || {})[String(subId)]) || 0; }
  function subjFailing(sid: number, s: { id: number; passingMarks: number }) {
    if (!hasSubjects || absent[sid]) return false;
    const raw = (marks[sid] || {})[String(s.id)];
    return raw !== undefined && raw !== "" && s.passingMarks > 0 && subjVal(sid, s.id) < s.passingMarks;
  }
  function rowTotal(sid: number): number {
    if (absent[sid]) return 0;
    const row = marks[sid] || {};
    if (hasSubjects) return subjects.reduce((a, s) => a + Math.min(Math.max(0, Number(row[String(s.id)]) || 0), s.maxMarks), 0);
    return Math.min(Math.max(0, Number(row.total) || 0), test?.totalMarks ?? Infinity);
  }
  // Live overall result using the subject rule: fail if any subject below its pass mark.
  function rowResult(sid: number) {
    if (!test || absent[sid]) return { passed: false, pct: null as number | null, grade: null as string | null };
    const total = rowTotal(sid);
    const anyFail = subjects.some((s) => subjFailing(sid, s));
    const passed = total >= test.passingMarks && !anyFail;
    const pct = test.totalMarks > 0 ? Math.round((total / test.totalMarks) * 1000) / 10 : 0;
    return { passed, pct, grade: clientGrade(pct, passed) };
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

  async function togglePublish() {
    if (!test) return;
    setError(null);
    try { await testsApi.publish(id, !locked); setMsg(locked ? "Unpublished — results are editable again." : "Results published and locked."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to change publish state"); }
  }

  function exportResults() {
    if (!test) return;
    exportCsv(`results-${test.name}`, roster, [
      { header: "Rank", value: (r: TestRosterRow) => r.rank != null ? String(r.rank) : "" },
      ...(courseWide ? [{ header: "Batch Rank", value: (r: TestRosterRow) => r.batchRank != null ? String(r.batchRank) : "" }] : []),
      { header: "Registry ID", value: (r: TestRosterRow) => r.registryId },
      { header: "Student", value: (r: TestRosterRow) => r.studentName },
      ...subjects.map((s) => ({ header: `${s.name} (/${s.maxMarks})`, value: (r: TestRosterRow) => { const x = r.subjects.find((y) => y.subjectId === s.id); return x && x.obtainedMarks != null ? String(x.obtainedMarks) : ""; } })),
      { header: "Total", value: (r: TestRosterRow) => r.absent ? "ABSENT" : (r.obtainedMarks != null ? String(r.obtainedMarks) : "") },
      { header: "Percentage", value: (r: TestRosterRow) => r.percentage != null ? `${r.percentage}%` : "" },
      { header: "Grade", value: (r: TestRosterRow) => r.grade || "" },
      { header: "Failed Subjects", value: (r: TestRosterRow) => r.failedSubjects.join("; ") },
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
  const colSpan = 7 + subjects.length + (courseWide ? 1 : 0);

  if (loading) return <main className="ml-[280px] pt-16 min-h-screen p-lg"><p className="text-on-surface-variant">Loading…</p></main>;
  if (!test) return <main className="ml-[280px] pt-16 min-h-screen p-lg"><p className="text-on-surface-variant">{error || "Test not found."}</p><Link href="/tests" className="text-secondary hover:underline">← Back to tests</Link></main>;

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1100px] space-y-lg">
        <PageHeader
          title={test.name}
          subtitle={`${[test.courseName, test.batchName].filter(Boolean).join(" · ")} · ${test.testDate ? fmtDate(test.testDate) : "no date"} · total ${test.totalMarks} · pass ${test.passingMarks}${hasSubjects ? ` · ${subjects.length} subjects` : ""}`}
          icon="quiz"
          actions={
            <div className="flex flex-wrap items-center gap-sm">
              <Link href="/tests" className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">← All tests</Link>
              <button onClick={() => setShowCards(true)} disabled={counts.recorded === 0} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50">
                <span className="material-symbols-outlined text-[18px]">description</span> Result cards
              </button>
              <button onClick={exportResults} disabled={roster.length === 0} className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50">
                <span className="material-symbols-outlined text-[18px]">download</span> Export
              </button>
              {canWrite && !locked && (
                <label className={`flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container ${importing ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                  <span className="material-symbols-outlined text-[18px]">upload_file</span> {importing ? "Importing…" : "Import marks"}
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onImport} />
                </label>
              )}
              {canWrite && (
                <button onClick={togglePublish} className={`flex items-center gap-xs rounded-lg px-md py-sm font-label-md text-label-md font-semibold ${locked ? "border border-outline-variant text-on-surface hover:bg-surface-container" : "bg-primary text-on-primary hover:opacity-90"}`}>
                  <span className="material-symbols-outlined text-[18px]">{locked ? "lock_open" : "publish"}</span> {locked ? "Unpublish" : "Publish"}
                </button>
              )}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-sm">
          {locked && <span className={`${chip} bg-primary/10 text-primary`}>Published · locked</span>}
          <span className={`${chip} bg-secondary/10 text-secondary`}>Recorded {counts.recorded}/{counts.total}</span>
          <span className={`${chip} bg-emerald-50 text-emerald-700`}>Passed {counts.pass}</span>
          <span className={`${chip} bg-error-container text-on-error-container`}>Absent {counts.absentN}</span>
          {stats?.overall && <span className={`${chip} bg-surface-container text-on-surface-variant`}>Class avg {stats.overall.avg} · high {stats.overall.high} · low {stats.overall.low}</span>}
        </div>

        {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-md py-sm font-body-md text-body-md text-emerald-800">{msg}</div>}
        {error && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>}
        {locked && <div className="rounded-lg border border-primary/30 bg-primary/5 px-md py-sm font-body-md text-body-md text-primary">Results are published and locked. Unpublish to edit marks.</div>}

        <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="px-md py-sm">#</th>
                {courseWide && <th className="px-sm py-sm" title="Rank within batch">B#</th>}
                <th className="px-md py-sm">Student</th>
                {subjects.map((s) => <th key={s.id} className="px-sm py-sm text-right" title={`max ${s.maxMarks}${s.passingMarks > 0 ? `, pass ${s.passingMarks}` : ""}`}>{s.name}<span className="ml-1 font-normal opacity-60">/{s.maxMarks}</span></th>)}
                <th className="px-md py-sm text-right">Total</th>
                <th className="px-md py-sm text-right">%</th>
                <th className="px-md py-sm text-center">Grade</th>
                <th className="px-md py-sm text-center">Result</th>
                <th className="px-md py-sm text-center">Absent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {roster.length === 0 ? (
                <tr><td colSpan={colSpan} className="px-md py-xl text-center font-body-md text-on-surface-variant">No enrolled students for this test&apos;s course/batch. Enroll students first.</td></tr>
              ) : roster.map((r) => {
                const isAbsent = !!absent[r.studentId];
                const total = rowTotal(r.studentId);
                const { passed, pct, grade } = rowResult(r.studentId);
                return (
                  <tr key={r.studentId} className="hover:bg-secondary/5">
                    <td className="px-md py-sm font-mono-data text-mono-data text-on-surface-variant">{r.rank ?? "—"}</td>
                    {courseWide && <td className="px-sm py-sm font-mono-data text-mono-data text-on-surface-variant">{r.batchRank ?? "—"}</td>}
                    <td className="px-md py-sm">
                      <p className="font-body-md text-body-md font-medium text-on-surface">{r.studentName}</p>
                      <p className="font-mono-data text-mono-data text-on-surface-variant">{r.registryId}</p>
                    </td>
                    {subjects.map((s) => {
                      const failing = subjFailing(r.studentId, s);
                      return (
                        <td key={s.id} className="px-sm py-sm text-right">
                          <input inputMode="numeric" disabled={!canWrite || isAbsent || locked} max={s.maxMarks} min={0}
                            title={failing ? `Below passing (${s.passingMarks})` : undefined}
                            className={`${cellCls} ${failing ? "border-error text-error" : ""}`}
                            value={(marks[r.studentId] || {})[String(s.id)] ?? ""} onChange={(e) => setCell(r.studentId, String(s.id), e.target.value)} />
                        </td>
                      );
                    })}
                    <td className="px-md py-sm text-right">
                      {hasSubjects ? (
                        <span className="font-mono-data text-mono-data font-semibold text-primary">{isAbsent ? "—" : total}</span>
                      ) : (
                        <input inputMode="numeric" disabled={!canWrite || isAbsent || locked} className={cellCls} max={test.totalMarks} min={0}
                          value={(marks[r.studentId] || {}).total ?? ""} onChange={(e) => setCell(r.studentId, "total", e.target.value)} />
                      )}
                    </td>
                    <td className="px-md py-sm text-right font-mono-data text-mono-data text-on-surface-variant">{isAbsent ? "—" : `${pct}%`}</td>
                    <td className="px-md py-sm text-center font-label-md text-label-md font-bold">{isAbsent ? "—" : grade}</td>
                    <td className="px-md py-sm text-center">
                      {isAbsent ? <span className={`${chip} bg-surface-container text-on-surface-variant`}>Absent</span>
                        : <span className={`${chip} ${passed ? "bg-emerald-50 text-emerald-700" : "bg-error-container text-on-error-container"}`} title={!passed && r.failedSubjects.length ? `Failed: ${r.failedSubjects.join(", ")}` : undefined}>{passed ? "Pass" : "Fail"}</span>}
                    </td>
                    <td className="px-md py-sm text-center">
                      <input type="checkbox" disabled={!canWrite || locked} checked={isAbsent} onChange={(e) => { setAbsent((p) => ({ ...p, [r.studentId]: e.target.checked })); setMsg(null); }} className="h-4 w-4 accent-secondary" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Class statistics per subject */}
        {stats && stats.perSubject.length > 0 && stats.count > 0 && (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
            <p className="mb-sm font-label-md text-label-md uppercase text-on-surface-variant">Class statistics (subject-wise)</p>
            <div className="flex flex-wrap gap-sm">
              {stats.perSubject.map((s) => (
                <span key={s.subjectId} className="rounded-lg border border-outline-variant px-md py-xs font-label-md text-label-md">
                  <b>{s.name}</b> · avg {s.avg ?? "—"} · high {s.high ?? "—"} · low {s.low ?? "—"}
                </span>
              ))}
            </div>
          </div>
        )}

        {canWrite && !locked && roster.length > 0 && (
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="rounded-lg bg-secondary px-xl py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60">
              {saving ? "Saving…" : "Save results"}
            </button>
          </div>
        )}
      </div>

      {showCards && <ResultCards test={test} rows={roster.filter((r) => r.recorded)} stats={stats} profile={profile} courseWide={courseWide} onClose={() => setShowCards(false)} />}
    </main>
  );
}

/* ------------------------------ Official B/W result cards ------------------------------ */
function ResultCards({ test, rows, stats, profile, courseWide, onClose }: {
  test: Test; rows: TestRosterRow[]; stats: TestStats | null; profile: InstituteProfile | null; courseWide: boolean; onClose: () => void;
}) {
  const name = profile?.name || "Coaching Centre";
  const line2 = [profile?.address, profile?.city].filter(Boolean).join(", ");
  const subjects = test.subjects ?? [];
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/50 p-lg print:static print:bg-white print:p-0">
      <div className="w-full max-w-[760px]">
        <div className="mb-md flex items-center justify-end gap-sm no-print">
          <button onClick={() => window.print()} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
            <span className="material-symbols-outlined text-[18px]">print</span> Print {rows.length}
          </button>
          <button onClick={onClose} className="rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-label-md text-label-md text-on-surface hover:bg-surface-container-high">Close</button>
        </div>
        <div className="space-y-lg">
          {rows.map((r) => (
            <div key={r.studentId} className="print-area relative border border-black bg-white p-xl text-black" style={{ breakAfter: "page" }}>
              {!test.published && <span className="pointer-events-none absolute right-[40px] top-[120px] -rotate-[12deg] border-[3px] border-black px-md py-[2px] text-[28px] font-black tracking-widest opacity-40">DRAFT</span>}
              <div className="border-b-2 border-black pb-md text-center">
                <p className="text-[20px] font-bold uppercase tracking-wide">{name}</p>
                {line2 ? <p className="text-[12px]">{line2}</p> : null}
                <p className="mt-sm text-[13px] font-semibold uppercase tracking-[0.25em]">Result Card</p>
              </div>
              <div className="mt-md grid grid-cols-2 gap-x-lg gap-y-[2px] text-[12px]">
                <div className="flex justify-between border-b border-black/40 py-[3px]"><span>Student</span><span className="font-medium">{r.studentName}</span></div>
                <div className="flex justify-between border-b border-black/40 py-[3px]"><span>Roll No</span><span className="font-mono-data">{r.registryId}</span></div>
                <div className="flex justify-between border-b border-black/40 py-[3px]"><span>Test</span><span className="font-medium">{test.name}</span></div>
                <div className="flex justify-between border-b border-black/40 py-[3px]"><span>Course</span><span>{test.courseName || "—"}</span></div>
                <div className="flex justify-between border-b border-black/40 py-[3px]"><span>Date</span><span>{test.testDate ? fmtDate(test.testDate) : "—"}</span></div>
                <div className="flex justify-between border-b border-black/40 py-[3px]"><span>Position</span><span className="font-semibold">{r.absent ? "—" : `${r.rank ?? "—"}${courseWide && r.batchRank ? ` (batch ${r.batchRank})` : ""}`}</span></div>
              </div>

              {subjects.length > 0 && (
                <table className="mt-lg w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-y-2 border-black text-[11px] uppercase tracking-wide">
                      <th className="py-[6px]">Subject</th>
                      <th className="py-[6px] text-right">Max</th>
                      <th className="py-[6px] text-right">Passing</th>
                      <th className="py-[6px] text-right">Obtained</th>
                      <th className="py-[6px] text-center">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.subjects.map((su) => (
                      <tr key={su.subjectId} className="border-b border-black/25">
                        <td className="py-[6px]">{su.name}</td>
                        <td className="py-[6px] text-right font-mono-data">{su.maxMarks}</td>
                        <td className="py-[6px] text-right font-mono-data">{su.passingMarks || "—"}</td>
                        <td className="py-[6px] text-right font-mono-data">{r.absent ? "AB" : (su.obtainedMarks ?? "—")}</td>
                        <td className="py-[6px] text-center">{su.passed == null ? "—" : su.passed ? "Pass" : "Fail"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <div className="mt-sm flex items-stretch justify-between gap-md">
                <div className="flex-1 border-2 border-black px-md py-sm">
                  <div className="flex justify-between text-[12px]"><span>Total</span><span className="font-mono-data font-bold">{r.absent ? "ABSENT" : `${r.obtainedMarks ?? 0} / ${test.totalMarks}`}</span></div>
                  <div className="flex justify-between text-[12px]"><span>Percentage</span><span className="font-mono-data">{r.percentage != null ? `${r.percentage}%` : "—"}</span></div>
                </div>
                <div className="flex w-[160px] flex-col items-center justify-center border-2 border-black px-md py-sm">
                  <span className="text-[11px] uppercase tracking-wide">Grade / Result</span>
                  <span className="text-[22px] font-black leading-tight">{r.absent ? "ABS" : r.grade}</span>
                  <span className="text-[12px] font-bold">{r.absent ? "Absent" : r.passed ? "PASS" : "FAIL"}</span>
                </div>
              </div>
              {!r.absent && !r.passed && r.failedSubjects.length > 0 && (
                <p className="mt-sm text-[12px]">Failed subject(s): <b>{r.failedSubjects.join(", ")}</b></p>
              )}
              {stats?.overall && <p className="mt-sm text-[11px]">Class average {stats.overall.avg} · highest {stats.overall.high} · lowest {stats.overall.low}</p>}
              <div className="mt-xl grid grid-cols-2 gap-xl">
                <div className="border-t border-black pt-xs text-center text-[11px] uppercase tracking-wide">Teacher / Examiner</div>
                <div className="border-t border-black pt-xs text-center text-[11px] uppercase tracking-wide">Principal Signature</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
