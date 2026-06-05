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

interface CampaignBreakdown {
  campaign_id: number;
  campaign_name: string;
  campaign_status: string;
  rejected: number;
  approved: number;
  total: number;
  rejection_rate: number;
  top_reasons: Record<string, number>;
  is_high_rejection: boolean;
}

interface RejectionAggregate {
  window_days: number;
  window_start: string;
  window_end: string;
  total_rejected: number;
  total_approved: number;
  rejection_rate_overall: number;
  reasons: Record<string, number>;
  tagged_share: number;
  campaigns: CampaignBreakdown[];
}

interface Diagnosis {
  headline: string;
  diagnosis: string;
  problem_campaigns: { campaign_id: number; campaign_name: string; issue: string }[];
  problem_memory: { line: string; why: string }[];
  recommendations: { action: string; detail: string }[];
}

interface RejectionInsights {
  generated_at: string;
  aggregate: RejectionAggregate;
  diagnosis: Diagnosis | null;
  min_rejections_required: number;
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
  const [rejectionInsights, setRejectionInsights] = useState<RejectionInsights | null>(null);
  const [loadingRejInsights, setLoadingRejInsights] = useState(false);

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

  async function loadRejectionInsights() {
    setLoadingRejInsights(true);
    try {
      const r = await api.get<RejectionInsights>("/api/analytics/rejection-insights");
      setRejectionInsights(r);
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      alert(err?.body?.detail || err?.message || "Insights failed");
    } finally {
      setLoadingRejInsights(false);
    }
  }

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

      {/* Marker legend — glossary, only describes what the badges mean when they appear on a row */}
      <div className="mt-4 rounded-lg border border-indigo-100/60 bg-indigo-50/30 px-3 py-2">
        <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-semibold">What the badges mean</p>
        <div className="flex items-center gap-4 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
            <span className="rounded px-1.5 py-0.5 bg-amber-100 text-amber-800 font-semibold text-[9px] uppercase tracking-wide">Top quartile</span>
            {threshold !== null ? (
              <span className="text-gray-500">when score ≥ {threshold.toFixed(0)} · top {Math.round((1 - (thresholdBasis?.quartile ?? 0.75)) * 100)}% over last {thresholdBasis?.lookback_days ?? 90}d</span>
            ) : (
              <span className="text-gray-400 italic">no threshold yet — needs {thresholdBasis?.min_snapshots_required ?? 4}+ snapshots ({posts.length} so far)</span>
            )}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-700">
            <span className="rounded px-1.5 py-0.5 bg-emerald-100 text-emerald-800 font-semibold text-[9px] uppercase tracking-wide">Insight applied</span>
            <span className="text-gray-500">when an insight from this post has been added to <a href="/settings" className="underline hover:text-indigo-700">learned context</a></span>
          </span>
        </div>
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

      {/* Monthly rejection insights */}
      <div className="mt-6 rounded-xl border border-violet-200/50 bg-gradient-to-br from-violet-50/30 to-indigo-50/20 shadow-sm">
        <div className="px-4 py-3 border-b border-violet-100/50 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Monthly Insights — rejection diagnostics</h2>
            <p className="text-[10px] text-violet-600/80 mt-0.5">Spot patterns in why drafts get rejected — repetition fatigue, exhausted campaigns, memory bloat.</p>
          </div>
          <button
            onClick={loadRejectionInsights}
            disabled={loadingRejInsights}
            className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-[11px] font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            {loadingRejInsights ? (
              <div className="animate-spin w-3 h-3 border border-violet-600 border-t-transparent rounded-full" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            )}
            {rejectionInsights ? "Regenerate" : "Generate insights"}
          </button>
        </div>

        {rejectionInsights ? (
          <div className="p-4 space-y-4">
            {/* Aggregate stats — always shown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-lg bg-white border border-violet-100 p-3">
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">Rejected</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{rejectionInsights.aggregate.total_rejected}</p>
                <p className="text-[10px] text-gray-400">over {rejectionInsights.aggregate.window_days}d</p>
              </div>
              <div className="rounded-lg bg-white border border-violet-100 p-3">
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">Rejection rate</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{Math.round(rejectionInsights.aggregate.rejection_rate_overall * 100)}%</p>
                <p className="text-[10px] text-gray-400">{rejectionInsights.aggregate.total_approved} approved</p>
              </div>
              <div className="rounded-lg bg-white border border-violet-100 p-3">
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">Tagged</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{Math.round(rejectionInsights.aggregate.tagged_share * 100)}%</p>
                <p className="text-[10px] text-gray-400">structured reasons</p>
              </div>
              <div className="rounded-lg bg-white border border-violet-100 p-3">
                <p className="text-[9px] text-gray-400 uppercase tracking-wide">Top reason</p>
                <p className="text-xs font-semibold text-gray-900 mt-1 capitalize">
                  {Object.entries(rejectionInsights.aggregate.reasons).sort((a, b) => b[1] - a[1])[0]?.[0].replace(/_/g, " ") || "—"}
                </p>
                <p className="text-[10px] text-gray-400">
                  {Object.entries(rejectionInsights.aggregate.reasons).sort((a, b) => b[1] - a[1])[0]?.[1] || 0} rejections
                </p>
              </div>
            </div>

            {/* Diagnosis from Claude */}
            {rejectionInsights.diagnosis ? (
              <div className="rounded-lg bg-white border border-violet-200 p-4">
                <p className="text-xs font-semibold text-violet-900">{rejectionInsights.diagnosis.headline}</p>
                <p className="text-[11px] text-gray-700 mt-1.5 leading-relaxed">{rejectionInsights.diagnosis.diagnosis}</p>

                {rejectionInsights.diagnosis.problem_campaigns.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Problem campaigns</p>
                    <div className="space-y-1">
                      {rejectionInsights.diagnosis.problem_campaigns.map((pc) => (
                        <div key={pc.campaign_id} className="flex items-center gap-2 text-[11px]">
                          <span className="font-medium text-gray-900">{pc.campaign_name}</span>
                          <span className="text-gray-500">— {pc.issue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rejectionInsights.diagnosis.problem_memory.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Memory lines worth reviewing</p>
                    <div className="space-y-1">
                      {rejectionInsights.diagnosis.problem_memory.map((pm, i) => (
                        <div key={i} className="text-[11px]">
                          <code className="text-violet-700 bg-violet-50 px-1 py-0.5 rounded font-mono text-[10px]">{pm.line}</code>
                          <span className="text-gray-500 ml-1.5">— {pm.why}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {rejectionInsights.diagnosis.recommendations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-violet-100">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1.5">Recommended actions</p>
                    <div className="space-y-1.5">
                      {rejectionInsights.diagnosis.recommendations.map((rec, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <span className="rounded px-1.5 py-0.5 bg-violet-100 text-violet-700 text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap mt-0.5">{rec.action.replace(/_/g, " ")}</span>
                          <span className="text-gray-700 leading-relaxed">{rec.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : rejectionInsights.aggregate.total_rejected < rejectionInsights.min_rejections_required ? (
              <div className="rounded-lg bg-amber-50/50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-700">
                Need at least {rejectionInsights.min_rejections_required} tagged rejections in the window to generate a diagnosis. Currently {rejectionInsights.aggregate.total_rejected}.
              </div>
            ) : (
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2.5 text-[11px] text-gray-500">
                Diagnosis unavailable. Try Regenerate.
              </div>
            )}

            {/* Per-campaign table */}
            {rejectionInsights.aggregate.campaigns.length > 0 && (
              <div className="rounded-lg bg-white border border-violet-100 overflow-hidden">
                <div className="px-3 py-2 border-b border-violet-100 bg-violet-50/30">
                  <p className="text-[10px] font-semibold text-violet-800 uppercase tracking-wide">Per-campaign breakdown</p>
                </div>
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50/50">
                    <tr className="border-b border-gray-100">
                      <th className="text-left font-medium text-gray-500 px-3 py-1.5">Campaign</th>
                      <th className="text-center font-medium text-gray-500 px-2 py-1.5">Total</th>
                      <th className="text-center font-medium text-gray-500 px-2 py-1.5">Rate</th>
                      <th className="text-left font-medium text-gray-500 px-2 py-1.5">Top reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejectionInsights.aggregate.campaigns.map((c) => {
                      const topReason = Object.entries(c.top_reasons).sort((a, b) => b[1] - a[1])[0];
                      return (
                        <tr key={c.campaign_id} className={`border-b border-gray-50 ${c.is_high_rejection ? "bg-rose-50/30" : ""}`}>
                          <td className="px-3 py-1.5 font-medium text-gray-800">{c.campaign_name}</td>
                          <td className="px-2 py-1.5 text-center text-gray-600">{c.total}</td>
                          <td className={`px-2 py-1.5 text-center font-semibold ${c.is_high_rejection ? "text-rose-700" : "text-gray-700"}`}>
                            {Math.round(c.rejection_rate * 100)}%
                          </td>
                          <td className="px-2 py-1.5 text-gray-500 capitalize">{topReason ? `${topReason[0].replace(/_/g, " ")} (${topReason[1]})` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-[9px] text-gray-400 text-right">Generated {new Date(rejectionInsights.generated_at).toLocaleString()}</p>
          </div>
        ) : (
          <div className="p-6 text-center">
            <p className="text-xs text-gray-500">Click <strong>Generate insights</strong> to analyze the last 30 days of rejection patterns.</p>
            <p className="text-[10px] text-gray-400 mt-1">Uses one Claude call (~$0.01).</p>
          </div>
        )}
      </div>

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
