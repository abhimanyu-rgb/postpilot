"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import Badge from "@/components/ui/Badge";

interface Campaign {
  id: number;
  name: string;
  status: string;
  topics_json: string;
  frequency: string;
  tone: string;
  posting_window_start: string | null;
  posting_window_end: string | null;
}

interface CampaignListData {
  campaigns: Campaign[];
  active_count: number;
  max_active: number;
}

export default function CampaignsPage() {
  const [data, setData] = useState<CampaignListData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<CampaignListData>("/api/campaigns/").then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6"><div className="animate-pulse space-y-3"><div className="h-6 w-40 bg-gray-200 rounded" /><div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}</div></div></div>
    );
  }

  const atLimit = data ? data.active_count >= data.max_active : false;

  return (
    <div className="p-6 max-w-[900px]">
      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Campaigns</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs font-medium ${atLimit ? "text-amber-600" : "text-violet-600"}`}>
              {data?.active_count}/{data?.max_active} active
            </span>
            {atLimit && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">LIMIT</span>}
          </div>
        </div>
        <Link href="/campaigns/new" className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          New Campaign
        </Link>
      </div>

      {data && data.campaigns.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-sm text-gray-500 mb-3">No campaigns yet</p>
          <Link href="/campaigns/new" className="text-xs font-medium text-violet-600 hover:text-violet-700">Create your first campaign</Link>
        </div>
      ) : (
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm overflow-hidden">
          <div className="divide-y divide-indigo-50/50">
            {data?.campaigns.map((c) => {
              let topics: string[] = [];
              try { topics = JSON.parse(c.topics_json); } catch { /* empty */ }

              return (
                <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-violet-50/20 group">
                  {/* Status indicator */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    c.status === "active" ? "bg-emerald-500" :
                    c.status === "draft" ? "bg-gray-300" :
                    c.status === "paused" ? "bg-amber-400" : "bg-gray-300"
                  }`} />

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate group-hover:text-violet-700">{c.name}</p>
                      <Badge status={c.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-gray-400 capitalize">{c.frequency.replace(/_/g, " ")}</span>
                      {c.posting_window_start && (
                        <>
                          <span className="text-[10px] text-gray-300">|</span>
                          <span className="text-[10px] text-gray-400">{c.posting_window_start} - {c.posting_window_end}</span>
                        </>
                      )}
                      <span className="text-[10px] text-gray-300">|</span>
                      <span className="text-[10px] text-gray-400 capitalize">{c.tone}</span>
                    </div>
                  </div>

                  {/* Topics */}
                  <div className="hidden sm:flex flex-wrap gap-1 shrink-0 max-w-[200px] justify-end">
                    {topics.slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] text-indigo-600">{t}</span>
                    ))}
                    {topics.length > 3 && <span className="text-[9px] text-gray-300">+{topics.length - 3}</span>}
                  </div>

                  <svg className="w-4 h-4 text-gray-300 shrink-0 group-hover:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
