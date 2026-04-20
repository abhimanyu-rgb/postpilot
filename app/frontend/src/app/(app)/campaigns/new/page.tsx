"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import CampaignForm, { CampaignFormData } from "../components/CampaignForm";

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(data: CampaignFormData) {
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/campaigns/", data);
      router.push("/campaigns");
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setError(err?.body?.detail || err?.message || "Failed to create campaign");
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-[900px]">
      <h1 className="text-xl font-semibold text-gray-900 mb-4">New Campaign</h1>
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 mb-4 text-xs text-rose-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600 ml-2">x</button>
        </div>
      )}
      <CampaignForm onSubmit={handleSubmit} submitLabel="Create Campaign" loading={loading} />
    </div>
  );
}
