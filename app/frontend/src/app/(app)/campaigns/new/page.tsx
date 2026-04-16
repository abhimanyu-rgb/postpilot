"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import CampaignForm, { CampaignFormData } from "../components/CampaignForm";

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(data: CampaignFormData) {
    setLoading(true);
    try {
      await api.post("/api/campaigns/", data);
      router.push("/campaigns");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">New Campaign</h1>
      <CampaignForm onSubmit={handleSubmit} submitLabel="Create Campaign" loading={loading} />
    </div>
  );
}
