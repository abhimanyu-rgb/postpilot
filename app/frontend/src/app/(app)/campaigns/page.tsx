"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import CampaignCard from "./components/CampaignCard";

interface Campaign {
  id: number;
  name: string;
  status: string;
  topics_json: string;
  frequency: string;
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
    api
      .get<CampaignListData>("/api/campaigns/")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-36 bg-gray-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Campaigns</h1>
          {data && (
            <p className="text-sm text-gray-500 mt-1">
              <span className={`font-medium ${data.active_count >= data.max_active ? "text-amber-600" : "text-indigo-600"}`}>
                {data.active_count}
              </span>{" "}
              / {data.max_active} active
            </p>
          )}
        </div>
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

      {/* Limit alert */}
      {data && data.active_count >= data.max_active && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 mb-6 flex items-center gap-3 animate-fade-in">
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800">
            <span className="font-medium">Active campaign limit reached.</span>{" "}
            Pause or archive a campaign below to activate a new one.
          </p>
        </div>
      )}

      {data && data.campaigns.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">No campaigns yet</h3>
          <p className="text-sm text-gray-400 mb-4">Create your first campaign to start generating content.</p>
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Create campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data?.campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}
