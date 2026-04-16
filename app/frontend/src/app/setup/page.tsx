"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { api } from "@/lib/api";

interface LinkedInOAuthStatus {
  oauth_configured: boolean;
  token_present: boolean;
  client_id_set: boolean;
  client_secret_set: boolean;
}

interface ValidationResult {
  linkedin: { status: string; message: string };
  slack: { status: string; message: string };
  llm: { status: string; message: string };
}

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, loading, refresh } = useSetupStatus();

  const [linkedinOAuth, setLinkedinOAuth] = useState<LinkedInOAuthStatus | null>(null);
  const [validating, setValidating] = useState(false);
  const [results, setResults] = useState<ValidationResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [dailyBudget, setDailyBudget] = useState(1);
  const [minGap, setMinGap] = useState(180);
  const [settingsSaved, setSettingsSaved] = useState(false);

  // Check for OAuth callback params
  const oauthLinkedinStatus = searchParams.get("linkedin");
  const oauthName = searchParams.get("name");
  const oauthError = searchParams.get("error");

  useEffect(() => {
    api.get<LinkedInOAuthStatus>("/api/auth/linkedin/status").then(setLinkedinOAuth).catch(() => {});
  }, []);

  // Auto-refresh status after OAuth callback
  useEffect(() => {
    if (oauthLinkedinStatus === "connected") {
      refresh();
    }
  }, [oauthLinkedinStatus, refresh]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#faf8ff] to-violet-50/30">
        <div className="animate-spin w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (status?.setup_complete && !showSettings) {
    router.push("/dashboard");
    return null;
  }

  async function handleValidateOthers() {
    setValidating(true);
    setResults(null);
    try {
      const res = await api.post<ValidationResult>("/api/setup/validate-env");
      setResults(res);
      await refresh();
    } catch {
      /* empty */
    } finally {
      setValidating(false);
    }
  }

  async function handleSaveSettings() {
    try {
      await api.put("/api/setup/settings", {
        timezone,
        daily_post_budget: dailyBudget,
        min_gap_minutes: minGap,
      });
      setSettingsSaved(true);
      await refresh();
      setTimeout(() => router.push("/dashboard"), 1000);
    } catch {
      /* empty */
    }
  }

  const linkedinConnected = status?.linkedin_status === "connected" || oauthLinkedinStatus === "connected";
  const llmConnected = status?.llm_status === "connected" || results?.llm?.status === "connected";
  const slackStatus = results?.slack?.status || status?.slack_status || "not_configured";
  const allRequired = llmConnected;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#faf8ff] to-violet-50/30 px-4 py-8">
      <div className="w-full max-w-lg">
        <div className="rounded-2xl bg-white shadow-lg border border-gray-200/60 overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-5">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm">
                <svg className="w-[18px] h-[18px] text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                </svg>
              </div>
              <h1 className="text-lg font-bold text-gray-900 tracking-tight">PostPilot</h1>
            </div>
            <p className="text-sm text-gray-500 mt-2">Connect your integrations to get started.</p>
          </div>

          <div className="h-px bg-gray-100" />

          {/* OAuth error banner */}
          {oauthError && (
            <div className="mx-8 mt-5 rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 flex items-start gap-2.5">
              <svg className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-rose-700">{decodeURIComponent(oauthError)}</p>
            </div>
          )}

          {/* OAuth success banner */}
          {oauthLinkedinStatus === "connected" && (
            <div className="mx-8 mt-5 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2.5 animate-fade-in">
              <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-emerald-700">
                LinkedIn connected{oauthName ? ` as ${decodeURIComponent(oauthName)}` : ""}!
              </p>
            </div>
          )}

          <div className="px-8 py-5 space-y-3">
            {/* 1. LinkedIn — OAuth button */}
            <IntegrationCard
              label="LinkedIn"
              description={
                linkedinConnected
                  ? `Connected${oauthName ? ` as ${decodeURIComponent(oauthName)}` : ""}`
                  : linkedinOAuth?.oauth_configured
                  ? "Click to connect via LinkedIn"
                  : "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in .env first"
              }
              status={linkedinConnected ? "connected" : "not_configured"}
              required
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              }
              action={
                !linkedinConnected && linkedinOAuth?.oauth_configured ? (
                  <a
                    href="http://localhost:8000/api/auth/linkedin"
                    className="rounded-lg bg-[#0A66C2] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#004182] shadow-sm flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                    Connect LinkedIn
                  </a>
                ) : !linkedinConnected ? (
                  <span className="text-[11px] text-gray-400">OAuth not configured</span>
                ) : null
              }
            />

            {/* 2. Anthropic — .env key */}
            <IntegrationCard
              label="Anthropic (Claude)"
              description={
                llmConnected
                  ? "API key validated"
                  : "Set ANTHROPIC_API_KEY in .env"
              }
              status={llmConnected ? "connected" : results?.llm?.status === "invalid" ? "invalid" : "not_configured"}
              required
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              }
              action={
                !llmConnected ? (
                  <code className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded font-mono">
                    .env
                  </code>
                ) : null
              }
            />

          </div>

          {/* .env hint for API keys */}
          {(!llmConnected || (!linkedinConnected && !linkedinOAuth?.oauth_configured)) && (
            <>
              <div className="h-px bg-gray-100" />
              <div className="px-8 py-4">
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3.5">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Your .env file</p>
                  <pre className="text-[11px] text-gray-600 font-mono leading-relaxed whitespace-pre-wrap">{`ANTHROPIC_API_KEY=sk-ant-...${!linkedinOAuth?.oauth_configured ? `
LINKEDIN_CLIENT_ID=your-app-client-id
LINKEDIN_CLIENT_SECRET=your-app-secret` : ""}
NEWS_API_KEY=...  # optional, falls back to free RSS`}</pre>
                  <p className="text-[10px] text-gray-400 mt-2">
                    Or run: <code className="bg-gray-100 px-1 rounded">python scripts/set_secret.py ANTHROPIC_API_KEY</code>
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Validate button */}
          {!allRequired && (
            <>
              <div className="h-px bg-gray-100" />
              <div className="px-8 py-5">
                <button
                  onClick={handleValidateOthers}
                  disabled={validating}
                  className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
                >
                  {validating ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Validate Connections
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {/* All connected — show settings */}
          {allRequired && !showSettings && (
            <div className="px-8 py-5 animate-fade-in">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3.5 mb-4 flex items-center gap-2.5">
                <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-emerald-700 font-medium">All required connections validated!</p>
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm"
              >
                Configure Account Settings
              </button>
            </div>
          )}

          {allRequired && showSettings && (
            <div className="px-8 py-5 animate-fade-in space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Account Settings</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white">
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                  <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Daily Budget</label>
                  <select value={dailyBudget} onChange={(e) => setDailyBudget(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white">
                    {[1, 2, 3, 4, 5].map((n) => (<option key={n} value={n}>{n} post{n > 1 ? "s" : ""}/day</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Min Gap</label>
                  <select value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white">
                    <option value={30}>30 min</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={180}>3 hours</option>
                    <option value={360}>6 hours</option>
                  </select>
                </div>
              </div>
              {settingsSaved ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center animate-scale-in">
                  <p className="text-sm text-emerald-700 font-medium">All set! Redirecting...</p>
                </div>
              ) : (
                <button onClick={handleSaveSettings} className="w-full rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm">
                  Save & Finish Setup
                </button>
              )}
            </div>
          )}
        </div>

        {/* Skip setup */}
        <div className="text-center mt-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Skip setup, explore the app first
          </button>
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  label,
  description,
  status,
  required,
  icon,
  action,
}: {
  label: string;
  description: string;
  status: string;
  required: boolean;
  icon: React.ReactNode;
  action?: React.ReactNode;
}) {
  const connected = status === "connected";
  const invalid = status === "invalid";
  return (
    <div
      className={`rounded-xl border p-4 flex items-center justify-between ${
        connected ? "border-emerald-200 bg-emerald-50/50" :
        invalid ? "border-rose-200 bg-rose-50/50" :
        "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          connected ? "bg-emerald-100 text-emerald-600" :
          invalid ? "bg-rose-100 text-rose-600" :
          "bg-gray-100 text-gray-400"
        }`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">
            {label}
            {!required && <span className="text-[10px] text-gray-400 ml-1.5">(optional)</span>}
          </p>
          <p className={`text-xs mt-0.5 truncate ${
            connected ? "text-emerald-600" : invalid ? "text-rose-600" : "text-gray-400"
          }`}>
            {description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0 ml-3">
        {action}
        <div className={`w-2.5 h-2.5 rounded-full ${
          connected ? "bg-emerald-500" : invalid ? "bg-rose-500" : "bg-gray-300"
        }`} />
      </div>
    </div>
  );
}
