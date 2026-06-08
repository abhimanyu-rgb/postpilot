"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Campaign { id: number; name: string; status: string; }
interface CampaignListData { campaigns: Campaign[]; active_count: number; max_active: number; }
interface TokenStats {
  week: { calls: number; total_tokens: number; estimated_cost_usd: number };
  month: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
  ytd: { calls: number; total_tokens: number; estimated_cost_usd: number };
  ytd_year: number;
}
interface PublishQueueStatus { posts_today: number; daily_budget: number; remaining: number; approved_waiting: number; queued_for_publish: number; paused: boolean; }

interface SparklinePoint { week_start: string; week_end: string; label: string; avg_reactions: number; posts: number; scored_posts: number; total_reactions: number; }
interface TopPost { draft_id: number; reactions: number | null; published_at: string | null; first_line: string; }
interface DashboardKpis {
  reach: {
    last_7d: { total_reactions: number; posts: number; delta_pct_vs_prior_7d: number | null };
    last_30d: { avg_reactions_per_post: number; posts: number; delta_pct_vs_prior_30d: number | null };
    top_post_this_week: TopPost | null;
  };
  engagement_quality: {
    weekly_sparkline: SparklinePoint[];
    pct_above_own_median_30d: number | null;
    learned_signals_active: { promoted_insights: number; promoted_edit_types: number; learned_context_lines: number; total: number };
  };
  pipeline: {
    published_7d: number;
    published_30d: number;
    approval_rate_30d_pct: number | null;
    approved_30d: number;
    rejected_30d: number;
    pending_review: number;
  };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return <span className="text-[10px] text-gray-400">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${positive ? "text-emerald-600" : "text-rose-600"}`}>
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        {positive
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />}
      </svg>
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function EngagementChart({ points }: { points: SparklinePoint[] }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.avg_reactions));
  const W = 600;
  const H = 180;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const step = innerW / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => [padL + i * step, padT + innerH - (p.avg_reactions / max) * innerH] as [number, number]);
  const pathD = coords.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const areaD = `${pathD} L ${padL + innerW} ${padT + innerH} L ${padL} ${padT + innerH} Z`;
  const yTicks = [0, 0.5, 1].map((t) => ({ y: padT + innerH - t * innerH, label: Math.round(max * t) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44">
      <defs>
        <linearGradient id="engGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y} x2={padL + innerW} y2={t.y} stroke="#f3f4f6" strokeWidth="1" />
          <text x={padL - 6} y={t.y + 3} textAnchor="end" fontSize="9" fill="#9ca3af">{t.label}</text>
        </g>
      ))}
      <path d={areaD} fill="url(#engGrad)" />
      <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i === coords.length - 1 ? 3.5 : 2.5} fill="#8b5cf6" />
          <title>{`${points[i].label}: avg ${points[i].avg_reactions} (${points[i].scored_posts}/${points[i].posts} scored)`}</title>
        </g>
      ))}
      {points.map((p, i) => {
        const x = padL + i * step;
        const short = p.label.split("–")[0];
        return (
          <text key={i} x={x} y={H - 8} textAnchor="middle" fontSize="9" fill="#9ca3af">{short}</text>
        );
      })}
    </svg>
  );
}

interface RefreshResult { scraped_count: number; matched_count: number; new_snapshots: number; new_insights: number; skipped_already_scraped_today?: number }

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<CampaignListData | null>(null);
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [publishQueue, setPublishQueue] = useState<PublishQueueStatus | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function loadAll() {
    const [data, tokens, queue, k] = await Promise.all([
      api.get<CampaignListData>("/api/campaigns/"),
      api.get<TokenStats>("/api/setup/token-usage").catch(() => null),
      api.get<PublishQueueStatus>("/api/setup/publish-queue").catch(() => null),
      api.get<DashboardKpis>("/api/dashboard/kpis").catch(() => null),
    ]);
    setCampaigns(data);
    if (tokens) setTokenStats(tokens);
    if (queue) setPublishQueue(queue);
    if (k) setKpis(k);
  }

  useEffect(() => {
    loadAll().catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true); setRefreshError(null); setRefreshResult(null);
    try {
      const result = await api.post<RefreshResult>("/api/analytics/refresh", {});
      setRefreshResult(result);
      await loadAll();
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="h-48 bg-gray-100 rounded-xl" />
          <div className="grid grid-cols-5 gap-3"><div className="h-24 bg-gray-100 rounded-xl" /><div className="h-24 bg-gray-100 rounded-xl" /><div className="h-24 bg-gray-100 rounded-xl" /><div className="h-24 bg-gray-100 rounded-xl" /><div className="h-24 bg-gray-100 rounded-xl" /></div>
        </div>
      </div>
    );
  }

  const activeCount = campaigns?.active_count ?? 0;
  const maxActive = campaigns?.max_active ?? 3;
  const atLimit = activeCount >= maxActive;
  const pq = publishQueue;
  const reach7 = kpis?.reach.last_7d;
  const reach30 = kpis?.reach.last_30d;
  const topPost = kpis?.reach.top_post_this_week;
  const eq = kpis?.engagement_quality;
  const pipe = kpis?.pipeline;
  const sparkline = eq?.weekly_sparkline ?? [];
  const latestWeek = sparkline.length ? sparkline[sparkline.length - 1] : null;

  return (
    <div className="p-6 max-w-[1100px]">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">Your LinkedIn growth at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Re-scrape LinkedIn engagement and recompute KPIs"
            className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 flex items-center gap-1.5"
          >
            {refreshing ? (
              <div className="animate-spin w-3 h-3 border border-violet-600 border-t-transparent rounded-full" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            )}
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <Link href="/campaigns/new" className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            New Campaign
          </Link>
        </div>
      </div>

      {refreshResult && (
        <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-700">
          Scraped {refreshResult.scraped_count} · matched {refreshResult.matched_count} · {refreshResult.new_snapshots} new snapshot{refreshResult.new_snapshots === 1 ? "" : "s"} · {refreshResult.new_insights} new insight{refreshResult.new_insights === 1 ? "" : "s"}
          {refreshResult.skipped_already_scraped_today ? ` · ${refreshResult.skipped_already_scraped_today} skipped (already scraped today)` : ""}
        </div>
      )}
      {refreshError && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] text-rose-700">
          {refreshError}
        </div>
      )}

      {/* ROW 1 — Engagement chart (hero) */}
      <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm mb-5">
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Weekly engagement</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">Avg reactions per post · last 8 weeks</p>
          </div>
          {latestWeek && (
            <div className="text-right">
              <p className="text-[10px] text-gray-400">{latestWeek.label}</p>
              <p className="text-lg font-bold text-violet-600">{latestWeek.avg_reactions}<span className="text-[10px] font-normal text-gray-400 ml-1">avg</span></p>
            </div>
          )}
        </div>
        <div className="px-2 pb-3">
          {sparkline.length > 0 ? (
            <EngagementChart points={sparkline} />
          ) : (
            <p className="text-xs text-gray-400 italic px-4 py-8 text-center">Not enough data yet</p>
          )}
        </div>
      </div>

      {/* ROW 2 — Reach summary (3 stat cards) */}
      <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Reach</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Reactions · last 7d</p>
            <DeltaBadge pct={reach7?.delta_pct_vs_prior_7d ?? null} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{fmt(reach7?.total_reactions ?? 0)}</p>
          <p className="text-[10px] text-gray-400 mt-1">across {reach7?.posts ?? 0} post{reach7?.posts === 1 ? "" : "s"}</p>
        </div>

        <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Avg per post · last 30d</p>
            <DeltaBadge pct={reach30?.delta_pct_vs_prior_30d ?? null} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{(reach30?.avg_reactions_per_post ?? 0).toFixed(1)}</p>
          <p className="text-[10px] text-gray-400 mt-1">from {reach30?.posts ?? 0} post{reach30?.posts === 1 ? "" : "s"}</p>
        </div>

        <Link href="/analytics" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm hover:border-violet-200 hover:shadow-md block">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Top post · last 7d</p>
            {topPost && (
              topPost.reactions !== null
                ? <span className="text-[10px] font-bold text-violet-600">{topPost.reactions}</span>
                : <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">pending scrape</span>
            )}
          </div>
          {topPost ? (
            <p className="text-xs text-gray-700 line-clamp-3 leading-snug">{topPost.first_line || "—"}</p>
          ) : (
            <p className="text-xs text-gray-400 italic">No posts published this week yet</p>
          )}
        </Link>
      </div>

      {/* ROW 3 — Combined operations row: Campaigns, Published, Pending, Approval, Today/Pause */}
      <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Operations</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {/* Campaigns */}
        <Link href="/campaigns" className="rounded-xl border border-indigo-100/50 bg-white p-3.5 shadow-sm block hover:border-violet-200 hover:shadow-md">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide font-semibold">Campaigns</p>
            {atLimit && <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">LIMIT</span>}
          </div>
          <p className={`text-xl font-bold ${atLimit ? "text-amber-600" : "text-gray-900"}`}>{activeCount}<span className="text-xs font-normal text-gray-300">/{maxActive}</span></p>
          <p className="text-[9px] text-gray-400 mt-0.5">active</p>
        </Link>

        {/* Posts published */}
        <Link href="/history" className="rounded-xl border border-indigo-100/50 bg-white p-3.5 shadow-sm block hover:border-violet-200 hover:shadow-md">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Published</p>
          <p className="text-xl font-bold text-gray-900">{pipe?.published_7d ?? 0}</p>
          <p className="text-[9px] text-gray-400 mt-0.5">7d · {pipe?.published_30d ?? 0} in 30d</p>
        </Link>

        {/* Pending review */}
        <Link href="/queue" className="rounded-xl border border-indigo-100/50 bg-white p-3.5 shadow-sm block hover:border-violet-200 hover:shadow-md">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] text-gray-400 uppercase tracking-wide font-semibold">Pending review</p>
            {(pipe?.pending_review ?? 0) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />}
          </div>
          <p className="text-xl font-bold text-gray-900">{pipe?.pending_review ?? 0}</p>
          <p className="text-[9px] text-gray-400 mt-0.5">drafts waiting</p>
        </Link>

        {/* Approval rate */}
        <div className="rounded-xl border border-indigo-100/50 bg-white p-3.5 shadow-sm">
          <p className="text-[9px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Approval rate</p>
          {pipe?.approval_rate_30d_pct !== null && pipe?.approval_rate_30d_pct !== undefined ? (
            <>
              <p className="text-xl font-bold text-gray-900">{pipe.approval_rate_30d_pct}%</p>
              <p className="text-[9px] text-gray-400 mt-0.5">30d · {pipe.approved_30d}✓ {pipe.rejected_30d}✗</p>
            </>
          ) : (
            <p className="text-[10px] text-gray-400 italic">No activity yet</p>
          )}
        </div>

        {/* Today / Pause */}
        {pq && (
          <div className={`rounded-xl border ${pq.paused ? "border-rose-200 bg-rose-50/30" : "border-indigo-100/50 bg-white"} p-3.5 shadow-sm`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] text-gray-400 uppercase tracking-wide font-semibold">{pq.paused ? "Paused" : "Today"}</p>
              <button
                onClick={async () => {
                  if (!pq.paused && !confirm("Pause all scheduled publishing? Queued posts will stop going out until you resume.")) return;
                  await api.post(pq.paused ? "/api/setup/publish-queue/resume" : "/api/setup/publish-queue/pause");
                  const updated = await api.get<PublishQueueStatus>("/api/setup/publish-queue");
                  setPublishQueue(updated);
                }}
                title={pq.paused ? "Resume auto-publishing" : "Pause all scheduled publishing"}
                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                  pq.paused
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-rose-100 text-rose-700 hover:bg-rose-200 border border-rose-200"
                }`}
              >
                {pq.paused ? "GO LIVE" : "PAUSE"}
              </button>
            </div>
            <p className="text-xl font-bold text-gray-900">{pq.posts_today}<span className="text-xs font-normal text-gray-300">/{pq.daily_budget}</span></p>
            <p className="text-[9px] text-gray-400 mt-0.5">{pq.paused ? "publishing stopped" : `${pq.remaining} slot${pq.remaining !== 1 ? "s" : ""} left`}</p>
          </div>
        )}
      </div>

      {/* ROW 4 — Cost & Learning */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Token usage with breakdown (restored from previous design) */}
        {tokenStats && (
          <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm md:col-span-2">
            <div className="px-4 py-3 border-b border-indigo-50">
              <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Token Usage</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-[10px] text-gray-400">This week</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(tokenStats.week.total_tokens)}</p>
                  <p className="text-[10px] text-gray-400">${tokenStats.week.estimated_cost_usd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">This month</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(tokenStats.month.total_tokens)}</p>
                  <p className="text-[10px] text-gray-400">${tokenStats.month.estimated_cost_usd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">YTD {tokenStats.ytd_year}</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(tokenStats.ytd.total_tokens)}</p>
                  <p className="text-[10px] text-gray-400">${tokenStats.ytd.estimated_cost_usd.toFixed(2)}</p>
                </div>
              </div>
              {Object.keys(tokenStats.month.by_service).length > 0 && (
                <div className="space-y-1.5">
                  {Object.entries(tokenStats.month.by_service).map(([service, tokens]) => {
                    const total = tokenStats.month.total_tokens || 1;
                    const pct = Math.round((tokens / total) * 100);
                    return (
                      <div key={service} className="flex items-center gap-2">
                        <span className="text-[9px] text-gray-400 w-20 truncate capitalize">{service.replace(/_/g, " ")}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-indigo-400 to-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-400 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Learned signals + above-own-median stacked */}
        <div className="space-y-3">
          <Link href="/settings" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm block hover:border-violet-200 hover:shadow-md">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Learned signals active</p>
            <p className="text-2xl font-bold text-gray-900">{eq?.learned_signals_active.total ?? 0}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{eq?.learned_signals_active.promoted_insights ?? 0} insights · {eq?.learned_signals_active.promoted_edit_types ?? 0} edit patterns</p>
          </Link>
          <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Above own median · 30d</p>
            {eq?.pct_above_own_median_30d !== null && eq?.pct_above_own_median_30d !== undefined ? (
              <>
                <p className="text-2xl font-bold text-gray-900">{eq.pct_above_own_median_30d}%</p>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden mt-1.5">
                  <div className="h-full bg-gradient-to-r from-violet-400 to-indigo-500 rounded-full" style={{ width: `${eq.pct_above_own_median_30d}%` }} />
                </div>
              </>
            ) : (
              <p className="text-[10px] text-gray-400 italic">Need 4+ scored posts in 30d</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
