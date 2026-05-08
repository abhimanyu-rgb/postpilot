"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

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
}

interface PostsResponse {
  posts: AnalyticsRow[];
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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function staleness(lastIso: string | null): { days: number; label: string; tone: "fresh" | "stale" | "very-stale" | "none" } {
  if (!lastIso) return { days: -1, label: "Never refreshed", tone: "none" };
  const then = new Date(lastIso).getTime();
  if (Number.isNaN(then)) return { days: -1, label: "Never refreshed", tone: "none" };
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 1) return { days, label: "Updated today", tone: "fresh" };
  if (days < 7) return { days, label: `Updated ${days}d ago`, tone: "fresh" };
  if (days < 14) return { days, label: `Updated ${days}d ago — may be stale`, tone: "stale" };
  return { days, label: `Updated ${days}d ago — likely stale`, tone: "very-stale" };
}

export default function AnalyticsPage() {
  const [posts, setPosts] = useState<AnalyticsRow[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [insights, setInsights] = useState<StagedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const p = await api.get<PostsResponse>("/api/analytics/posts");
      setPosts(p.posts);
      setLastRefresh(p.last_refresh);
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

  const stale = staleness(lastRefresh);
  const staleClass = stale.tone === "very-stale" ? "text-rose-600" : stale.tone === "stale" ? "text-amber-600" : stale.tone === "none" ? "text-gray-400" : "text-emerald-600";

  // Sort posts by score desc for the table
  const sortedPosts = [...posts].sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0));

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

      {/* Staged insights — show first because they need user action */}
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
                  <button
                    onClick={() => handlePromote(ins.id)}
                    className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                  >
                    Add to learned context
                  </button>
                  <button
                    onClick={() => handleReject(ins.id)}
                    className="rounded-md border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Engagement table */}
      <div className="mt-6 rounded-xl border border-indigo-100/50 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-indigo-50">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Posts ({sortedPosts.length})</h2>
        </div>
        {loading ? (
          <div className="p-6 text-xs text-gray-400">Loading...</div>
        ) : sortedPosts.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-gray-500 mb-1">No analytics yet</p>
            <p className="text-[11px] text-gray-400">
              Click <strong>Refresh now</strong> to scrape engagement for posts published 7–14 days ago.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-indigo-50/60">
            {sortedPosts.map((row) => (
              <div key={row.draft_id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 line-clamp-3 whitespace-pre-wrap">{row.primary_text_first_200}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                      <span>Published {formatDate(row.published_at)}</span>
                      <span>·</span>
                      <span>Scraped {formatDate(row.scraped_at)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold text-indigo-600 leading-none">{row.engagement_score ?? "—"}</p>
                    <p className="text-[10px] text-gray-400 mt-1">score</p>
                    <p className="text-[10px] text-gray-500 mt-1.5">{row.reactions ?? 0} reactions</p>
                  </div>
                </div>
                {row.manual_feedback && (
                  <div className="mt-2.5 rounded-md bg-violet-50/40 border border-violet-100 px-2.5 py-1.5">
                    <p className="text-[10px] text-violet-700 font-semibold uppercase tracking-wide">Your manual feedback</p>
                    {row.manual_feedback.performance_rating && (
                      <p className="text-[11px] text-gray-700 mt-0.5">Rating: {row.manual_feedback.performance_rating}</p>
                    )}
                    {row.manual_feedback.what_worked && (
                      <p className="text-[11px] text-gray-600 mt-0.5"><span className="font-medium">Worked:</span> {row.manual_feedback.what_worked}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
