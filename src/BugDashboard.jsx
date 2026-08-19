import { useState, useEffect, useMemo, useRef } from "react";
import { Bug, Plus, Download, Search, X, Trash2, CheckCircle2, Circle, Clock3, Loader2, UserCircle2, Pencil } from "lucide-react";
import { supabase } from "./supabase";

const SEVERITIES = [
  { id: "Critical", color: "#E5484D", bg: "#2A1315" },
  { id: "High", color: "#F2914A", bg: "#2B1D10" },
  { id: "Medium", color: "#E8C547", bg: "#2A2510" },
  { id: "Low", color: "#6FA8DC", bg: "#101F2B" },
];

const STATUSES = [
  { id: "Open", icon: Circle, color: "#8D97A8" },
  { id: "In Progress", icon: Clock3, color: "#5B8DEF" },
  { id: "Resolved", icon: CheckCircle2, color: "#3FB68B" },
  { id: "Closed", icon: CheckCircle2, color: "#5A6472" },
];

const sevMeta = (s) => SEVERITIES.find((x) => x.id === s) || SEVERITIES[2];
const statusMeta = (s) => STATUSES.find((x) => x.id === s) || STATUSES[0];
const initials = (name) => {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
};
const AVATAR_COLORS = ["#5B8DEF", "#3FB68B", "#F2914A", "#D4537E", "#7F77DD", "#E8C547"];
const avatarColor = (name) => {
  if (!name) return "#5A6472";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

function loadSheetJS() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

const emptyForm = {
  title: "",
  description: "",
  module: "",
  severity: "Medium",
  status: "Open",
  reporter: "",
  assignee: "",
};

export default function BugDashboard() {
  const [bugs, setBugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [severityFilter, setSeverityFilter] = useState("All");
  const [assigneeFilter, setAssigneeFilter] = useState("All");
  const [editingAssignee, setEditingAssignee] = useState(null);
  const [assigneeDraft, setAssigneeDraft] = useState("");
  const [selectedBugId, setSelectedBugId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const nextIdRef = useRef(1);

  async function loadBugs() {
    setLoading(true);
    setError("");
    try {
      const { data, error } = await supabase
        .from("bugs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const parsed = (data || []).map((b) => ({
        ...b,
        createdAt: b.created_at,
      }));

      setBugs(parsed);

      const maxNum = parsed.reduce((m, b) => {
        const n = parseInt((b.id || "BUG-0000").split("-")[1], 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      nextIdRef.current = maxNum + 1;
    } catch (e) {
      console.error(e);
      const detail = e?.message || e?.error_description || "";
      if (String(detail).toLowerCase().includes("does not exist") || String(detail).includes("42P01")) {
        setError("Database table is missing. Open Supabase SQL Editor, paste supabase.sql, and run it.");
      } else if (!import.meta.env.VITE_SUPABASE_URL && !import.meta.env.NEXT_PUBLIC_SUPABASE_URL) {
        setError("Supabase keys are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      } else {
        setError(detail ? `Couldn't load bugs: ${detail}` : "Couldn't load bugs. Check the Supabase configuration.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBugs();

    const channel = supabase
      .channel("bugs-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bugs" },
        () => loadBugs()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!selectedBugId && !pendingDelete) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (pendingDelete) setPendingDelete(null);
      else setSelectedBugId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedBugId, pendingDelete]);

  async function persist(updated) {
    setSaving(true);
    setError("");
    try {
      const changed = updated;

      // The dashboard's existing UX expects the local list to update immediately.
      setBugs(changed);

      // Database writes are handled by the individual CRUD functions below.
      return changed;
    } catch (e) {
      setError("Couldn't save. Check your connection and try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      setFormError("Enter a title for the bug.");
      return;
    }
    setFormError("");
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      module: form.module.trim(),
      severity: form.severity,
      status: form.status,
      reporter: form.reporter.trim(),
      assignee: form.assignee.trim(),
    };
    setSaving(true);
    try {
      if (editingId) {
        const previous = bugs;
        const updatedAt = new Date().toISOString();
        setBugs((current) =>
          current.map((b) => (b.id === editingId ? { ...b, ...payload, updated_at: updatedAt } : b))
        );
        const { error } = await supabase
          .from("bugs")
          .update({ ...payload, updated_at: updatedAt })
          .eq("id", editingId);
        if (error) {
          setBugs(previous);
          throw error;
        }
      } else {
        const id = `BUG-${String(nextIdRef.current).padStart(4, "0")}`;
        nextIdRef.current += 1;
        const newBug = {
          id,
          ...payload,
          createdAt: new Date().toISOString(),
        };
        const { error } = await supabase.from("bugs").insert({
          id: newBug.id,
          ...payload,
          created_at: newBug.createdAt,
        });
        if (error) throw error;
        setBugs((current) => [newBug, ...current]);
      }

      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    } catch (e) {
      console.error(e);
      setError(editingId ? "Couldn't update the bug. Please try again." : "Couldn't save the bug. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
  }

  function startEdit(bug) {
    setEditingId(bug.id);
    setForm({
      title: bug.title || "",
      description: bug.description || "",
      module: bug.module || "",
      severity: bug.severity || "Medium",
      status: bug.status || "Open",
      reporter: bug.reporter || "",
      assignee: bug.assignee || "",
    });
    setFormError("");
    setShowForm(true);
    setSelectedBugId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function updateStatus(id, status) {
    setError("");
    const previous = bugs;
    setBugs((current) => current.map((b) => (b.id === id ? { ...b, status } : b)));
    try {
      const { error } = await supabase
        .from("bugs")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setBugs(previous);
      setError("Couldn't update the status.");
    }
  }

  async function updateAssignee(id, assignee) {
    setError("");
    const cleanAssignee = assignee.trim();
    const previous = bugs;
    setBugs((current) =>
      current.map((b) => (b.id === id ? { ...b, assignee: cleanAssignee } : b))
    );
    setEditingAssignee(null);

    try {
      const { error } = await supabase
        .from("bugs")
        .update({ assignee: cleanAssignee, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setBugs(previous);
      setError("Couldn't update the assignee.");
    }
  }

  async function deleteBug(id) {
    setError("");
    const previous = bugs;
    setBugs((current) => current.filter((b) => b.id !== id));
    setPendingDelete(null);
    if (selectedBugId === id) setSelectedBugId(null);
    try {
      const { error } = await supabase.from("bugs").delete().eq("id", id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setBugs(previous);
      setError("Couldn't delete the bug.");
    }
  }

  const assignees = useMemo(() => {
    const set = new Set(bugs.filter((b) => b.assignee).map((b) => b.assignee));
    return Array.from(set).sort();
  }, [bugs]);

  const filtered = useMemo(() => {
    return bugs.filter((b) => {
      if (statusFilter !== "All" && b.status !== statusFilter) return false;
      if (severityFilter !== "All" && b.severity !== severityFilter) return false;
      if (assigneeFilter === "Unassigned" && b.assignee) return false;
      if (assigneeFilter !== "All" && assigneeFilter !== "Unassigned" && b.assignee !== assigneeFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${b.title} ${b.description} ${b.module} ${b.reporter} ${b.assignee} ${b.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bugs, statusFilter, severityFilter, assigneeFilter, search]);

  const stats = useMemo(() => {
    const total = bugs.length;
    const open = bugs.filter((b) => b.status === "Open" || b.status === "In Progress").length;
    const critical = bugs.filter((b) => b.severity === "Critical" && b.status !== "Resolved" && b.status !== "Closed").length;
    const unassigned = bugs.filter((b) => !b.assignee && b.status !== "Resolved" && b.status !== "Closed").length;
    return { total, open, critical, unassigned };
  }, [bugs]);

  async function exportExcel() {
    try {
      const XLSX = await loadSheetJS();
      const rows = filtered.map((b) => ({
        ID: b.id,
        Title: b.title,
        Description: b.description,
        Module: b.module,
        Severity: b.severity,
        Status: b.status,
        Reporter: b.reporter,
        Assignee: b.assignee,
        "Created At": b.createdAt ? new Date(b.createdAt).toLocaleString() : "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [
        { wch: 10 }, { wch: 30 }, { wch: 40 }, { wch: 16 },
        { wch: 10 }, { wch: 13 }, { wch: 16 }, { wch: 16 }, { wch: 20 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bugs");
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `bug-report-${stamp}.xlsx`);
    } catch (e) {
      setError("Couldn't export right now. Try again in a moment.");
    }
  }

  return (
    <div style={{ fontFamily: "var(--body-font)", background: "var(--bg)", color: "var(--text)", minHeight: "100vh", padding: "0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        :root {
          --bg: #10141A;
          --panel: #171D26;
          --panel-alt: #1E2530;
          --border: #2A323F;
          --text: #E7EAEE;
          --text-dim: #8D97A8;
          --accent: #5B8DEF;
          --display-font: 'Space Grotesk', sans-serif;
          --body-font: 'Inter', sans-serif;
          --mono-font: 'JetBrains Mono', monospace;
        }
        .bd-select { background: var(--panel-alt); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-family: var(--body-font); font-size: 13px; }
        .bd-input { background: var(--panel-alt); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-family: var(--body-font); font-size: 14px; width: 100%; box-sizing: border-box; }
        .bd-input:focus, .bd-select:focus { outline: none; border-color: var(--accent); }
        .bd-input::placeholder { color: var(--text-dim); }
        .bd-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; padding: 9px 14px; font-family: var(--body-font); font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: var(--panel-alt); color: var(--text); transition: background 0.15s; }
        .bd-btn:hover { background: #262E3B; }
        .bd-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
        .bd-btn-primary:hover { background: #4A7CDE; }
        .bd-chip { padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--text-dim); font-family: var(--body-font); }
        .bd-chip.active { background: var(--panel-alt); color: var(--text); border-color: var(--accent); }
        .bd-filter-label { width: 76px; flex-shrink: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); }
        .bd-filter-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
        .bd-filter-chips { display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; flex: 1; }
        .bd-row { cursor: pointer; }
        .bd-row:hover { border-color: #3A4556; background: #1A212C; }
        .bd-cols { display: grid; grid-template-columns: 90px minmax(160px, 0.7fr) minmax(220px, 1.3fr) 88px 148px 150px 64px; gap: 14px; align-items: start; min-width: 1070px; }
        .bd-list-head { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); padding: 0 14px 8px 18px; }
        .bd-overlay { position: fixed; inset: 0; background: rgba(8, 10, 14, 0.72); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 40; }
        .bd-overlay-confirm { z-index: 50; }
        .bd-btn-danger { background: #E5484D; border-color: #E5484D; color: #fff; }
        .bd-btn-danger:hover { background: #C73D42; }
        .bd-detail { width: min(560px, 100%); max-height: min(86vh, 720px); overflow: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
        .bd-scrollbar::-webkit-scrollbar { height: 6px; width: 6px; }
        .bd-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 20px 60px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--panel-alt)", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
              <Bug size={18} color="var(--accent)" />
            </div>
            <div>
              <h1 style={{ fontFamily: "var(--display-font)", fontSize: 19, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Bug report console</h1>
              <p style={{ fontSize: 12, color: "var(--text-dim)", margin: 0, fontFamily: "var(--mono-font)" }}>
                shared log &middot; {bugs.length} tracked
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="bd-btn" onClick={exportExcel}>
              <Download size={14} /> Export .xlsx
            </button>
            <button className="bd-btn bd-btn-primary" onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
              setFormError("");
              setShowForm((s) => !s);
            }}>
              <Plus size={14} /> Report bug
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#2A1315", border: "1px solid #E5484D", color: "#F5B4B4", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 22 }}>
          {[
            { label: "Total bugs", value: stats.total, color: "var(--text)" },
            { label: "Open / in progress", value: stats.open, color: "#5B8DEF" },
            { label: "Critical (unresolved)", value: stats.critical, color: "#E5484D" },
            { label: "Unassigned (open)", value: stats.unassigned, color: "#F2914A" },
          ].map((s) => (
            <div key={s.label} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
              <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</p>
              <p style={{ fontFamily: "var(--display-font)", fontSize: 24, fontWeight: 600, margin: 0, color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Form */}
        {showForm && (
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ fontFamily: "var(--display-font)", fontSize: 15, fontWeight: 600, margin: 0 }}>
                {editingId ? `Edit ${editingId}` : "Report a bug"}
              </h2>
              <button onClick={closeForm} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)" }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Title</label>
                <input className="bd-input" placeholder="Search results don't refresh after filter change" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Description</label>
                <textarea className="bd-input" rows={3} placeholder="Steps to reproduce, expected vs actual behavior" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Module / component</label>
                <input className="bd-input" placeholder="e.g. Vectora ETL, Login" value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Severity</label>
                <select className="bd-select" style={{ width: "100%" }} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Status</label>
                <select className="bd-select" style={{ width: "100%" }} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Reporter</label>
                <input className="bd-input" placeholder="Your name" value={form.reporter} onChange={(e) => setForm({ ...form, reporter: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text-dim)", display: "block", marginBottom: 5 }}>Assignee (optional)</label>
                <input className="bd-input" placeholder="Who's fixing it" value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} />
              </div>
            </div>
            {formError && <p style={{ color: "#E5484D", fontSize: 13, margin: "0 0 10px" }}>{formError}</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="bd-btn" onClick={closeForm}>Cancel</button>
              <button className="bd-btn bd-btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? <Loader2 size={14} className="bd-spin" /> : editingId ? <Pencil size={14} /> : <Plus size={14} />}
                {editingId ? "Save changes" : "Log bug"}
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", width: "100%" }}>
            <Search size={14} color="var(--text-dim)" style={{ position: "absolute", left: 10, top: 10 }} />
            <input className="bd-input" style={{ paddingLeft: 30 }} placeholder="Search bugs, module, reporter..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="bd-filter-row">
            <span className="bd-filter-label">Status</span>
            <div className="bd-filter-chips">
              {["All", ...STATUSES.map((s) => s.id)].map((s) => (
                <button key={s} className={`bd-chip ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>{s}</button>
              ))}
            </div>
          </div>
          <div className="bd-filter-row">
            <span className="bd-filter-label">Severity</span>
            <div className="bd-filter-chips">
              {["All", ...SEVERITIES.map((s) => s.id)].map((s) => (
                <button key={s} className={`bd-chip ${severityFilter === s ? "active" : ""}`} onClick={() => setSeverityFilter(s)}>{s}</button>
              ))}
            </div>
          </div>
          {assignees.length > 0 && (
            <div className="bd-filter-row">
              <span className="bd-filter-label">People</span>
              <div className="bd-filter-chips">
                {["All", "Unassigned", ...assignees].map((s) => (
                  <button key={s} className={`bd-chip ${assigneeFilter === s ? "active" : ""}`} onClick={() => setAssigneeFilter(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)", fontSize: 13 }}>Loading bug log...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", border: "1px dashed var(--border)", borderRadius: 10, color: "var(--text-dim)" }}>
            <Bug size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
            <p style={{ margin: 0, fontSize: 14 }}>{bugs.length === 0 ? "No bugs logged yet. Report the first one." : "No bugs match these filters."}</p>
          </div>
        ) : (
          <div className="bd-scrollbar" style={{ overflowX: "auto" }}>
            <div className="bd-cols bd-list-head">
              <span>ID</span>
              <span>Title</span>
              <span>Description</span>
              <span>Severity</span>
              <span>Assignee</span>
              <span>Status</span>
              <span />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((bug) => {
              const sev = sevMeta(bug.severity);
              const st = statusMeta(bug.status);
              const StIcon = st.icon;
              return (
                <div
                  key={bug.id}
                  className="bd-row"
                  onClick={() => setSelectedBugId(bug.id)}
                  style={{ display: "flex", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}
                >
                  <div style={{ width: 4, background: sev.color, flexShrink: 0 }} />
                  <div className="bd-cols" style={{ flex: 1, padding: "12px 14px" }}>
                    <div style={{ fontFamily: "var(--mono-font)", fontSize: 12, color: "var(--text-dim)", paddingTop: 2 }}>{bug.id}</div>
                    <div>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{bug.title}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-dim)" }}>
                        {bug.module || "General"}{bug.reporter ? ` · reported by ${bug.reporter}` : ""}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: bug.description ? "var(--text)" : "var(--text-dim)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {bug.description || "—"}
                    </p>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 9px", borderRadius: 999, background: sev.bg, color: sev.color, whiteSpace: "nowrap", alignSelf: "start" }}>
                      {bug.severity}
                    </span>

                    {editingAssignee === bug.id ? (
                      <input
                        autoFocus
                        className="bd-input"
                        style={{ width: "100%", padding: "5px 8px", fontSize: 12 }}
                        placeholder="Assign to..."
                        value={assigneeDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setAssigneeDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") updateAssignee(bug.id, assigneeDraft); if (e.key === "Escape") setEditingAssignee(null); }}
                        onBlur={() => updateAssignee(bug.id, assigneeDraft)}
                      />
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingAssignee(bug.id); setAssigneeDraft(bug.assignee || ""); }}
                        title="Click to assign"
                        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "1px solid var(--border)", borderRadius: 999, padding: "3px 10px 3px 3px", cursor: "pointer", alignSelf: "start" }}
                      >
                        {bug.assignee ? (
                          <span style={{ width: 18, height: 18, borderRadius: "50%", background: avatarColor(bug.assignee), color: "#0E1216", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {initials(bug.assignee)}
                          </span>
                        ) : (
                          <UserCircle2 size={16} color="var(--text-dim)" />
                        )}
                        <span style={{ fontSize: 12, color: bug.assignee ? "var(--text)" : "var(--text-dim)" }}>
                          {bug.assignee || "Unassigned"}
                        </span>
                      </button>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 5 }} onClick={(e) => e.stopPropagation()}>
                      <StIcon size={13} color={st.color} />
                      <select className="bd-select" style={{ padding: "4px 8px", fontSize: 12 }} value={bug.status} onChange={(e) => updateStatus(bug.id, e.target.value)}>
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => startEdit(bug)} title="Edit" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", padding: 4 }}>
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => setPendingDelete(bug)} title="Delete" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", padding: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {selectedBugId && (() => {
          const bug = bugs.find((b) => b.id === selectedBugId);
          if (!bug) return null;
          const sev = sevMeta(bug.severity);
          const st = statusMeta(bug.status);
          const created = bug.createdAt || bug.created_at;
          const updated = bug.updated_at;
          const field = (label, value) => (
            <div>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</p>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{value || "—"}</p>
            </div>
          );
          return (
            <div className="bd-overlay" onClick={() => setSelectedBugId(null)}>
              <div className="bd-detail bd-scrollbar" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="bug-detail-title">
                <div style={{ height: 4, background: sev.color }} />
                <div style={{ padding: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                    <div>
                      <p style={{ margin: 0, fontFamily: "var(--mono-font)", fontSize: 12, color: "var(--text-dim)" }}>{bug.id}</p>
                      <h2 id="bug-detail-title" style={{ fontFamily: "var(--display-font)", fontSize: 18, fontWeight: 600, margin: "6px 0 0" }}>{bug.title}</h2>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => startEdit(bug)} className="bd-btn" style={{ padding: "6px 10px" }}>
                        <Pencil size={14} /> Edit
                      </button>
                      <button onClick={() => setSelectedBugId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-dim)", padding: 4 }} aria-label="Close details">
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 9px", borderRadius: 999, background: sev.bg, color: sev.color }}>{bug.severity}</span>
                    <span style={{ fontSize: 11, fontWeight: 500, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border)", color: st.color }}>{bug.status}</span>
                  </div>
                  <div style={{ display: "grid", gap: 14 }}>
                    {field("Description", bug.description)}
                    {field("Module", bug.module)}
                    {field("Reporter", bug.reporter)}
                    {field("Assignee", bug.assignee)}
                    {field("Created", created ? new Date(created).toLocaleString() : "")}
                    {field("Updated", updated ? new Date(updated).toLocaleString() : "")}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {pendingDelete && (
          <div className="bd-overlay bd-overlay-confirm" onClick={() => setPendingDelete(null)}>
            <div className="bd-detail" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="delete-confirm-title">
              <div style={{ padding: 20 }}>
                <h2 id="delete-confirm-title" style={{ fontFamily: "var(--display-font)", fontSize: 17, fontWeight: 600, margin: "0 0 8px" }}>
                  Delete this bug?
                </h2>
                <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--text-dim)", lineHeight: 1.5 }}>
                  Make sure you want to delete <span style={{ fontFamily: "var(--mono-font)", color: "var(--text)" }}>{pendingDelete.id}</span>
                  {pendingDelete.title ? ` — ${pendingDelete.title}` : ""}. This cannot be undone.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button className="bd-btn" onClick={() => setPendingDelete(null)}>Cancel</button>
                  <button className="bd-btn bd-btn-danger" onClick={() => deleteBug(pendingDelete.id)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <p style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center", marginTop: 24 }}>
          This log is shared with everyone who opens this dashboard. Use "Export .xlsx" any time to download the current view as an Excel file.
        </p>
      </div>
    </div>
  );
}
