"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Campaign { id: number; name: string; status: string; }
interface CampaignListData { campaigns: Campaign[]; active_count: number; max_active: number; }
interface TokenStats {
  week: { calls: number; total_tokens: number; estimated_cost_usd: number };
  month: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
}
interface PublishQueueStatus { posts_today: number; daily_budget: number; remaining: number; approved_waiting: number; queued_for_publish: number; paused: boolean; }

interface SparklinePoint { week_start: string; avg_reactions: number; posts: number; }
interface TopPost { draft_id: number; reactions: number; published_at: string | null; first_line: string; }
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

function Sparkline({ points }: { points: SparklinePoint[] }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.avg_reactions));
  const w = 220;
  const h = 56;
  const step = w / Math.max(1, points.length - 1);
  const coords = points.map((p, i) => [i * step, h - (p.avg_reactions / max) * (h - 6) - 3] as [number, number]);
  const pathD = coords.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const areaD = `${pathD} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <defs>
        <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkGrad)" />
      <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === coords.length - 1 ? 2.5 : 1.5} fill="#8b5cf6" />
      ))}
    </svg>
  );
}

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<CampaignListData | null>(null);
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [publishQueue, setPublishQueue] = useState<PublishQueueStatus | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
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
      } catch { /* empty */ } finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="grid grid-cols-3 gap-4"><div className="h-28 bg-gray-100 rounded-xl" /><div className="h-28 bg-gray-100 rounded-xl" /><div className="h-28 bg-gray-100 rounded-xl" /></div>
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

  return (
    <div className="p-6 max-w-[1100px]">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">Your LinkedIn growth at a glance</p>
        </div>
        <Link href="/campaigns/new" className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          New Campaign
        </Link>
      </div>

      {/* ROW 1 — Reach & Growth */}
      <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Reach &amp; Growth</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {/* Reactions last 7d */}
        <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Reactions · last 7d</p>
            <DeltaBadge pct={reach7?.delta_pct_vs_prior_7d ?? null} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{fmt(reach7?.total_reactions ?? 0)}</p>
          <p className="text-[10px] text-gray-400 mt-1">across {reach7?.posts ?? 0} post{reach7?.posts === 1 ? "" : "s"}</p>
        </div>

        {/* Avg reactions last 30d */}
        <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Avg per post · last 30d</p>
            <DeltaBadge pct={reach30?.delta_pct_vs_prior_30d ?? null} />
          </div>
          <p className="text-3xl font-bold text-gray-900">{(reach30?.avg_reactions_per_post ?? 0).toFixed(1)}</p>
          <p className="text-[10px] text-gray-400 mt-1">from {reach30?.posts ?? 0} post{reach30?.posts === 1 ? "" : "s"}</p>
        </div>

        {/* Top post this week */}
        <Link href="/analytics" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm hover:border-violet-200 hover:shadow-md block">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Top post · last 7d</p>
            {topPost && <span className="text-[10px] font-bold text-violet-600">{topPost.reactions}</span>}
          </div>
          {topPost ? (
            <p className="text-xs text-gray-700 line-clamp-3 leading-snug">{topPost.first_line || "—"}</p>
          ) : (
            <p className="text-xs text-gray-400 italic">No posts published this week yet</p>
          )}
        </Link>
      </div>

      {/* ROW 2 — Engagement Quality */}
      <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Engagement Quality</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        {/* Sparkline */}
        <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm md:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Weekly avg reactions · last 8 weeks</p>
            {eq?.weekly_sparkline && eq.weekly_sparkline.length > 0 && (
              <p className="text-[10px] text-gray-500">latest: <span className="font-semibold text-gray-700">{eq.weekly_sparkline[eq.weekly_sparkline.length - 1].avg_reactions}</span></p>
            )}
          </div>
          {eq?.weekly_sparkline && eq.weekly_sparkline.length > 0 ? (
            <Sparkline points={eq.weekly_sparkline} />
          ) : (
            <p className="text-xs text-gray-400 italic">Not enough data yet</p>
          )}
        </div>

        {/* Above own median + Learned signals stacked */}
        <div className="space-y-3">
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
              <p className="text-[10px] text-gray-400 italic">Need 4+ posts in 30d</p>
            )}
          </div>
          <Link href="/settings" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm block hover:border-violet-200 hover:shadow-md">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Learned signals active</p>
            <p className="text-2xl font-bold text-gray-900">{eq?.learned_signals_active.total ?? 0}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{eq?.learned_signals_active.promoted_insights ?? 0} insights · {eq?.learned_signals_active.promoted_edit_types ?? 0} edit patterns</p>
          </Link>
        </div>
      </div>

      {/* ROW 3 — Pipeline Health */}
      <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Pipeline Health</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Link href="/history" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm block hover:border-violet-200 hover:shadow-md">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Posts published</p>
          <div className="flex items-baseline gap-3">
            <div>
              <p className="text-2xl font-bold text-gray-900">{pipe?.published_7d ?? 0}</p>
              <p className="text-[10px] text-gray-400">last 7d</p>
            </div>
            <div className="border-l border-gray-100 pl-3">
              <p className="text-lg font-semibold text-gray-600">{pipe?.published_30d ?? 0}</p>
              <p className="text-[10px] text-gray-400">last 30d</p>
            </div>
          </div>
        </Link>
        <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Approval rate · 30d</p>
          {pipe?.approval_rate_30d_pct !== null && pipe?.approval_rate_30d_pct !== undefined ? (
            <>
              <p className="text-2xl font-bold text-gray-900">{pipe.approval_rate_30d_pct}%</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{pipe.approved_30d} approved · {pipe.rejected_30d} rejected</p>
            </>
          ) : (
            <p className="text-[10px] text-gray-400 italic">No approval activity yet</p>
          )}
        </div>
        <Link href="/queue" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm block hover:border-violet-200 hover:shadow-md">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Pending review</p>
            {(pipe?.pending_review ?? 0) > 0 && <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />}
          </div>
          <p className="text-2xl font-bold text-gray-900">{pipe?.pending_review ?? 0}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">drafts waiting</p>
        </Link>
      </div>

      {/* ROW 4 — Cost & System */}
      <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Cost &amp; System</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Campaigns */}
        <Link href="/campaigns" className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm block hover:border-violet-200 hover:shadow-md">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Campaigns</p>
            {atLimit && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">LIMIT</span>}
          </div>
          <p className={`text-2xl font-bold ${atLimit ? "text-amber-600" : "text-gray-900"}`}>{activeCount}<span className="text-sm font-normal text-gray-300">/{maxActive}</span></p>
          <p className="text-[10px] text-gray-400 mt-0.5">active</p>
        </Link>

        {/* Cost */}
        {tokenStats ? (
          <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Cost · this month</p>
            <p className="text-2xl font-bold text-gray-900">${tokenStats.month.estimated_cost_usd.toFixed(2)}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{fmt(tokenStats.month.total_tokens)} tokens · ${tokenStats.week.estimated_cost_usd.toFixed(2)} this week</p>
          </div>
        ) : (
          <div className="rounded-xl border border-indigo-100/50 bg-white p-4 shadow-sm">
            <p className="text-[10px] text-gray-400 italic">Cost data unavailable</p>
          </div>
        )}

        {/* Publish queue + pause switch */}
        {pq && (
          <div className={`rounded-xl border ${pq.paused ? "border-rose-200 bg-rose-50/30" : "border-indigo-100/50 bg-white"} p-4 shadow-sm`}>
            <div className="flex items-center gap-3">
              <div className="relative w-12 h-12 shrink-0">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#f3f4f6" strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none"
                    stroke={pq.paused ? "#ef4444" : pq.posts_today >= pq.daily_budget ? "#f59e0b" : "#8b5cf6"}
                    strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${(pq.posts_today / Math.max(1, pq.daily_budget)) * 88} 88`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  {pq.paused ? (
                    <svg className="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" /></svg>
                  ) : (
                    <span className="text-xs font-bold text-gray-900">{pq.posts_today}</span>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{pq.paused ? "Paused" : "Today"}</p>
                {pq.paused ? (
                  <p className="text-[10px] text-rose-600 font-medium">Publishing stopped</p>
                ) : (
                  <p className="text-xs text-gray-600">{pq.remaining} slot{pq.remaining !== 1 ? "s" : ""} left</p>
                )}
              </div>
              <button
                onClick={async () => {
                  if (!pq.paused && !confirm("Pause all scheduled publishing? Queued posts will stop going out until you resume.")) return;
                  await api.post(pq.paused ? "/api/setup/publish-queue/resume" : "/api/setup/publish-queue/pause");
                  const updated = await api.get<PublishQueueStatus>("/api/setup/publish-queue");
                  setPublishQueue(updated);
                }}
                title={pq.paused ? "Resume auto-publishing" : "Pause all scheduled publishing"}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold flex items-center gap-1.5 shrink-0 ${
                  pq.paused
                    ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                    : "bg-rose-100 text-rose-700 hover:bg-rose-200 border border-rose-200"
                }`}
              >
                {pq.paused ? (
                  <><span className="w-2 h-2 rounded-full bg-white animate-pulse" />GO LIVE</>
                ) : (
                  <><span className="w-2 h-2 rounded-full bg-rose-500" />PAUSE</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
