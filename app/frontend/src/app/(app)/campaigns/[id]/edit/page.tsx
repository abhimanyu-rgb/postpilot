"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import CampaignForm, { CampaignFormData } from "../../components/CampaignForm";

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
  custom_rss_feeds_json: string | null;
}

export default function EditCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = params.id as string;

  useEffect(() => {
    api.get<Campaign>(`/api/campaigns/${id}`).then(setCampaign).finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(data: CampaignFormData) {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/campaigns/${id}`, data);
      router.push(`/campaigns/${id}`);
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setError(err?.body?.detail || err?.message || "Failed to save changes");
      setSaving(false);
    }
  }

  if (loading || !campaign) {
    return (<div className="p-6"><div className="animate-pulse space-y-3"><div className="h-6 w-40 bg-gray-200 rounded" /><div className="h-32 bg-gray-100 rounded-xl" /></div></div>);
  }

  let topics: string[] = [];
  let sources: string[] = [];
  let customFeeds: string[] = [];
  try { topics = JSON.parse(campaign.topics_json); } catch { /* safe */ }
  try { sources = JSON.parse(campaign.source_preferences_json); } catch { /* safe */ }
  try { if (campaign.custom_rss_feeds_json) customFeeds = JSON.parse(campaign.custom_rss_feeds_json); } catch { /* safe */ }

  const initial: Partial<CampaignFormData> = {
    name: campaign.name,
    topics_json: topics,
    persona: campaign.persona,
    tone: campaign.tone,
    frequency: campaign.frequency,
    posting_window_start: campaign.posting_window_start || "09:00",
    posting_window_end: campaign.posting_window_end || "18:00",
    significance_threshold: campaign.significance_threshold,
    source_preferences_json: sources,
    novelty_cooldown_days: campaign.novelty_cooldown_days,
    profile_adherence_override: campaign.profile_adherence_override || "",
    custom_rss_feeds_json: customFeeds,
  };

  return (
    <div className="p-6 max-w-[900px]">
      <button onClick={() => router.push(`/campaigns/${id}`)} className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Back
      </button>
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Edit Campaign</h1>
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 mb-4 text-xs text-rose-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600 ml-2">x</button>
        </div>
      )}
      <CampaignForm initial={initial} onSubmit={handleSubmit} submitLabel="Save Changes" loading={saving} />
    </div>
  );
}
