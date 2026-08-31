"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { attendanceApi, branchesApi, coursesApi, type Branch, type Course, type Batch, type RosterRow, type AttendanceStatus } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { exportCsv } from "@/lib/exportCsv";
import { fmtDate } from "@/lib/date";

const STATUS: { key: AttendanceStatus; label: string; on: string }[] = [
  { key: "present", label: "P", on: "bg-emerald-500 text-white ring-emerald-500" },
  { key: "absent", label: "A", on: "bg-error text-on-error ring-error" },
  { key: "late", label: "L", on: "bg-amber-500 text-black ring-amber-500" },
  { key: "leave", label: "Lv", on: "bg-secondary text-on-secondary ring-secondary" },
];

function today() { return new Date().toISOString().slice(0, 10); }
const selCls = "rounded-lg border border-outline-variant bg-surface px-md py-sm font-body-md text-body-md outline-none focus:border-secondary";

export default function AttendancePage() {
  const [date, setDate] = useState(today());
  const [branch, setBranch] = useState("all");
  const [courseId, setCourseId] = useState(0); // 0 = all
  const [batchName, setBatchName] = useState("all");
  const [search, setSearch] = useState("");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [marks, setMarks] = useState<Record<number, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    branchesApi.list().then(setBranches).catch(() => {});
    coursesApi.list().then(setCourses).catch(() => {});
  }, []);

  // When course changes, load its batches (each carries a time slot).
  useEffect(() => {
    setBatchName("all");
    if (!courseId) { setBatches([]); return; }
    coursesApi.get(courseId).then((c) => setBatches(c.batches ?? [])).catch(() => setBatches([]));
  }, [courseId]);

  const courseName = useMemo(() => courses.find((c) => c.id === courseId)?.name, [courses, courseId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setMsg(null);
    try {
      const { roster } = await attendanceApi.roster({ date, branch, course: courseName, batch: batchName, search });
      setRoster(roster);
      const init: Record<number, AttendanceStatus> = {};
      for (const r of roster) if (r.status) init[r.studentId] = r.status;
      setMarks(init);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load roster"); }
    finally { setLoading(false); }
  }, [date, branch, courseName, batchName, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 };
    for (const r of roster) { const s = marks[r.studentId]; if (s) c[s] += 1; else c.unmarked += 1; }
    return c;
  }, [roster, marks]);

  function setStatus(sid: number, s: AttendanceStatus) { setMarks((p) => ({ ...p, [sid]: s })); setMsg(null); }
  function markAll(s: AttendanceStatus) { const m: Record<number, AttendanceStatus> = {}; for (const r of roster) m[r.studentId] = s; setMarks(m); setMsg(null); }

  async function save() {
    const list = roster.filter((r) => marks[r.studentId]).map((r) => ({ studentId: r.studentId, status: marks[r.studentId] }));
    if (!list.length) { setError("Mark at least one student first."); return; }
    setSaving(true); setError(null);
    try {
      const res = await attendanceApi.mark({ date, marks: list });
      setMsg(`Saved attendance for ${res.saved} student${res.saved === 1 ? "" : "s"} on ${res.date}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setSaving(false); }
  }

  function exportRoster() {
    exportCsv(`attendance-${date}`, roster, [
      { header: "Registry ID", value: (r: RosterRow) => r.registryId },
      { header: "Student", value: (r: RosterRow) => r.studentName },
      { header: "Course", value: (r: RosterRow) => r.course || "" },
      { header: "Batch", value: (r: RosterRow) => r.batch || "" },
      { header: "Status", value: (r: RosterRow) => marks[r.studentId] || r.status || "unmarked" },
      { header: "Date", value: () => fmtDate(date) },
    ]);
  }

  const chip = "rounded-md px-sm py-[3px] font-label-md text-label-md font-semibold";

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1000px] space-y-lg">
        <PageHeader
          title="Attendance"
          subtitle="Take daily attendance by course, batch (time slot), and branch. Late still counts as attended."
          icon="fact_check"
          actions={
            <div className="flex items-center gap-sm">
              <button onClick={exportRoster} disabled={roster.length === 0}
                className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50">
                <span className="material-symbols-outlined text-[18px]">download</span> Export CSV
              </button>
              <a href="/import" className="flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container">
                <span className="material-symbols-outlined text-[18px]">upload_file</span> Import attendance
              </a>
            </div>
          }
        />

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
          <label className="flex items-center gap-xs">
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">calendar_today</span>
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} className={selCls} />
          </label>
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className={selCls} title="Branch">
              <option value="all">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <select value={courseId} onChange={(e) => setCourseId(Number(e.target.value))} className={selCls} title="Course">
            <option value={0}>All courses</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={batchName} onChange={(e) => setBatchName(e.target.value)} className={selCls} disabled={!courseId} title="Batch (time slot)">
            <option value="all">{courseId ? "All batches" : "Batch — pick a course"}</option>
            {batches.map((b) => <option key={b.id} value={b.name}>{b.name}{b.timeSlot ? ` — ${b.timeSlot}` : ""}</option>)}
          </select>
          <label className="flex flex-1 items-center gap-xs rounded-lg border border-outline-variant bg-surface px-md py-sm">
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or registry ID"
              className="w-full bg-transparent font-body-md text-body-md outline-none placeholder:text-on-surface-variant/70" />
          </label>
          <button onClick={() => markAll("present")} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md font-semibold text-on-surface hover:bg-surface-container">Mark all present</button>
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap items-center gap-sm">
          <span className={`${chip} bg-emerald-50 text-emerald-700`}>Present {counts.present}</span>
          <span className={`${chip} bg-error-container text-on-error-container`}>Absent {counts.absent}</span>
          <span className={`${chip} bg-amber-50 text-amber-700`}>Late {counts.late}</span>
          <span className={`${chip} bg-secondary/10 text-secondary`}>Leave {counts.leave}</span>
          <span className={`${chip} bg-surface-container text-on-surface-variant`}>Unmarked {counts.unmarked}</span>
        </div>

        {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-md py-sm font-body-md text-body-md text-emerald-800">{msg}</div>}
        {error && <div className="rounded-lg border border-error bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">{error}</div>}

        {/* Roster */}
        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr><th className="px-md py-sm">Student</th><th className="px-md py-sm">Course / Batch</th><th className="px-md py-sm text-right">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                <tr><td colSpan={3} className="px-md py-xl text-center font-body-md text-on-surface-variant">Loading…</td></tr>
              ) : roster.length === 0 ? (
                <tr><td colSpan={3} className="px-md py-xl text-center font-body-md text-on-surface-variant">No active students found for this filter.</td></tr>
              ) : roster.map((r) => (
                <tr key={r.studentId} className="hover:bg-secondary/5">
                  <td className="px-md py-sm">
                    <p className="font-body-md text-body-md font-medium text-on-surface">{r.studentName}</p>
                    <p className="font-mono-data text-mono-data text-on-surface-variant">{r.registryId}</p>
                  </td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{[r.course, r.batch].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-md py-sm">
                    <div className="flex items-center justify-end gap-[4px]">
                      {STATUS.map((st) => {
                        const active = marks[r.studentId] === st.key;
                        return (
                          <button key={st.key} onClick={() => setStatus(r.studentId, st.key)} title={st.key}
                            className={`h-8 w-8 rounded-lg font-label-md text-label-md font-bold ring-1 ring-inset transition-colors ${active ? st.on : "bg-surface-container text-on-surface-variant ring-outline-variant hover:bg-surface-container-high"}`}>
                            {st.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {roster.length > 0 && (
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="rounded-lg bg-secondary px-xl py-sm font-label-md text-label-md font-semibold text-on-secondary hover:opacity-90 disabled:opacity-60">
              {saving ? "Saving…" : "Save attendance"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
