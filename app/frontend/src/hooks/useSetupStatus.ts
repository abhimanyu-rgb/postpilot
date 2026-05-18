"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface SetupStatus {
  linkedin_status: string;
  slack_status: string;
  llm_status: string;
  email_status: string;
  setup_complete: boolean;
  timezone: string | null;
  daily_post_budget: number;
  min_gap_minutes: number;
  max_active_campaigns: number;
  linkedin_profile_handle: string | null;
  evolution_min_feedbacks: number;
  evolution_min_snapshots: number;
  earliest_campaign_month: string | null;
}

export function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<SetupStatus>("/api/setup/status");
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch setup status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}
