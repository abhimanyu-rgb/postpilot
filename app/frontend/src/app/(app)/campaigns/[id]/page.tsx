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
    return (<div className="p-6"><div className="animate-pulse space-y-3"><div className="h-6 w-64 bg-gray-200 rounded" /><div className="h-32 bg-gray-100 rounded-xl" /></div></div>);
  }

  let topics: string[] = [];
  let sources: string[] = [];
  try { topics = JSON.parse(campaign.topics_json); } catch { /* empty */ }
  try { sources = JSON.parse(campaign.source_preferences_json); } catch { /* empty */ }

  return (
    <div className="p-6 max-w-[900px]">
      {/* Back + Header */}
      <button onClick={() => router.push("/campaigns")} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Campaigns
      </button>

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900">{campaign.name}</h1>
            <Badge status={campaign.status} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5 capitalize">{campaign.frequency.replace(/_/g, " ")} | {campaign.tone} | {campaign.posting_window_start || "—"} to {campaign.posting_window_end || "—"}</p>
        </div>
        <div className="flex gap-1.5">
          {campaign.status === "active" && (
            <button onClick={handleTriggerRun} disabled={triggerLoading}
              className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center gap-1">
              {triggerLoading ? <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> :
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
              Run
            </button>
          )}
          {campaign.status !== "archived" && (
            <Link href={`/campaigns/${id}/edit`} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50">Edit</Link>
          )}
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button onClick={() => handleAction("activate")} disabled={actionLoading || atLimit}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm">Activate</button>
          )}
          {campaign.status === "active" && (
            <button onClick={() => handleAction("pause")} disabled={actionLoading}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 shadow-sm">Pause</button>
          )}
          {campaign.status !== "archived" && campaign.status !== "completed" && (
            <button onClick={() => handleAction("archive")} disabled={actionLoading}
              className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 disabled:opacity-50">Archive</button>
          )}
          {campaign.status !== "active" && (
            <button onClick={handleDelete} disabled={actionLoading}
              className="rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:text-rose-500 hover:border-rose-200 disabled:opacity-50" title="Delete">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Errors */}
      {actionError && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 mb-3 flex items-center justify-between text-xs text-rose-700 animate-fade-in">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-rose-600 ml-2">x</button>
        </div>
      )}
      {atLimit && (campaign.status === "draft" || campaign.status === "paused") && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 mb-3 text-xs text-amber-700 animate-fade-in">
          Cannot activate. Active limit reached ({activeData?.active_count}/{activeData?.max_active}).
        </div>
      )}

      {/* Config grid — compact single card */}
      <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm mb-4">
        <div className="p-4 grid grid-cols-2 gap-x-6 gap-y-3">
          {/* Persona */}
          <div className="col-span-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Persona</p>
            <p className="text-xs text-gray-700 leading-relaxed">{campaign.persona}</p>
          </div>

          {/* Topics */}
          <div className="col-span-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Topics</p>
            <div className="flex flex-wrap gap-1">
              {topics.map((t) => (<span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">{t}</span>))}
            </div>
          </div>

          <div className="h-px bg-indigo-50 col-span-2" />

          {/* Stats row */}
          <div className="col-span-2 grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <p className="text-[10px] text-gray-400">Threshold</p>
              <p className="text-xs font-medium text-gray-700">{campaign.significance_threshold.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Cooldown</p>
              <p className="text-xs font-medium text-gray-700">{campaign.novelty_cooldown_days}d</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400">Adherence</p>
              <p className="text-xs font-medium text-gray-700 capitalize">{campaign.profile_adherence_override || "Default"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-gray-400 mb-1">Sources</p>
              <div className="flex flex-wrap gap-1">
                {sources.map((s) => (<span key={s} className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] text-sky-600">{s.replace("_"," ")}</span>))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Run History — compact table */}
      <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Run History</h2>
          <span className="text-[10px] text-gray-400">{runs.length} runs</span>
        </div>
        {runs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-400">No runs yet{campaign.status === "active" ? ". Trigger one or wait for scheduled run." : "."}</p>
          </div>
        ) : (
          <div className="divide-y divide-indigo-50/50">
            {runs.map((run) => (
              <div key={run.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-violet-50/20">
                <div className="flex items-center gap-2.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    run.status === "completed" && !run.degraded_flag ? "bg-emerald-500" :
                    run.degraded_flag ? "bg-amber-500" :
                    run.status === "running" ? "bg-violet-500" : "bg-rose-500"
                  }`} />
                  <span className="text-xs text-gray-700">{run.run_date_local}</span>
                  <span className="text-[10px] text-gray-400">#{run.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  {run.skip_reason && <span className="text-[10px] text-gray-400">{run.skip_reason}</span>}
                  <Badge status={run.degraded_flag ? "degraded" : run.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
