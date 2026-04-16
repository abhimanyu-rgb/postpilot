"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Campaign {
  id: number;
  name: string;
  status: string;
}

interface CampaignListData {
  campaigns: Campaign[];
  active_count: number;
  max_active: number;
}

interface Run {
  id: number;
  run_date_local: string;
  status: string;
  degraded_flag: boolean;
  skip_reason: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface CampaignRuns {
  campaign_id: number;
  campaign_name: string;
  runs: Run[];
}

interface DraftItem {
  id: number;
  status: string;
}

interface TokenStats {
  week: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
  month: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
  all_time: { calls: number; total_tokens: number; estimated_cost_usd: number; by_service: Record<string, number> };
}

interface PublishQueueStatus {
  posts_today: number;
  daily_budget: number;
  remaining: number;
  approved_waiting: number;
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
          activeCampaigns.map((c) =>
            api.get<CampaignRuns>(`/api/runs/${c.id}`).catch(() => null)
          )
        );

        const runs: { campaign: string; run: Run }[] = [];
        runResults.forEach((r) => {
          if (r) {
            r.runs.forEach((run) => runs.push({ campaign: r.campaign_name, run }));
          }
        });
        runs.sort((a, b) => (b.run.run_date_local > a.run.run_date_local ? 1 : -1));
        setAllRuns(runs.slice(0, 10));
      } catch {
        /* empty */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const activeCount = campaigns?.active_count ?? 0;
  const maxActive = campaigns?.max_active ?? 3;
  const totalCampaigns = campaigns?.campaigns.length ?? 0;
  const atLimit = activeCount >= maxActive;
  const completedRuns = allRuns.filter((r) => r.run.status === "completed").length;
  const degradedRuns = allRuns.filter((r) => r.run.degraded_flag).length;

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Overview of your content pipeline</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/campaigns/new"
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Campaign
          </Link>
        </div>
      </div>

      {/* Campaign limit alert */}
      {atLimit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 mb-6 flex items-start gap-3 animate-fade-in">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              Active campaign limit reached ({activeCount}/{maxActive})
            </p>
            <p className="text-sm text-amber-700 mt-0.5">
              You cannot activate new campaigns until you pause or archive an existing one.
            </p>
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-1 text-sm font-medium text-amber-800 hover:text-amber-900 mt-2"
            >
              Manage campaigns
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Campaigns"
          value={`${activeCount}/${maxActive}`}
          subtitle={atLimit ? "Limit reached" : `${totalCampaigns} total`}
          color={atLimit ? "amber" : "indigo"}
          href="/campaigns"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <StatCard
          label="Recent Runs"
          value={allRuns.length}
          subtitle={`${completedRuns} completed`}
          color="emerald"
          href="/history"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="Drafts Pending"
          value={pendingDrafts}
          subtitle="Review queue"
          color={pendingDrafts > 0 ? "amber" : "gray"}
          href="/queue"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <StatCard
          label="Issues"
          value={degradedRuns}
          subtitle="Degraded runs"
          color={degradedRuns > 0 ? "rose" : "gray"}
          href="/history"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
      </div>

      {/* Publish Queue Status */}
      {publishQueue && (
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Posts Today</p>
                <p className="text-lg font-semibold text-gray-900">
                  {publishQueue.posts_today}
                  <span className="text-sm font-normal text-gray-400"> / {publishQueue.daily_budget}</span>
                </p>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Slots Remaining</p>
                <p className={`text-lg font-semibold ${publishQueue.remaining > 0 ? "text-emerald-600" : "text-amber-600"}`}>
                  {publishQueue.remaining}
                </p>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Approved & Waiting</p>
                <p className={`text-lg font-semibold ${publishQueue.approved_waiting > 0 ? "text-indigo-600" : "text-gray-400"}`}>
                  {publishQueue.approved_waiting}
                </p>
              </div>
            </div>
            {publishQueue.remaining === 0 && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg font-medium">
                Daily limit reached
              </span>
            )}
            {publishQueue.approved_waiting > 0 && publishQueue.remaining > 0 && (
              <span className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-lg font-medium">
                {publishQueue.approved_waiting} post{publishQueue.approved_waiting > 1 ? "s" : ""} queued for auto-publish
              </span>
            )}
          </div>
          {/* Progress bar */}
          <div className="mt-3 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${publishQueue.posts_today >= publishQueue.daily_budget ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, (publishQueue.posts_today / Math.max(1, publishQueue.daily_budget)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent runs */}
        <div className="lg:col-span-2 rounded-xl border border-indigo-100/50 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-indigo-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Recent Runs</h2>
            <span className="text-xs text-gray-400">{allRuns.length} runs</span>
          </div>
          {allRuns.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-400">No runs yet. Activate a campaign to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-indigo-50/50">
              {allRuns.map((item, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between hover:bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      item.run.status === "completed" && !item.run.degraded_flag
                        ? "bg-emerald-500"
                        : item.run.status === "completed" && item.run.degraded_flag
                        ? "bg-amber-500"
                        : item.run.status === "running"
                        ? "bg-indigo-500"
                        : "bg-rose-500"
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{item.campaign}</p>
                      <p className="text-xs text-gray-400">{item.run.run_date_local}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      item.run.status === "completed" && !item.run.degraded_flag
                        ? "bg-emerald-50 text-emerald-700"
                        : item.run.status === "completed" && item.run.degraded_flag
                        ? "bg-amber-50 text-amber-700"
                        : item.run.status === "running"
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-rose-50 text-rose-700"
                    }`}>
                      {item.run.degraded_flag ? "degraded" : item.run.status}
                    </span>
                    {item.run.skip_reason && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{item.run.skip_reason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active campaigns */}
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-indigo-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Active Campaigns</h2>
            <Link href="/campaigns" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
              View all
            </Link>
          </div>
          {campaigns?.campaigns.filter((c) => c.status === "active").length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-400">No active campaigns</p>
              <Link href="/campaigns/new" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium mt-2 inline-block">
                Create one
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-indigo-50/50">
              {campaigns?.campaigns
                .filter((c) => c.status === "active")
                .map((c) => (
                  <Link
                    key={c.id}
                    href={`/campaigns/${c.id}`}
                    className="block px-5 py-3 hover:bg-gray-50/50"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-800">{c.name}</p>
                      <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </Link>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Token Usage */}
      {tokenStats && (
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm mt-6">
          <div className="px-5 py-4 border-b border-indigo-50">
            <h2 className="text-sm font-semibold text-gray-900">Token Usage</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <TokenPeriod label="This Week" data={tokenStats.week} />
              <TokenPeriod label="This Month" data={tokenStats.month} />
              <TokenPeriod label="All Time" data={tokenStats.all_time} />
            </div>
            {/* Service breakdown for this month */}
            {Object.keys(tokenStats.month.by_service).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Monthly breakdown by service</p>
                <div className="flex gap-2">
                  {Object.entries(tokenStats.month.by_service).map(([service, tokens]) => {
                    const total = tokenStats.month.total_tokens || 1;
                    const pct = Math.round((tokens / total) * 100);
                    return (
                      <div key={service} className="flex-1 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                        <p className="text-[10px] text-gray-400 capitalize">{service.replace("_", " ")}</p>
                        <p className="text-sm font-semibold text-gray-700">{(tokens / 1000).toFixed(1)}k</p>
                        <div className="w-full h-1 bg-gray-200 rounded-full mt-1">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color,
  icon,
  href,
}: {
  label: string;
  value: number | string;
  subtitle: string;
  color: string;
  icon: React.ReactNode;
  href?: string;
}) {
  const colorMap: Record<string, { bg: string; icon: string; text: string }> = {
    indigo: { bg: "bg-violet-50", icon: "text-violet-600", text: "text-indigo-600" },
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-600", text: "text-emerald-600" },
    amber: { bg: "bg-amber-50", icon: "text-amber-600", text: "text-amber-600" },
    rose: { bg: "bg-rose-50", icon: "text-rose-600", text: "text-rose-600" },
    gray: { bg: "bg-gray-50", icon: "text-gray-400", text: "text-gray-600" },
  };
  const cl = colorMap[color] || colorMap.gray;

  const content = (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${cl.bg} flex items-center justify-center ${cl.icon}`}>
          {icon}
        </div>
      </div>
      <p className={`text-2xl font-semibold ${cl.text}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="rounded-xl border border-indigo-100/50 bg-white shadow-sm p-4 hover:border-violet-200 hover:shadow-md block">
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm p-4">
      {content}
    </div>
  );
}

function TokenPeriod({
  label,
  data,
}: {
  label: string;
  data: { calls: number; total_tokens: number; estimated_cost_usd: number };
}) {
  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{formatTokens(data.total_tokens)}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">tokens</p>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-200">
        <span className="text-[10px] text-gray-400">{data.calls} calls</span>
        <span className="text-[10px] font-medium text-gray-600">${data.estimated_cost_usd.toFixed(2)}</span>
      </div>
    </div>
  );
}
