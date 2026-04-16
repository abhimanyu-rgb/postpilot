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
}

export default function EditCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const id = params.id as string;

  useEffect(() => {
    api
      .get<Campaign>(`/api/campaigns/${id}`)
      .then(setCampaign)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(data: CampaignFormData) {
    setSaving(true);
    try {
      await api.put(`/api/campaigns/${id}`, data);
      router.push(`/campaigns/${id}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !campaign) {
    return (
      <div className="p-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  let topics: string[] = [];
  let sources: string[] = [];
  try {
    topics = JSON.parse(campaign.topics_json);
  } catch {
    /* empty */
  }
  try {
    sources = JSON.parse(campaign.source_preferences_json);
  } catch {
    /* empty */
  }

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
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Edit Campaign</h1>
      <CampaignForm
        initial={initial}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
        loading={saving}
      />
    </div>
  );
}
