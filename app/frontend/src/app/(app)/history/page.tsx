"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Badge from "@/components/ui/Badge";

interface DraftItem {
  id: number;
  status: string;
  version: number;
  primary_text: string;
  alternate_hooks_json: string;
  grounding_summary: string;
  rationale: string;
  confidence_score: number;
  prompt_version: string;
  created_at: string;
  campaign_name: string;
  campaign_id: number | null;
  headline: string;
  narrative_type: string;
  selection_date: string;
  published_at: string | null;
  linkedin_post_ref: string | null;
  has_feedback: boolean;
}

interface Feedback {
  id?: number;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  clicks: number | null;
  performance_rating: string | null;
  what_worked: string | null;
  what_didnt_work: string | null;
  audience_reaction_notes: string | null;
  improvement_notes: string | null;
  effective_elements: string[];
}

const EMPTY_FEEDBACK: Feedback = {
  impressions: null, reactions: null, comments: null, reposts: null, clicks: null,
  performance_rating: null, what_worked: null, what_didnt_work: null,
  audience_reaction_notes: null, improvement_notes: null, effective_elements: [],
};

const RATING_OPTIONS = [
  { value: "great", label: "Great", color: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  { value: "good", label: "Good", color: "bg-sky-100 text-sky-700 border-sky-300" },
  { value: "average", label: "Average", color: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "poor", label: "Poor", color: "bg-rose-100 text-rose-700 border-rose-300" },
];

const EFFECTIVE_ELEMENTS = [
  "strong_hook", "personal_story", "data_driven", "contrarian_take",
  "actionable_tips", "question_ending", "short_paragraphs", "trend_reference",
  "industry_insight", "vulnerability", "humor",
];

const CAMPAIGN_COLORS = [
  { tag: "bg-indigo-100 text-indigo-700" },
  { tag: "bg-emerald-100 text-emerald-700" },
  { tag: "bg-amber-100 text-amber-700" },
  { tag: "bg-rose-100 text-rose-700" },
  { tag: "bg-sky-100 text-sky-700" },
  { tag: "bg-purple-100 text-purple-700" },
];

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return dateStr; }
}

function fmtDateTime(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return dateStr; }
}

function getCampaignColor(id: number | null) {
  if (!id) return CAMPAIGN_COLORS[0];
  return CAMPAIGN_COLORS[(id - 1) % CAMPAIGN_COLORS.length];
}

type ViewMode = "all" | "published" | "approved" | "pending_review" | "rejected" | "queued";

export default function HistoryPage() {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [publishResult, setPublishResult] = useState<{ id: number; message: string; error?: boolean } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [feedbackForId, setFeedbackForId] = useState<number | null>(null);
  const [feedbackData, setFeedbackData] = useState<Feedback>({ ...EMPTY_FEEDBACK });
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState<number | null>(null);
  const [lockedFeedback, setLockedFeedback] = useState<Record<number, Feedback>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  useEffect(() => {
    api.get<DraftItem[]>("/api/drafts/").then(setDrafts).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Actions
  async function handlePublish(id: number) {
    setPublishingId(id);
    setPublishResult(null);
    try {
      const result = await api.post<{ id: number; message: string }>(`/api/drafts/${id}/publish`);
      setPublishResult({ id, message: result.message });
      setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, status: "queued" } : d));
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setPublishResult({ id, message: err?.body?.detail || err?.message || "Failed", error: true });
    } finally { setPublishingId(null); }
  }

  function handleCopy(id: number, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleRevert(id: number) {
    await api.post(`/api/drafts/${id}/revert`).catch(() => {});
    setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, status: "pending_review" } : d));
  }

  async function handleArchive(id: number) {
    await api.post(`/api/drafts/${id}/archive`).catch(() => {});
    setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, status: "archived" } : d));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function handleBulkArchive() {
    await Promise.all(Array.from(selected).map((id) => api.post(`/api/drafts/${id}/archive`).catch(() => {})));
    setDrafts((prev) => prev.map((d) => selected.has(d.id) ? { ...d, status: "archived" } : d));
    setSelected(new Set());
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this draft permanently?")) return;
    await api.delete(`/api/drafts/${id}`).catch(() => {});
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selected.size} draft(s) permanently?`)) return;
    await Promise.all(Array.from(selected).map((id) => api.delete(`/api/drafts/${id}`).catch(() => {})));
    setDrafts((prev) => prev.filter((d) => !selected.has(d.id)));
    setSelected(new Set());
  }

  function toggleSelect(id: number) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function toggleSelectAll(ids: number[]) {
    setSelected((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const n = new Set(prev);
      if (allSelected) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  function toggleMonth(month: string) {
    setCollapsedMonths((prev) => { const n = new Set(prev); if (n.has(month)) n.delete(month); else n.add(month); return n; });
  }

  async function openFeedback(draft: DraftItem) {
    setFeedbackForId(draft.id);
    setFeedbackSaved(null);
    try {
      const existing = await api.get<Feedback | null>(`/api/drafts/${draft.id}/feedback`);
      if (existing && existing.performance_rating) {
        setLockedFeedback((prev) => ({ ...prev, [draft.id]: existing }));
        setFeedbackData(existing);
      } else { setFeedbackData({ ...EMPTY_FEEDBACK }); }
    } catch { setFeedbackData({ ...EMPTY_FEEDBACK }); }
  }

  async function handleSaveFeedback(draftId: number, campaignId: number | null) {
    setSavingFeedback(true);
    try {
      await api.put(`/api/drafts/${draftId}/feedback`, { campaign_id: campaignId || 0, ...feedbackData });
      setLockedFeedback((prev) => ({ ...prev, [draftId]: feedbackData }));
      setFeedbackSaved(draftId);
    } catch (e) { alert(e instanceof Error ? e.message : "Save failed"); }
    finally { setSavingFeedback(false); }
  }

  function toggleElement(el: string) {
    setFeedbackData((prev) => ({
      ...prev,
      effective_elements: prev.effective_elements.includes(el) ? prev.effective_elements.filter((e) => e !== el) : [...prev.effective_elements, el],
    }));
  }

  // Filter and group
  const visible = drafts.filter((d) => showArchived || d.status !== "archived");
  const filtered = view === "all" ? visible : visible.filter((d) => d.status === view);
  const counts: Record<string, number> = {
    all: visible.filter((d) => d.status !== "archived").length,
    published: drafts.filter((d) => d.status === "published").length,
    approved: drafts.filter((d) => d.status === "approved").length,
    queued: drafts.filter((d) => d.status === "queued").length,
    pending_review: drafts.filter((d) => d.status === "pending_review").length,
    rejected: drafts.filter((d) => d.status === "rejected").length,
    archived: drafts.filter((d) => d.status === "archived").length,
  };

  // Group by month
  const grouped: Record<string, DraftItem[]> = {};
  for (const d of filtered) {
    const date = d.published_at || d.selection_date || d.created_at;
    const month = date ? date.substring(0, 7) : "unknown";
    const label = month !== "unknown" ? new Date(month + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Other";
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(d);
  }
  const months = Object.keys(grouped);

  if (loading) {
    return (<div className="p-8"><div className="animate-pulse space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg" /><div className="h-32 bg-gray-100 rounded-xl" /></div></div>);
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">History</h1>
          <p className="text-sm text-gray-500 mt-1">{counts.published} published, {counts.approved + counts.queued} ready</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setViewMode("list")} className={`rounded-md px-2.5 py-1 text-[10px] font-medium ${viewMode === "list" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
              List
            </button>
            <button onClick={() => setViewMode("calendar")} className={`rounded-md px-2.5 py-1 text-[10px] font-medium ${viewMode === "calendar" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
              Calendar
            </button>
          </div>
          {counts.archived > 0 && viewMode === "list" && (
            <button onClick={() => setShowArchived(!showArchived)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${showArchived ? "border-violet-200 bg-violet-50 text-violet-700" : "border-gray-200 text-gray-400 hover:text-gray-600"}`}>
              {showArchived ? `Hide archived (${counts.archived})` : `Show archived (${counts.archived})`}
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-2.5 mb-4 flex items-center justify-between animate-fade-in">
          <span className="text-xs font-medium text-indigo-700">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={handleBulkArchive} className="rounded-md bg-white border border-indigo-200 px-3 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
              Archive
            </button>
            <button onClick={handleBulkDelete} className="rounded-md bg-white border border-rose-200 px-3 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-[11px] text-gray-400 hover:text-gray-600 ml-1">Clear</button>
          </div>
        </div>
      )}

      {/* Calendar view */}
      {viewMode === "calendar" && (
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm p-4 mb-6">
          {(() => {
            const publishedPosts = drafts.filter((d) => d.status === "published" && d.published_at);
            const byDay: Record<string, DraftItem[]> = {};
            publishedPosts.forEach((d) => {
              const day = fmtDate(d.published_at);
              if (!byDay[day]) byDay[day] = [];
              byDay[day].push(d);
            });

            // Build a 5-week calendar grid
            const now = new Date();
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOffset = firstDay.getDay();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const weeks: (number | null)[][] = [];
            let week: (number | null)[] = Array(startOffset).fill(null);
            for (let d = 1; d <= daysInMonth; d++) {
              week.push(d);
              if (week.length === 7) { weeks.push(week); week = []; }
            }
            if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }

            const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

            return (
              <div>
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">{monthLabel}</p>
                <div className="grid grid-cols-7 gap-px">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d} className="text-center text-[9px] text-gray-400 font-medium py-1">{d}</div>
                  ))}
                  {weeks.flat().map((day, i) => {
                    if (day === null) return <div key={i} className="h-16 bg-gray-50/50 rounded" />;
                    const dateStr = new Date(now.getFullYear(), now.getMonth(), day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    const posts = byDay[dateStr] || [];
                    const isToday = day === now.getDate();
                    const color = getCampaignColor(posts[0]?.campaign_id ?? null);

                    return (
                      <div key={i} className={`h-16 rounded border p-1 ${isToday ? "border-violet-300 bg-violet-50/30" : "border-gray-100"} ${posts.length > 0 ? "bg-white" : "bg-gray-50/30"}`}>
                        <p className={`text-[10px] ${isToday ? "font-bold text-violet-700" : "text-gray-500"}`}>{day}</p>
                        {posts.slice(0, 2).map((p) => {
                          const c = getCampaignColor(p.campaign_id);
                          return (
                            <div key={p.id} className={`mt-0.5 rounded px-1 py-0.5 text-[8px] truncate ${c.tag}`} title={p.headline}>
                              {p.headline.slice(0, 20)}
                            </div>
                          );
                        })}
                        {posts.length > 2 && <p className="text-[8px] text-gray-400 mt-0.5">+{posts.length - 2} more</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* List view */}
      {viewMode === "list" && <>
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(["all", "published", "queued", "approved", "pending_review", "rejected"] as ViewMode[]).map((f) => (
          <button key={f} onClick={() => setView(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${view === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            {f.replace("_", " ")} {counts[f] ? `(${counts[f]})` : ""}
          </button>
        ))}
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">{view === "all" ? "No drafts yet" : `No ${view.replace("_", " ")} drafts`}</h3>
        </div>
      ) : (
        <div className="space-y-4">
          {months.map((month) => {
            const items = grouped[month];
            const isCollapsed = collapsedMonths.has(month);
            const monthIds = items.map((d) => d.id);
            const allMonthSelected = monthIds.every((id) => selected.has(id));

            return (
              <div key={month} className="rounded-xl border border-indigo-100/50 bg-white shadow-sm overflow-hidden">
                {/* Month header — always visible, clickable to collapse */}
                <div
                  className="px-4 py-2.5 flex items-center justify-between bg-gradient-to-r from-indigo-50/50 to-violet-50/30 cursor-pointer hover:from-indigo-50 hover:to-violet-50/50"
                  onClick={() => toggleMonth(month)}
                >
                  <div className="flex items-center gap-3">
                    {/* Select all in month */}
                    <input
                      type="checkbox"
                      checked={allMonthSelected && monthIds.length > 0}
                      onChange={(e) => { e.stopPropagation(); toggleSelectAll(monthIds); }}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-gray-300 text-indigo-600 w-3.5 h-3.5"
                    />
                    <svg className={`w-4 h-4 text-gray-400 ${isCollapsed ? "-rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{month}</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Feedback summary for the month */}
                    {(() => {
                      const feedbackable = items.filter((d) => d.status === "published" || d.status === "rejected");
                      const withFb = feedbackable.filter((d) => d.has_feedback).length;
                      const total = feedbackable.length;
                      if (total === 0) return null;
                      return (
                        <span className={`text-[9px] font-medium ${withFb === total ? "text-emerald-600" : "text-amber-500"}`}>
                          {withFb}/{total} FB
                        </span>
                      );
                    })()}
                    <span className="text-[10px] text-gray-400">{items.length} post{items.length > 1 ? "s" : ""}</span>
                    {/* Mini status dots */}
                    <div className="flex gap-1">
                      {items.filter((d) => d.status === "published").length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Published" />
                      )}
                      {items.filter((d) => d.status === "approved" || d.status === "queued").length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Ready" />
                      )}
                      {items.filter((d) => d.status === "pending_review").length > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" title="Pending" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Posts — collapsible */}
                {!isCollapsed && (
                  <div className="divide-y divide-indigo-50/50">
                    {items.map((draft) => {
                      const isExpanded = expandedId === draft.id;
                      const color = getCampaignColor(draft.campaign_id);
                      const isArchived = draft.status === "archived";
                      const isSelected = selected.has(draft.id);

                      return (
                        <div key={draft.id} className={isArchived ? "opacity-40" : ""}>
                          {/* Row */}
                          <div className={`px-4 py-2.5 flex items-center gap-3 ${isSelected ? "bg-indigo-50/40" : "hover:bg-violet-50/20"}`}>
                            {/* Checkbox */}
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(draft.id)}
                              className="rounded border-gray-300 text-indigo-600 w-3.5 h-3.5 shrink-0"
                            />

                            {/* Status dot */}
                            <div className={`w-2 h-2 rounded-full shrink-0 ${
                              draft.status === "published" ? "bg-emerald-500" :
                              draft.status === "queued" ? "bg-violet-500" :
                              draft.status === "approved" ? "bg-indigo-500" :
                              draft.status === "pending_review" ? "bg-sky-500" :
                              draft.status === "rejected" ? "bg-rose-400" : "bg-gray-300"
                            }`} />

                            {/* Content — click to expand */}
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : draft.id)}>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${color.tag}`}>{draft.campaign_name}</span>
                                <span className="text-[11px] text-gray-400">
                                  {fmtDate(draft.published_at || draft.selection_date || draft.created_at)}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-gray-900 truncate mt-0.5">{draft.headline}</p>
                            </div>

                            {/* Right — feedback indicator + actions + badge */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {/* Feedback indicator */}
                              {(draft.status === "published" || draft.status === "rejected") && (
                                draft.has_feedback ? (
                                  <span className="flex items-center gap-0.5 text-[9px] text-emerald-600 font-medium" title="Feedback submitted">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    FB
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-0.5 text-[9px] text-amber-500 font-medium" title="Feedback pending">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" /></svg>
                                    FB
                                  </span>
                                )
                              )}
                              {draft.linkedin_post_ref && (
                                <a href={`https://www.linkedin.com/feed/update/${draft.linkedin_post_ref}`} target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] text-emerald-600 hover:text-emerald-700 font-medium">View</a>
                              )}
                              <Badge status={draft.status} />
                              {/* Revert to review */}
                              {(draft.status === "approved" || draft.status === "rejected" || draft.status === "queued") && (
                                <button onClick={() => handleRevert(draft.id)} title="Revert to review"
                                  className="p-1 rounded text-gray-300 hover:text-indigo-500 hover:bg-indigo-50">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                </button>
                              )}
                              {/* Archive */}
                              {!isArchived && draft.status !== "pending_review" && draft.status !== "queued" && (
                                <button onClick={() => handleArchive(draft.id)} title="Archive"
                                  className="p-1 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                                </button>
                              )}
                              {/* Delete */}
                              <button onClick={() => handleDelete(draft.id)} title="Delete"
                                className="p-1 rounded text-gray-300 hover:text-rose-500 hover:bg-rose-50">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                              {/* Expand */}
                              <button onClick={() => setExpandedId(isExpanded ? null : draft.id)} className="p-1 rounded text-gray-300 hover:text-gray-500">
                                <svg className={`w-3.5 h-3.5 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                              </button>
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <div className="px-4 pb-4 pt-2 bg-gray-50/30 border-t border-indigo-50 animate-fade-in">
                              <div className="rounded-lg bg-white border border-gray-100 p-4 mb-3">
                                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{draft.primary_text}</p>
                              </div>

                              <div className="flex items-center gap-4 text-[10px] text-gray-400 mb-3">
                                <span className="capitalize">{draft.narrative_type.replace("_", " ")}</span>
                                <span>v{draft.version}</span>
                                <span>Confidence: {(draft.confidence_score * 100).toFixed(0)}%</span>
                                {draft.published_at && <span>Published: {fmtDateTime(draft.published_at)}</span>}
                              </div>

                              {publishResult?.id === draft.id && (
                                <div className={`rounded-lg border px-3 py-2 text-xs mb-3 ${publishResult.error ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                                  {publishResult.message}
                                </div>
                              )}

                              {/* Actions */}
                              <div className="flex gap-2">
                                {draft.status === "approved" && (
                                  <button onClick={() => handlePublish(draft.id)} disabled={publishingId === draft.id}
                                    className="rounded-lg bg-[#0A66C2] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#004182] disabled:opacity-50">
                                    {publishingId === draft.id ? "Queuing..." : "Publish to LinkedIn"}
                                  </button>
                                )}
                                <button onClick={() => handleCopy(draft.id, draft.primary_text)}
                                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50">
                                  {copiedId === draft.id ? "Copied!" : "Copy"}
                                </button>
                                {(draft.status === "published" || draft.status === "rejected") && !isArchived && (
                                  <button onClick={() => openFeedback(draft)}
                                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-medium text-gray-500 hover:bg-gray-50">
                                    {lockedFeedback[draft.id] ? "Feedback" : feedbackSaved === draft.id ? "Saved!" : "Add Feedback"}
                                  </button>
                                )}
                              </div>

                              {/* Feedback */}
                              {feedbackForId === draft.id && (
                                <div className="mt-3 pt-3 border-t border-gray-100">
                                  {lockedFeedback[draft.id] ? (
                                    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 opacity-75">
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Feedback locked</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {lockedFeedback[draft.id].performance_rating && (
                                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${RATING_OPTIONS.find((r) => r.value === lockedFeedback[draft.id].performance_rating)?.color || ""}`}>
                                            {lockedFeedback[draft.id].performance_rating}
                                          </span>
                                        )}
                                        {lockedFeedback[draft.id].improvement_notes && (
                                          <span className="text-[11px] text-gray-500 truncate">{lockedFeedback[draft.id].improvement_notes}</span>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-2.5 animate-fade-in">
                                      <div className="flex items-center justify-between">
                                        <div className="flex gap-1.5">
                                          {RATING_OPTIONS.map((opt) => (
                                            <button key={opt.value} onClick={() => setFeedbackData((p) => ({ ...p, performance_rating: p.performance_rating === opt.value ? null : opt.value }))}
                                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${feedbackData.performance_rating === opt.value ? opt.color : "border-gray-200 text-gray-400"}`}>
                                              {opt.label}
                                            </button>
                                          ))}
                                        </div>
                                        <button onClick={() => setFeedbackForId(null)} className="text-[10px] text-gray-400 hover:text-gray-600">Close</button>
                                      </div>
                                      <input type="text" value={feedbackData.improvement_notes ?? ""} onChange={(e) => setFeedbackData((p) => ({ ...p, improvement_notes: e.target.value || null }))}
                                        className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                                        placeholder="Quick note: what to do differently next time?" />
                                      <div className="flex flex-wrap gap-1">
                                        {EFFECTIVE_ELEMENTS.map((el) => (
                                          <button key={el} onClick={() => toggleElement(el)}
                                            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${feedbackData.effective_elements.includes(el) ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-400"}`}>
                                            {el.replace(/_/g, " ")}
                                          </button>
                                        ))}
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <button onClick={() => handleSaveFeedback(draft.id, draft.campaign_id)} disabled={savingFeedback}
                                          className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm">
                                          {savingFeedback ? "Saving..." : "Save Feedback"}
                                        </button>
                                        {feedbackSaved === draft.id && <span className="text-xs text-emerald-600 animate-fade-in">Saved!</span>}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </>}
    </div>
  );
}
