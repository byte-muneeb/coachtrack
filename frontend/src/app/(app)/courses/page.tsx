"use client";

import { useCallback, useEffect, useState } from "react";
import { coursesApi, type Course, type Batch } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { inputCls } from "@/components/form";
import { fmtDate } from "@/lib/date";

const rs = (n: number) => "Rs " + Number(n || 0).toLocaleString("en-PK");

type CourseForm = {
  name: string; code: string; level: string; durationMonths: string;
  admissionFee: string; monthlyFee: string; examFee: string; status: string; description: string;
};
const EMPTY_COURSE: CourseForm = {
  name: "", code: "", level: "Beginner", durationMonths: "",
  admissionFee: "0", monthlyFee: "0", examFee: "0", status: "active", description: "",
};

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [courseModal, setCourseModal] = useState<null | { mode: "new" | "edit"; id?: number }>(null);
  const [form, setForm] = useState<CourseForm>(EMPTY_COURSE);
  const [saving, setSaving] = useState(false);

  const [batchCourse, setBatchCourse] = useState<Course | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setCourses(await coursesApi.list(search)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  function openNew() { setForm(EMPTY_COURSE); setCourseModal({ mode: "new" }); }
  function openEdit(c: Course) {
    setForm({
      name: c.name, code: c.code || "", level: c.level || "Beginner",
      durationMonths: c.durationMonths?.toString() || "", admissionFee: String(c.admissionFee),
      monthlyFee: String(c.monthlyFee), examFee: String(c.examFee), status: c.status,
      description: c.description || "",
    });
    setCourseModal({ mode: "edit", id: c.id });
  }

  async function saveCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name, code: form.code || null, level: form.level,
        durationMonths: form.durationMonths ? Number(form.durationMonths) : null,
        admissionFee: Number(form.admissionFee) || 0, monthlyFee: Number(form.monthlyFee) || 0,
        examFee: Number(form.examFee) || 0, status: form.status, description: form.description || null,
      };
      if (courseModal?.mode === "edit" && courseModal.id)
        await coursesApi.update(courseModal.id, payload);
      else await coursesApi.create(payload);
      setCourseModal(null);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  }

  async function deleteCourse(c: Course) {
    if (!confirm(`Delete "${c.name}" and its batches?`)) return;
    try { await coursesApi.remove(c.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Delete failed"); }
  }

  const setF = (k: keyof CourseForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <main className="ml-[280px] pt-16 min-h-screen p-lg">
      <div className="mx-auto max-w-[1440px] space-y-lg">
        <PageHeader
          title="Courses & Programs"
          subtitle="Define courses, fee structure, and teaching batches."
          icon="school"
          actions={
            <button onClick={openNew} className="flex items-center gap-xs rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90">
              <span className="material-symbols-outlined text-[18px]">add</span> New Course
            </button>
          }
        />

        <label className="flex max-w-[420px] items-center gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm">
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses…"
            className="w-full bg-transparent font-body-md text-body-md outline-none placeholder:text-on-surface-variant" />
        </label>

        {loading ? (
          <p className="font-body-md text-on-surface-variant">Loading…</p>
        ) : error ? (
          <p className="font-body-md text-error">{error} — is the backend running on :4000?</p>
        ) : courses.length === 0 ? (
          <p className="font-body-md text-on-surface-variant">No courses yet. Click “New Course”.</p>
        ) : (
          <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
            {courses.map((c) => (
              <div key={c.id} className="flex flex-col rounded-xl border border-outline-variant bg-surface-container-lowest p-lg">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-headline-md text-headline-md font-semibold text-primary">{c.name}</h3>
                    <p className="font-label-md text-label-md text-on-surface-variant">
                      {c.code || "—"} · {c.level || "—"} · {c.durationMonths ? `${c.durationMonths} mo` : "—"}
                    </p>
                  </div>
                  <span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${c.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{c.status}</span>
                </div>

                <div className="my-md grid grid-cols-3 gap-xs">
                  <div className="rounded-md bg-surface-container-low p-sm">
                    <p className="font-label-md text-label-md text-on-surface-variant">Admission</p>
                    <p className="font-mono-data text-mono-data text-on-surface">{rs(c.admissionFee)}</p>
                  </div>
                  <div className="rounded-md bg-surface-container-low p-sm">
                    <p className="font-label-md text-label-md text-on-surface-variant">Monthly</p>
                    <p className="font-mono-data text-mono-data text-on-surface">{rs(c.monthlyFee)}</p>
                  </div>
                  <div className="rounded-md bg-surface-container-low p-sm">
                    <p className="font-label-md text-label-md text-on-surface-variant">Exam</p>
                    <p className="font-mono-data text-mono-data text-on-surface">{rs(c.examFee)}</p>
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between pt-sm">
                  <button onClick={() => setBatchCourse(c)} className="flex items-center gap-xs font-label-md text-label-md text-secondary hover:underline">
                    <span className="material-symbols-outlined text-[18px]">calendar_month</span>
                    {c.batchCount ?? 0} batch{(c.batchCount ?? 0) === 1 ? "" : "es"}
                  </button>
                  <div className="flex gap-xs">
                    <button onClick={() => openEdit(c)} className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high" title="Edit">
                      <span className="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button onClick={() => deleteCourse(c)} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container" title="Delete">
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Course form modal */}
      {courseModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={() => setCourseModal(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveCourse}
            className="w-full max-w-[640px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
            <h2 className="font-headline-md text-headline-md font-semibold text-primary">
              {courseModal.mode === "edit" ? "Edit Course" : "New Course"}
            </h2>
            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Course Name *</span><input className={inputCls} value={form.name} onChange={setF("name")} required /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Code</span><input className={inputCls} value={form.code} onChange={setF("code")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Level</span>
                <select className={inputCls} value={form.level} onChange={setF("level")}>
                  {["Beginner", "Intermediate", "Advanced", "Expert"].map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Duration (months)</span><input type="number" min={0} inputMode="numeric" className={inputCls} value={form.durationMonths} onChange={setF("durationMonths")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Status</span>
                <select className={inputCls} value={form.status} onChange={setF("status")}>
                  {["active", "inactive", "draft"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Admission Fee (Rs)</span><input type="number" min={0} inputMode="numeric" className={inputCls} value={form.admissionFee} onChange={setF("admissionFee")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Monthly Fee (Rs)</span><input type="number" min={0} inputMode="numeric" className={inputCls} value={form.monthlyFee} onChange={setF("monthlyFee")} /></label>
              <label className="flex flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Exam Fee (Rs)</span><input type="number" min={0} inputMode="numeric" className={inputCls} value={form.examFee} onChange={setF("examFee")} /></label>
              <label className="flex flex-col gap-xs sm:col-span-2"><span className="font-label-md text-label-md text-on-surface-variant">Description</span><textarea className={inputCls} rows={2} value={form.description} onChange={setF("description")} /></label>
            </div>
            <div className="flex justify-end gap-sm pt-sm">
              <button type="button" onClick={() => setCourseModal(null)} className="rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}

      {/* Batches modal */}
      {batchCourse && (
        <BatchManager course={batchCourse} onClose={() => setBatchCourse(null)} onChanged={load} />
      )}
    </main>
  );
}

function BatchManager({ course, onClose, onChanged }: { course: Course; onClose: () => void; onChanged: () => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [timeSlot, setTimeSlot] = useState("");
  const [teacher, setTeacher] = useState("");
  const [monthlyFee, setMonthlyFee] = useState("0");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const c = await coursesApi.get(course.id); setBatches(c.batches || []); }
    finally { setLoading(false); }
  }, [course.id]);

  useEffect(() => { reload(); }, [reload]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await coursesApi.addBatch(course.id, {
        name, timeSlot: timeSlot || null, teacher: teacher || null,
        monthlyFee: Number(monthlyFee) || 0, startDate: startDate || null,
        endDate: endDate || null, status,
      });
      setName(""); setTimeSlot(""); setTeacher("");
      setMonthlyFee("0"); setStartDate(""); setEndDate(""); setStatus("active");
      await reload(); onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }
  async function del(b: Batch) {
    if (!confirm(`Delete batch "${b.name}"?`)) return;
    try { await coursesApi.removeBatch(course.id, b.id); await reload(); onChanged(); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-md" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[720px] space-y-md rounded-xl bg-surface-container-lowest p-lg shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-headline-md text-headline-md font-semibold text-primary">Batches — {course.name}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-container-high">
            <span className="material-symbols-outlined text-on-surface-variant">close</span>
          </button>
        </div>

        <form onSubmit={add} className="flex flex-wrap items-end gap-sm rounded-lg border border-outline-variant bg-surface-container-low p-md">
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Batch name *</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning A" required /></label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Time slot</span><input className={inputCls} value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} placeholder="08:00 AM" /></label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Teacher</span><input className={inputCls} value={teacher} onChange={(e) => setTeacher(e.target.value)} /></label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Monthly Fee (Rs) *</span><input type="number" min={0} inputMode="numeric" className={inputCls} value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} required /></label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Start date</span><input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">End date</span><input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-xs"><span className="font-label-md text-label-md text-on-surface-variant">Status</span>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {["upcoming", "active", "completed"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy} className="rounded-lg bg-secondary px-md py-sm font-label-md text-label-md text-on-secondary hover:opacity-90 disabled:opacity-60">{busy ? "Adding…" : "Add batch"}</button>
        </form>

        {loading ? (
          <p className="font-body-md text-on-surface-variant">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="font-body-md text-on-surface-variant">No batches yet.</p>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-surface-container-low font-label-md text-label-md uppercase text-on-surface-variant">
              <tr><th className="px-md py-sm">Batch</th><th className="px-md py-sm">Time</th><th className="px-md py-sm">Teacher</th><th className="px-md py-sm">Fee</th><th className="px-md py-sm">Dates</th><th className="px-md py-sm">Status</th><th className="px-md py-sm text-right">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="px-md py-sm font-body-md text-body-md">{b.name}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{b.timeSlot || "—"}</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{b.teacher || "—"}</td>
                  <td className="px-md py-sm font-mono-data text-mono-data text-on-surface">{rs(b.monthlyFee)}/mo</td>
                  <td className="px-md py-sm font-body-md text-body-md text-on-surface-variant">{b.startDate || b.endDate ? `${fmtDate(b.startDate) || "—"} → ${fmtDate(b.endDate) || "—"}` : "—"}</td>
                  <td className="px-md py-sm">
                    <span className={`rounded-full px-sm py-[2px] font-label-md text-label-md capitalize ${b.status === "active" ? "bg-green-100 text-green-800" : "bg-surface-container-high text-on-surface-variant"}`}>{b.status}</span>
                  </td>
                  <td className="px-md py-sm text-right">
                    <button onClick={() => del(b)} className="flex h-8 w-8 items-center justify-center rounded-md text-error hover:bg-error-container ml-auto" title="Delete">
                      <span className="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
