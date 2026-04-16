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

// Campaign color palette — deterministic by campaign_id
const CAMPAIGN_COLORS = [
  { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", dot: "bg-indigo-500", tag: "bg-indigo-100 text-indigo-700" },
  { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500", tag: "bg-emerald-100 text-emerald-700" },
  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500", tag: "bg-amber-100 text-amber-700" },
  { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", dot: "bg-rose-500", tag: "bg-rose-100 text-rose-700" },
  { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", dot: "bg-sky-500", tag: "bg-sky-100 text-sky-700" },
  { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", dot: "bg-purple-500", tag: "bg-purple-100 text-purple-700" },
];

function getCampaignColor(campaignId: number | null) {
  if (!campaignId) return CAMPAIGN_COLORS[0];
  return CAMPAIGN_COLORS[(campaignId - 1) % CAMPAIGN_COLORS.length];
}

export default function HistoryPage() {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [publishResult, setPublishResult] = useState<{ id: number; message: string; error?: boolean } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [feedbackForId, setFeedbackForId] = useState<number | null>(null);
  const [feedbackData, setFeedbackData] = useState<Feedback>({ ...EMPTY_FEEDBACK });
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState<number | null>(null);
  const [lockedFeedback, setLockedFeedback] = useState<Record<number, Feedback>>({});

  useEffect(() => {
    api
      .get<DraftItem[]>("/api/drafts/")
      .then(setDrafts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handlePublish(id: number) {
    setPublishingId(id);
    setPublishResult(null);
    try {
      const result = await api.post<{ id: number; message: string }>(`/api/drafts/${id}/publish`);
      setPublishResult({ id, message: result.message });
      setDrafts((prev) => prev.map((d) => d.id === id ? { ...d, status: "published" } : d));
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setPublishResult({ id, message: err?.body?.detail || err?.message || "Publish failed", error: true });
    } finally {
      setPublishingId(null);
    }
  }

  function handleCopy(id: number, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function openFeedback(draft: DraftItem) {
    setFeedbackForId(draft.id);
    setFeedbackSaved(null);
    try {
      const existing = await api.get<Feedback | null>(`/api/drafts/${draft.id}/feedback`);
      if (existing && existing.performance_rating) {
        // Feedback already submitted, lock it
        setLockedFeedback((prev) => ({ ...prev, [draft.id]: existing }));
        setFeedbackData(existing);
      } else {
        setFeedbackData({ ...EMPTY_FEEDBACK });
      }
    } catch {
      setFeedbackData({ ...EMPTY_FEEDBACK });
    }
  }

  async function handleSaveFeedback(draftId: number, campaignId: number | null) {
    setSavingFeedback(true);
    try {
      await api.put(`/api/drafts/${draftId}/feedback`, {
        campaign_id: campaignId || 0,
        ...feedbackData,
      });
      // Lock it permanently
      setLockedFeedback((prev) => ({ ...prev, [draftId]: feedbackData }));
      setFeedbackSaved(draftId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingFeedback(false);
    }
  }

  function toggleElement(el: string) {
    setFeedbackData((prev) => ({
      ...prev,
      effective_elements: prev.effective_elements.includes(el)
        ? prev.effective_elements.filter((e) => e !== el)
        : [...prev.effective_elements, el],
    }));
  }

  const filtered = filter === "all" ? drafts : drafts.filter((d) => d.status === filter);
  const counts: Record<string, number> = {
    all: drafts.length,
    pending_review: drafts.filter((d) => d.status === "pending_review").length,
    approved: drafts.filter((d) => d.status === "approved").length,
    published: drafts.filter((d) => d.status === "published").length,
    rejected: drafts.filter((d) => d.status === "rejected").length,
  };

  // Unique campaigns for legend
  const campaigns = [...new Map(drafts.map((d) => [d.campaign_id, d.campaign_name])).entries()]
    .filter(([id]) => id !== null);

  // Timeline data — only published posts, grouped by date
  const publishedDrafts = drafts.filter((d) => d.status === "published");
  const byDate: Record<string, DraftItem[]> = {};
  for (const d of publishedDrafts) {
    const date = d.published_at?.split("T")[0]?.split(" ")[0] || d.selection_date || d.created_at.split("T")[0].split(" ")[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(d);
  }
  const sortedDates = Object.keys(byDate).sort().reverse();

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="h-32 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">History</h1>
          <p className="text-sm text-gray-500 mt-1">
            {counts.published} published, {counts.approved} ready to publish
          </p>
        </div>
        {/* View toggle */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setView("list")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
              view === "list" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
              view === "calendar" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Timeline
          </button>
        </div>
      </div>

      {/* Campaign legend */}
      {campaigns.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Campaigns:</span>
          {campaigns.map(([id, name]) => {
            const color = getCampaignColor(id);
            return (
              <div key={id} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                <span className="text-xs text-gray-600">{name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter tabs — list view only */}
      {view === "list" && (
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
          {(["all", "pending_review", "approved", "published", "rejected"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                filter === f ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f.replace("_", " ")} ({counts[f] || 0})
            </button>
          ))}
        </div>
      )}

      {/* Timeline view — published posts only */}
      {view === "calendar" && (
        <div className="space-y-0">
          {sortedDates.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-gray-700 mb-1">No published posts yet</h3>
              <p className="text-sm text-gray-400">Published posts will appear here on a timeline.</p>
            </div>
          ) : (
            sortedDates.map((date) => (
              <div key={date} className="flex gap-4">
                {/* Date column */}
                <div className="w-20 shrink-0 pt-3 text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    {new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                  </p>
                </div>
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full bg-gray-300 border-2 border-white shadow-sm mt-4" />
                  <div className="w-px flex-1 bg-gray-200" />
                </div>
                {/* Cards for this date */}
                <div className="flex-1 pb-4 space-y-2 pt-2">
                  {byDate[date].map((draft) => {
                    const color = getCampaignColor(draft.campaign_id);
                    const isExpanded = expandedId === draft.id;
                    return (
                      <div
                        key={draft.id}
                        className={`rounded-xl border ${color.border} ${color.bg} overflow-hidden`}
                      >
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                          className="w-full px-4 py-3 flex items-center justify-between text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${color.tag}`}>
                                {draft.campaign_name}
                              </span>
                              <Badge status={draft.status} />
                              {draft.published_at && (
                                <span className="text-[10px] text-gray-400">
                                  {new Date(draft.published_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-gray-900 truncate">{draft.headline}</p>
                            <span className="text-[10px] text-gray-400 capitalize">{draft.narrative_type.replace("_", " ")}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            {draft.linkedin_post_ref && (
                              <span className="text-[10px] text-emerald-600 font-medium">on LinkedIn</span>
                            )}
                            <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-3 animate-fade-in">
                            <div className="rounded-lg bg-white/80 border border-gray-100 p-3 mb-2">
                              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{draft.primary_text}</p>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-gray-400">
                              <span>Confidence: {(draft.confidence_score * 100).toFixed(0)}%</span>
                              <span>v{draft.version}</span>
                              {draft.published_at && (
                                <span>Published: {new Date(draft.published_at).toLocaleString()}</span>
                              )}
                            </div>
                            {/* Actions */}
                            {draft.status === "approved" && (
                              <div className="mt-2 flex gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handlePublish(draft.id); }}
                                  disabled={publishingId === draft.id}
                                  className="rounded-md bg-[#0A66C2] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#004182] disabled:opacity-50 flex items-center gap-1"
                                >
                                  {publishingId === draft.id ? "Publishing..." : "Publish to LinkedIn"}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCopy(draft.id, draft.primary_text); }}
                                  className="rounded-md border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1"
                                >
                                  {copiedId === draft.id ? "Copied!" : "Copy"}
                                </button>
                              </div>
                            )}
                            {publishResult?.id === draft.id && (
                              <div className={`mt-2 rounded-md px-3 py-1.5 text-[11px] ${publishResult.error ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                                {publishResult.message}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <>
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {filtered.map((draft) => {
                const isExpanded = expandedId === draft.id;
                const color = getCampaignColor(draft.campaign_id);
                return (
                  <div key={draft.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                      className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${color.tag}`}>
                            {draft.campaign_name}
                          </span>
                          <span className="text-xs text-gray-400">{draft.selection_date}</span>
                          {draft.published_at && (
                            <span className="text-[10px] text-emerald-600 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Published {new Date(draft.published_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-medium text-gray-900 truncate">{draft.headline}</h3>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <Badge status={draft.status} />
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-4 animate-fade-in">
                        <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 mb-3">
                          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{draft.primary_text}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <p className="text-gray-400 mb-0.5">Confidence</p>
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${draft.confidence_score >= 0.7 ? "bg-emerald-500" : draft.confidence_score >= 0.4 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${draft.confidence_score * 100}%` }} />
                              </div>
                              <span className="font-mono text-gray-600">{(draft.confidence_score * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                          <div>
                            <p className="text-gray-400 mb-0.5">Type</p>
                            <p className="text-gray-700 capitalize">{draft.narrative_type.replace("_", " ")}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 mb-0.5">Version</p>
                            <p className="text-gray-700">v{draft.version}</p>
                          </div>
                        </div>

                        {draft.grounding_summary && (
                          <div className="mt-3">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Grounding</p>
                            <p className="text-xs text-gray-600">{draft.grounding_summary}</p>
                          </div>
                        )}

                        {/* Published info */}
                        {draft.published_at && (
                          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <svg className="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                              </svg>
                              <div>
                                <p className="text-xs font-medium text-emerald-700">Published to LinkedIn</p>
                                <p className="text-[10px] text-emerald-600">{new Date(draft.published_at).toLocaleString()}</p>
                              </div>
                            </div>
                            {draft.linkedin_post_ref && (
                              <a
                                href={`https://www.linkedin.com/feed/update/${draft.linkedin_post_ref}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                              >
                                View post
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              </a>
                            )}
                          </div>
                        )}

                        {/* Publish result banner */}
                        {publishResult?.id === draft.id && (
                          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs flex items-center gap-2 animate-fade-in ${publishResult.error ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d={publishResult.error ? "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" : "M5 13l4 4L19 7"} />
                            </svg>
                            {publishResult.message}
                          </div>
                        )}

                        {/* Action buttons for approved drafts */}
                        {draft.status === "approved" && (
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => handlePublish(draft.id)}
                              disabled={publishingId === draft.id}
                              className="rounded-lg bg-[#0A66C2] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#004182] disabled:opacity-50 shadow-sm flex items-center gap-1.5"
                            >
                              {publishingId === draft.id ? (
                                <><div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Publishing...</>
                              ) : (
                                <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> Publish to LinkedIn</>
                              )}
                            </button>
                            <button
                              onClick={() => handleCopy(draft.id, draft.primary_text)}
                              className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
                            >
                              {copiedId === draft.id ? (
                                <><svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> Copied!</>
                              ) : (
                                <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg> Copy Text</>
                              )}
                            </button>
                          </div>
                        )}

                        {/* Feedback section for published/approved posts */}
                        {(draft.status === "published" || draft.status === "approved") && (
                          <div className="mt-4 border-t border-gray-100 pt-3">
                            {/* Locked feedback — already submitted */}
                            {lockedFeedback[draft.id] ? (
                              <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 opacity-75">
                                <div className="flex items-center gap-2 mb-2">
                                  <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  </svg>
                                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Feedback submitted (locked)</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  {lockedFeedback[draft.id].performance_rating && (
                                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                                      RATING_OPTIONS.find((r) => r.value === lockedFeedback[draft.id].performance_rating)?.color || "border-gray-200 text-gray-500"
                                    }`}>
                                      {lockedFeedback[draft.id].performance_rating}
                                    </span>
                                  )}
                                  {lockedFeedback[draft.id].improvement_notes && (
                                    <span className="text-[11px] text-gray-500 truncate">{lockedFeedback[draft.id].improvement_notes}</span>
                                  )}
                                </div>
                                {lockedFeedback[draft.id].effective_elements.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {lockedFeedback[draft.id].effective_elements.map((el) => (
                                      <span key={el} className="rounded-full bg-gray-100 border border-gray-200 px-2 py-0.5 text-[9px] text-gray-400">
                                        {el.replace(/_/g, " ")}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : feedbackForId !== draft.id ? (
                              <button
                                onClick={() => openFeedback(draft)}
                                className="text-xs text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-1.5"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Add Feedback
                              </button>
                            ) : (
                              <div className="space-y-3 animate-fade-in">
                                {/* Rating — one tap */}
                                <div className="flex items-center justify-between">
                                  <div className="flex gap-1.5">
                                    {RATING_OPTIONS.map((opt) => (
                                      <button
                                        key={opt.value}
                                        onClick={() => setFeedbackData((p) => ({ ...p, performance_rating: p.performance_rating === opt.value ? null : opt.value }))}
                                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                                          feedbackData.performance_rating === opt.value ? opt.color : "border-gray-200 text-gray-400 hover:border-gray-300"
                                        }`}
                                      >
                                        {opt.label}
                                      </button>
                                    ))}
                                  </div>
                                  <button onClick={() => setFeedbackForId(null)} className="text-[10px] text-gray-400 hover:text-gray-600">Close</button>
                                </div>

                                {/* Single note field — keep it simple */}
                                <input
                                  type="text"
                                  value={feedbackData.improvement_notes ?? ""}
                                  onChange={(e) => setFeedbackData((p) => ({ ...p, improvement_notes: e.target.value || null }))}
                                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                                  placeholder="Quick note — what to do differently next time?"
                                />

                                {/* Element tags — quick taps */}
                                <div className="flex flex-wrap gap-1">
                                  {EFFECTIVE_ELEMENTS.map((el) => (
                                    <button
                                      key={el}
                                      onClick={() => toggleElement(el)}
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                        feedbackData.effective_elements.includes(el)
                                          ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                                          : "border-gray-200 text-gray-400 hover:border-gray-300"
                                      }`}
                                    >
                                      {el.replace(/_/g, " ")}
                                    </button>
                                  ))}
                                </div>

                                {/* Save */}
                                <div className="flex items-center gap-3">
                                  <button
                                    onClick={() => handleSaveFeedback(draft.id, draft.campaign_id)}
                                    disabled={savingFeedback}
                                    className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center gap-1.5"
                                  >
                                    {savingFeedback && <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />}
                                    {savingFeedback ? "Saving..." : "Save Feedback"}
                                  </button>
                                  {feedbackSaved === draft.id && (
                                    <span className="text-xs text-emerald-600 flex items-center gap-1 animate-fade-in">
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                      Saved! Will be used in next campaign run.
                                    </span>
                                  )}
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
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-gray-700 mb-1">No drafts yet</h3>
      <p className="text-sm text-gray-400">Drafts will appear here after pipeline runs.</p>
    </div>
  );
}
