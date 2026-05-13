"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Fragment is keyable but TS infers props loosely; this alias is just for readability.
const FragmentWithKey = Fragment;

interface ManualFeedback {
  performance_rating: string | null;
  what_worked: string | null;
  what_didnt_work: string | null;
}

interface AnalyticsRow {
  draft_id: number;
  scraped_at: string;
  published_at: string | null;
  primary_text_first_200: string;
  reactions: number | null;
  comments: number | null;
  engagement_score: number | null;
  activity_urn: string | null;
  manual_feedback: ManualFeedback | null;
  is_top_quartile: boolean;
  has_promoted_insight: boolean;
}

interface ThresholdBasis {
  quartile: number;
  lookback_days: number;
  min_snapshots_required: number;
}

interface PostsResponse {
  posts: AnalyticsRow[];
  threshold: number | null;
  threshold_basis: ThresholdBasis;
  last_refresh: string | null;
}

interface StagedInsight {
  id: number;
  draft_id: number | null;
  draft_text_first_200: string | null;
  insight_text: string;
  reasoning: string | null;
  source_summary: string | null;
  created_at: string;
}

interface RefreshResult {
  scraped_count: number;
  matched_count: number;
  new_snapshots: number;
  new_insights: number;
  skipped_already_scraped_today: number;
}

function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Mon-Sun week. Returns { start, end, key } for a given date.
function isoWeekBounds(d: Date): { start: Date; end: Date; key: string } {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMon = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMon);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, "0");
  const dd = String(start.getDate()).padStart(2, "0");
  return { start, end, key: `${yyyy}-${mm}-${dd}` };
}

function shortIdentifier(text: string): string {
  // Take the first non-empty line, trim, and cap at 80 chars.
  const firstLine = text.split(/\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine;
}

function staleness(lastIso: string | null): { label: string; tone: "fresh" | "stale" | "very-stale" | "none" } {
  if (!lastIso) return { label: "Never refreshed", tone: "none" };
  const then = new Date(lastIso).getTime();
  if (Number.isNaN(then)) return { label: "Never refreshed", tone: "none" };
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 1) return { label: "Updated today", tone: "fresh" };
  if (days < 7) return { label: `Updated ${days}d ago`, tone: "fresh" };
  if (days < 14) return { label: `Updated ${days}d ago — may be stale`, tone: "stale" };
  return { label: `Updated ${days}d ago — likely stale`, tone: "very-stale" };
}

interface WeekGroup {
  key: string;
  start: Date;
  end: Date;
  posts: AnalyticsRow[];
  totalReactions: number;
}

function groupByWeek(posts: AnalyticsRow[]): WeekGroup[] {
  const buckets = new Map<string, WeekGroup>();
  for (const p of posts) {
    const ref = p.published_at || p.scraped_at;
    if (!ref) continue;
    const d = new Date(ref);
    if (Number.isNaN(d.getTime())) continue;
    const { start, end, key } = isoWeekBounds(d);
    let g = buckets.get(key);
    if (!g) {
      g = { key, start, end, posts: [], totalReactions: 0 };
      buckets.set(key, g);
    }
    g.posts.push(p);
    g.totalReactions += p.reactions ?? 0;
  }
  // Sort weeks newest first; posts within a week newest first.
  const out = Array.from(buckets.values());
  out.sort((a, b) => b.start.getTime() - a.start.getTime());
  for (const g of out) {
    g.posts.sort((a, b) => {
      const aT = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bT = b.published_at ? new Date(b.published_at).getTime() : 0;
      return bT - aT;
    });
  }
  return out;
}

export default function AnalyticsPage() {
  const [posts, setPosts] = useState<AnalyticsRow[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [thresholdBasis, setThresholdBasis] = useState<ThresholdBasis | null>(null);
  const [insights, setInsights] = useState<StagedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const p = await api.get<PostsResponse>("/api/analytics/posts");
      setPosts(p.posts);
      setLastRefresh(p.last_refresh);
      setThreshold(p.threshold);
      setThresholdBasis(p.threshold_basis);
      const i = await api.get<StagedInsight[]>("/api/analytics/insights/staged");
      setInsights(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);
    try {
      const result = await api.post<RefreshResult>("/api/analytics/refresh", {});
      setRefreshResult(result);
      await load();
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setError(err?.body?.detail || err?.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePromote(id: number) {
    try {
      await api.post(`/api/analytics/insights/${id}/promote`, {});
      setInsights((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Promote failed");
    }
  }

  async function handleReject(id: number) {
    try {
      await api.post(`/api/analytics/insights/${id}/reject`, {});
      setInsights((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    }
  }

  function toggleWeek(key: string) {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const stale = staleness(lastRefresh);
  const staleClass =
    stale.tone === "very-stale" ? "text-rose-600" :
    stale.tone === "stale" ? "text-amber-600" :
    stale.tone === "none" ? "text-gray-400" : "text-emerald-600";

  const weeks = groupByWeek(posts);

  return (
    <div className="p-6 max-w-[1100px]">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 mb-0.5">Analytics</h1>
          <p className="text-xs text-gray-400">Engagement on posts published 7–14 days ago. Re-runs every Saturday.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[11px] ${staleClass}`}>{stale.label}</span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center gap-1.5"
          >
            {refreshing && <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />}
            {refreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
      </div>

      {refreshResult && (
        <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700">
          Scraped {refreshResult.scraped_count} posts · matched {refreshResult.matched_count} ·
          {" "}{refreshResult.new_snapshots} new snapshots · {refreshResult.new_insights} new insight{refreshResult.new_insights === 1 ? "" : "s"}
          {refreshResult.skipped_already_scraped_today > 0 && ` · ${refreshResult.skipped_already_scraped_today} skipped (already scraped today)`}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {/* Marker legend — explain what the badges mean */}
      <div className="mt-4 rounded-lg border border-indigo-100/60 bg-indigo-50/30 px-3 py-2 flex items-center gap-4 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
          <span className="rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 font-semibold text-[9px] uppercase tracking-wide">Top quartile</span>
          {threshold !== null ? (
            <span className="text-gray-500">≥ {threshold.toFixed(0)} score · top {Math.round((1 - (thresholdBasis?.quartile ?? 0.75)) * 100)}% over last {thresholdBasis?.lookback_days ?? 90}d</span>
          ) : (
            <span className="text-gray-400 italic">not yet — needs {thresholdBasis?.min_snapshots_required ?? 4}+ snapshots ({posts.length} so far)</span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
          <span className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800 font-semibold text-[9px] uppercase tracking-wide">Insight applied</span>
          <span className="text-gray-500">an insight from this post is now in your <a href="/settings" className="underline hover:text-indigo-700">learned context</a> and shapes new drafts</span>
        </span>
      </div>

      {/* Staged insights */}
      {insights.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/30 p-4">
          <h2 className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">
            {insights.length} insight{insights.length === 1 ? "" : "s"} awaiting review
          </h2>
          <p className="text-[11px] text-amber-700 mb-3">
            Approving an insight appends it to your <em>Learned Context</em> in Settings — it then influences future drafts.
          </p>
          <div className="space-y-3">
            {insights.map((ins) => (
              <div key={ins.id} className="rounded-lg bg-white border border-amber-100 p-3">
                <p className="text-sm font-medium text-gray-900">{ins.insight_text}</p>
                {ins.reasoning && <p className="text-[11px] text-gray-500 mt-1.5"><span className="font-semibold">Why:</span> {ins.reasoning}</p>}
                {ins.draft_text_first_200 && (
                  <details className="mt-2">
                    <summary className="text-[10px] text-gray-400 cursor-pointer">Source post</summary>
                    <p className="text-[11px] text-gray-600 mt-1 whitespace-pre-wrap">{ins.draft_text_first_200}</p>
                  </details>
                )}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => handlePromote(ins.id)} className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-700">
                    Add to learned context
                  </button>
                  <button onClick={() => handleReject(ins.id)} className="rounded-md border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50">
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week-grouped table */}
      <div className="mt-6 rounded-xl border border-indigo-100/50 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">By week</h2>
          <span className="text-[10px] text-gray-400">{posts.length} post{posts.length === 1 ? "" : "s"} across {weeks.length} week{weeks.length === 1 ? "" : "s"}</span>
        </div>
        {loading ? (
          <div className="p-6 text-xs text-gray-400">Loading...</div>
        ) : weeks.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-500 mb-1">No analytics yet</p>
            <p className="text-[11px] text-gray-400">
              Click <strong>Refresh now</strong> to scrape engagement for posts published 7–14 days ago.
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50/50">
              <tr className="border-b border-gray-100">
                <th className="text-left font-medium text-gray-500 px-4 py-2 w-10"></th>
                <th className="text-left font-medium text-gray-500 px-2 py-2">Week</th>
                <th className="text-left font-medium text-gray-500 px-2 py-2">Posts</th>
                <th className="text-right font-medium text-gray-500 px-4 py-2 w-24">Reactions</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((wk) => {
                const expanded = expandedWeeks.has(wk.key);
                return (
                  <FragmentWithKey key={wk.key}>
                    <tr onClick={() => toggleWeek(wk.key)} className="border-b border-gray-50 hover:bg-indigo-50/20 cursor-pointer">
                      <td className="px-4 py-2.5 text-gray-400">
                        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </td>
                      <td className="px-2 py-2.5 text-gray-700 font-medium">
                        {formatDateShort(wk.start.toISOString())} – {formatDateShort(wk.end.toISOString())}
                      </td>
                      <td className="px-2 py-2.5 text-gray-500">
                        {wk.posts.length} post{wk.posts.length === 1 ? "" : "s"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-sm font-semibold text-indigo-600">{wk.totalReactions}</span>
                      </td>
                    </tr>
                    {expanded && wk.posts.map((p) => (
                      <tr key={`${wk.key}-${p.draft_id}`} className="border-b border-gray-50 bg-gray-50/20">
                        <td className="px-4 py-2"></td>
                        <td className="px-2 py-2 text-gray-400 text-[11px]">{formatDateShort(p.published_at)}</td>
                        <td className="px-2 py-2">
                          <p className="text-gray-800 leading-snug">{shortIdentifier(p.primary_text_first_200)}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {p.is_top_quartile && (
                              <span className="inline-flex items-center rounded bg-amber-100 border border-amber-200 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 uppercase tracking-wide" title="Engagement score is in the top quartile of your last 90 days">
                                Top quartile
                              </span>
                            )}
                            {p.has_promoted_insight && (
                              <span className="inline-flex items-center rounded bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-800 uppercase tracking-wide" title="An insight extracted from this post is in your learned context, shaping new drafts">
                                Insight applied
                              </span>
                            )}
                            {p.manual_feedback && (
                              <span className="inline-flex items-center gap-1 rounded bg-violet-100 border border-violet-200 px-1.5 py-0.5">
                                <span className="text-[9px] text-violet-800 font-semibold uppercase tracking-wide">Manual feedback</span>
                                {p.manual_feedback.performance_rating && (
                                  <span className="text-[10px] text-gray-700">{p.manual_feedback.performance_rating}</span>
                                )}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">Scraped {formatDateTime(p.scraped_at)}</p>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-gray-700">{p.reactions ?? 0}</span>
                        </td>
                      </tr>
                    ))}
                  </FragmentWithKey>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
