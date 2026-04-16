"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import Badge from "@/components/ui/Badge";

interface Campaign {
  id: number;
  name: string;
  status: string;
  topics_json: string;
  persona: string;
  tone: string;
  frequency: string;
  posting_window_start: string | null;
  posting_window_end: string | null;
  significance_threshold: number;
  source_preferences_json: string;
  novelty_cooldown_days: number;
  profile_adherence_override: string | null;
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

interface ActiveCountData {
  active_count: number;
  max_active: number;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeData, setActiveData] = useState<ActiveCountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const id = params.id as string;
  const atLimit = activeData ? activeData.active_count >= activeData.max_active : false;

  useEffect(() => {
    Promise.all([
      api.get<Campaign>(`/api/campaigns/${id}`),
      api.get<{ runs: Run[] }>(`/api/runs/${id}`).catch(() => ({ runs: [] })),
      api.get<ActiveCountData>("/api/campaigns/active-count").catch(() => null),
    ]).then(([c, r, a]) => {
      setCampaign(c);
      setRuns(r.runs);
      if (a) setActiveData(a);
      setLoading(false);
    });
  }, [id]);

  async function handleAction(action: string) {
    setActionLoading(true);
    setActionError(null);
    try {
      const updated = await api.post<Campaign>(`/api/campaigns/${id}/${action}`);
      setCampaign(updated);
      // Refresh active count after state change
      const a = await api.get<ActiveCountData>("/api/campaigns/active-count").catch(() => null);
      if (a) setActiveData(a);
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      const detail = err?.body?.detail || err?.message || "Action failed";
      setActionError(detail);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this campaign? This cannot be undone.")) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await api.delete(`/api/campaigns/${id}`);
      router.push("/campaigns");
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      const detail = err?.body?.detail || err?.message || "Delete failed";
      setActionError(detail);
      setActionLoading(false);
    }
  }

  async function handleTriggerRun() {
    setTriggerLoading(true);
    try {
      await api.post(`/api/runs/${id}/trigger?force=true`);
      setTimeout(async () => {
        const r = await api.get<{ runs: Run[] }>(`/api/runs/${id}`).catch(() => ({ runs: [] }));
        setRuns(r.runs);
        setTriggerLoading(false);
      }, 2000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Trigger failed");
      setTriggerLoading(false);
    }
  }

  if (loading || !campaign) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-gray-200 rounded-lg" />
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  let topics: string[] = [];
  let sources: string[] = [];
  try { topics = JSON.parse(campaign.topics_json); } catch { /* empty */ }
  try { sources = JSON.parse(campaign.source_preferences_json); } catch { /* empty */ }

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{campaign.name}</h1>
            <Badge status={campaign.status} />
          </div>
          <p className="text-sm text-gray-400 mt-1 capitalize">{campaign.frequency} schedule</p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "active" && (
            <button
              onClick={handleTriggerRun}
              disabled={triggerLoading}
              className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1.5"
            >
              {triggerLoading ? (
                <div className="animate-spin w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              )}
              Trigger Run
            </button>
          )}
          {campaign.status !== "archived" && (
            <Link
              href={`/campaigns/${id}/edit`}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Edit
            </Link>
          )}
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button
              onClick={() => handleAction("activate")}
              disabled={actionLoading || atLimit}
              title={atLimit ? `Active limit reached (${activeData?.active_count}/${activeData?.max_active})` : undefined}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm"
            >
              Activate
            </button>
          )}
          {campaign.status === "active" && (
            <button
              onClick={() => handleAction("pause")}
              disabled={actionLoading}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 shadow-sm"
            >
              Pause
            </button>
          )}
          {campaign.status !== "archived" && campaign.status !== "completed" && (
            <button
              onClick={() => handleAction("archive")}
              disabled={actionLoading}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              Archive
            </button>
          )}
          {campaign.status !== "active" && (
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50"
              title="Delete campaign permanently"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Action error */}
      {actionError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-3.5 mb-4 flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-rose-700">{actionError}</p>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Limit alert for inactive campaigns */}
      {atLimit && (campaign.status === "draft" || campaign.status === "paused") && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 mb-4 flex items-center gap-3 animate-fade-in">
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800">
            <span className="font-medium">Cannot activate</span> — active campaign limit reached ({activeData?.active_count}/{activeData?.max_active}).
            Pause or archive another campaign first.
          </p>
        </div>
      )}

      {/* Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Topics</h3>
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <span key={t} className="rounded-md bg-indigo-50 border border-indigo-100 px-2.5 py-1 text-xs text-indigo-700">
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Persona & Tone</h3>
          <p className="text-sm text-gray-700 mb-2">{campaign.persona}</p>
          <span className="inline-block rounded-md bg-gray-50 border border-gray-100 px-2 py-0.5 text-xs text-gray-500 capitalize">
            {campaign.tone}
          </span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Schedule</h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-gray-400 text-xs">Frequency</p>
              <p className="text-gray-700 capitalize font-medium">{campaign.frequency}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Window</p>
              <p className="text-gray-700 font-medium">{campaign.posting_window_start || "—"} – {campaign.posting_window_end || "—"}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Cooldown</p>
              <p className="text-gray-700 font-medium">{campaign.novelty_cooldown_days}d</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Configuration</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-400 text-xs">Threshold</p>
              <p className="text-gray-700 font-medium">{campaign.significance_threshold.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs">Adherence</p>
              <p className="text-gray-700 font-medium capitalize">{campaign.profile_adherence_override || "Default"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-gray-400 text-xs mb-1.5">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s) => (
                  <span key={s} className="rounded-full bg-sky-50 border border-sky-100 px-2.5 py-0.5 text-[11px] text-sky-700">
                    {s.replace("_", " ")}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Run History */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Run History</h2>
          <span className="text-xs text-gray-400">{runs.length} runs</span>
        </div>
        {runs.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-gray-400">No runs yet</p>
            {campaign.status === "active" && (
              <p className="text-xs text-gray-300 mt-1">Next run scheduled automatically, or trigger one manually</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {runs.map((run) => (
              <div key={run.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    run.status === "completed" && !run.degraded_flag ? "bg-emerald-500" :
                    run.status === "completed" && run.degraded_flag ? "bg-amber-500" :
                    run.status === "running" ? "bg-indigo-500" :
                    "bg-rose-500"
                  }`} />
                  <div>
                    <p className="text-sm text-gray-700">{run.run_date_local}</p>
                    <p className="text-[11px] text-gray-400">Run #{run.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {run.skip_reason && (
                    <span className="text-[11px] text-gray-400">{run.skip_reason}</span>
                  )}
                  <Badge status={run.degraded_flag ? "degraded" : run.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Back */}
      <div className="mt-6">
        <button onClick={() => router.push("/campaigns")} className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to campaigns
        </button>
      </div>
    </div>
  );
}
