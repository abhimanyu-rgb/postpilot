"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Campaign { id: number; name: string; status: string; }
interface CampaignListData { campaigns: Campaign[]; active_count: number; max_active: number; }
interface Run { id: number; run_date_local: string; status: string; degraded_flag: boolean; skip_reason: string | null; }
interface CampaignRuns { campaign_id: number; campaign_name: string; runs: Run[]; }
interface DraftItem { id: number; status: string; }
interface TokenStats {
  week: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
  month: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
}
interface PublishQueueStatus { posts_today: number; daily_budget: number; remaining: number; approved_waiting: number; queued_for_publish: number; }

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<CampaignListData | null>(null);
  const [allRuns, setAllRuns] = useState<{ campaign: string; run: Run }[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState(0);
  const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
  const [publishQueue, setPublishQueue] = useState<PublishQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [data, drafts, tokens, queue] = await Promise.all([
          api.get<CampaignListData>("/api/campaigns/"),
          api.get<DraftItem[]>("/api/drafts/?status=pending_review").catch(() => []),
          api.get<TokenStats>("/api/setup/token-usage").catch(() => null),
          api.get<PublishQueueStatus>("/api/setup/publish-queue").catch(() => null),
        ]);
        setCampaigns(data);
        setPendingDrafts(drafts.length);
        if (tokens) setTokenStats(tokens);
        if (queue) setPublishQueue(queue);

        const activeCampaigns = data.campaigns.filter((c) => c.status === "active");
        const runResults = await Promise.all(
          activeCampaigns.map((c) => api.get<CampaignRuns>(`/api/runs/${c.id}`).catch(() => null))
        );
        const runs: { campaign: string; run: Run }[] = [];
        runResults.forEach((r) => { if (r) r.runs.forEach((run) => runs.push({ campaign: r.campaign_name, run })); });
        runs.sort((a, b) => (b.run.run_date_local > a.run.run_date_local ? 1 : -1));
        setAllRuns(runs.slice(0, 8));
      } catch { /* empty */ } finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="grid grid-cols-3 gap-4"><div className="h-32 bg-gray-100 rounded-xl" /><div className="h-32 bg-gray-100 rounded-xl" /><div className="h-32 bg-gray-100 rounded-xl" /></div>
        </div>
      </div>
    );
  }

  const activeCount = campaigns?.active_count ?? 0;
  const maxActive = campaigns?.max_active ?? 3;
  const atLimit = activeCount >= maxActive;
  const degradedRuns = allRuns.filter((r) => r.run.degraded_flag).length;
  const pq = publishQueue;

  return (
    <div className="p-6 max-w-[1100px]">
      {/* Header row */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">Content pipeline overview</p>
        </div>
        <Link href="/campaigns/new" className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          New Campaign
        </Link>
      </div>

      {/* Top row: 3 compact KPI cards + publish queue ring */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {/* Campaigns */}
        <Link href="/campaigns" className="rounded-xl border border-indigo-100/50 bg-white p-4 hover:border-violet-200 hover:shadow-md block">
          <div className="flex items-center justify-between mb-2">
            <div className={`w-7 h-7 rounded-lg ${atLimit ? "bg-amber-50" : "bg-violet-50"} flex items-center justify-center`}>
              <svg className={`w-4 h-4 ${atLimit ? "text-amber-500" : "text-violet-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </div>
            {atLimit && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">LIMIT</span>}
          </div>
          <p className={`text-2xl font-bold ${atLimit ? "text-amber-600" : "text-gray-900"}`}>{activeCount}<span className="text-sm font-normal text-gray-300">/{maxActive}</span></p>
          <p className="text-[10px] text-gray-400 mt-0.5">Active campaigns</p>
        </Link>

        {/* Pending review */}
        <Link href="/queue" className="rounded-xl border border-indigo-100/50 bg-white p-4 hover:border-violet-200 hover:shadow-md block">
          <div className="flex items-center justify-between mb-2">
            <div className={`w-7 h-7 rounded-lg ${pendingDrafts > 0 ? "bg-sky-50" : "bg-gray-50"} flex items-center justify-center`}>
              <svg className={`w-4 h-4 ${pendingDrafts > 0 ? "text-sky-500" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            </div>
            {pendingDrafts > 0 && <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />}
          </div>
          <p className="text-2xl font-bold text-gray-900">{pendingDrafts}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Pending review</p>
        </Link>

        {/* Issues */}
        <Link href="/history" className="rounded-xl border border-indigo-100/50 bg-white p-4 hover:border-violet-200 hover:shadow-md block">
          <div className="flex items-center justify-between mb-2">
            <div className={`w-7 h-7 rounded-lg ${degradedRuns > 0 ? "bg-rose-50" : "bg-gray-50"} flex items-center justify-center`}>
              <svg className={`w-4 h-4 ${degradedRuns > 0 ? "text-rose-500" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">{degradedRuns}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">Degraded runs</p>
        </Link>

        {/* Publish queue — compact ring */}
        {pq && (
          <div className="rounded-xl border border-indigo-100/50 bg-white p-4">
            <div className="flex items-center gap-3">
              {/* Ring */}
              <div className="relative w-12 h-12 shrink-0">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="#f3f4f6" strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none"
                    stroke={pq.posts_today >= pq.daily_budget ? "#f59e0b" : "#8b5cf6"}
                    strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${(pq.posts_today / Math.max(1, pq.daily_budget)) * 88} 88`} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold text-gray-900">{pq.posts_today}</span>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Today</p>
                <p className="text-xs text-gray-600">{pq.remaining} slot{pq.remaining !== 1 ? "s" : ""} left</p>
                {(pq.approved_waiting > 0 || pq.queued_for_publish > 0) && (
                  <p className="text-[10px] text-violet-600 font-medium mt-0.5">{pq.queued_for_publish || pq.approved_waiting} queued</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main grid: Runs + Campaigns + Token usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Recent runs — 2 columns */}
        <div className="md:col-span-2 rounded-xl border border-indigo-100/50 bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recent Runs</h2>
            <Link href="/history" className="text-[10px] text-violet-600 hover:text-violet-700 font-medium">View all</Link>
          </div>
          {allRuns.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-xs text-gray-400">No runs yet. Activate a campaign to start.</p>
            </div>
          ) : (
            <div className="divide-y divide-indigo-50/50">
              {allRuns.map((item, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between hover:bg-violet-50/20">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      item.run.status === "completed" && !item.run.degraded_flag ? "bg-emerald-500" :
                      item.run.degraded_flag ? "bg-amber-500" :
                      item.run.status === "running" ? "bg-violet-500" : "bg-rose-500"
                    }`} />
                    <div>
                      <p className="text-xs font-medium text-gray-800">{item.campaign}</p>
                      <p className="text-[10px] text-gray-400">{item.run.run_date_local}</p>
                    </div>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    item.run.status === "completed" && !item.run.degraded_flag ? "bg-emerald-50 text-emerald-700" :
                    item.run.degraded_flag ? "bg-amber-50 text-amber-700" :
                    item.run.status === "running" ? "bg-violet-50 text-violet-700" : "bg-rose-50 text-rose-700"
                  }`}>
                    {item.run.degraded_flag ? "degraded" : item.run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Campaigns + Token usage stacked */}
        <div className="space-y-3">
          {/* Active campaigns */}
          <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Campaigns</h2>
              <Link href="/campaigns" className="text-[10px] text-violet-600 hover:text-violet-700 font-medium">All</Link>
            </div>
            {campaigns?.campaigns.filter((c) => c.status === "active").length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-gray-400">No active campaigns</p>
              </div>
            ) : (
              <div className="divide-y divide-indigo-50/50">
                {campaigns?.campaigns.filter((c) => c.status === "active").map((c) => (
                  <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-violet-50/20">
                    <p className="text-xs font-medium text-gray-800 truncate">{c.name}</p>
                    <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Token usage — compact */}
          {tokenStats && (
            <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm">
              <div className="px-4 py-3 border-b border-indigo-50">
                <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Token Usage</h2>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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
                </div>
                {/* Mini service bars */}
                {Object.keys(tokenStats.month.by_service).length > 0 && (
                  <div className="space-y-1.5">
                    {Object.entries(tokenStats.month.by_service).map(([service, tokens]) => {
                      const total = tokenStats.month.total_tokens || 1;
                      const pct = Math.round((tokens / total) * 100);
                      return (
                        <div key={service} className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-400 w-14 truncate capitalize">{service.replace("_", " ")}</span>
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
        </div>
      </div>
    </div>
  );
}
