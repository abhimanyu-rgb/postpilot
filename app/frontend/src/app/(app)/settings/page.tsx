"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSetupStatus } from "@/hooks/useSetupStatus";

interface EnvConfig {
  linkedin: {
    client_id: { set: boolean; preview: string };
    client_secret: { set: boolean; preview: string };
    access_token: { set: boolean; preview: string };
    person_urn: { set: boolean; preview: string };
    redirect_uri: string;
  };
  anthropic: { api_key: { set: boolean; preview: string } };
  slack: { webhook_url: { set: boolean; preview: string } };
  news: { api_key: { set: boolean; preview: string } };
  app: {
    database_url: string;
    timezone: string;
    daily_post_budget: number;
    min_gap_minutes: number;
  };
}

interface PersonalityProfile {
  author_name: string;
  personality_prompt: string;
  content_guardrails: string;
  is_default: boolean;
}

export default function SettingsPage() {
  const { status, loading, refresh } = useSetupStatus();
  const [envConfig, setEnvConfig] = useState<EnvConfig | null>(null);
  const [timezone, setTimezone] = useState("");
  const [dailyBudget, setDailyBudget] = useState(1);
  const [minGap, setMinGap] = useState(180);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);

  // Personality profile
  const [profile, setProfile] = useState<PersonalityProfile | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [personalityPrompt, setPersonalityPrompt] = useState("");
  const [contentGuardrails, setContentGuardrails] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    api.get<EnvConfig>("/api/setup/env-config").then(setEnvConfig).catch(() => {});
    api.get<PersonalityProfile>("/api/setup/personality").then((p) => {
      setProfile(p);
      setAuthorName(p.author_name);
      setPersonalityPrompt(p.personality_prompt);
      setContentGuardrails(p.content_guardrails);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (status) {
      setTimezone(status.timezone || "Asia/Kolkata");
      setDailyBudget(status.daily_post_budget);
      setMinGap(status.min_gap_minutes);
    }
  }, [status]);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put("/api/setup/settings", {
        timezone,
        daily_post_budget: dailyBudget,
        min_gap_minutes: minGap,
      });
      setSaved(true);
      refresh();
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    setValidating(true);
    setValidated(false);
    try {
      await api.post("/api/setup/validate-env");
      await refresh();
      const updated = await api.get<EnvConfig>("/api/setup/env-config");
      setEnvConfig(updated);
      setValidated(true);
      setTimeout(() => setValidated(false), 3000);
    } catch {
      /* empty */
    } finally {
      setValidating(false);
    }
  }

  async function handleSaveProfile() {
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      await api.put("/api/setup/personality", {
        author_name: authorName,
        personality_prompt: personalityPrompt,
        content_guardrails: contentGuardrails,
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch {
      /* empty */
    } finally {
      setSavingProfile(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-200 rounded-lg" />
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Configure this app for your account. All credentials are stored locally in your <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded font-mono">.env</code> file.</p>

      {/* Quick start guide for new users */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5 mb-6">
        <h3 className="text-sm font-semibold text-indigo-900 mb-2 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          New user? Here&apos;s how to set up
        </h3>
        <ol className="text-xs text-indigo-800 space-y-1.5 list-decimal list-inside">
          <li>Copy <code className="bg-indigo-100 px-1 rounded">.env.example</code> to <code className="bg-indigo-100 px-1 rounded">.env</code> in the project root</li>
          <li>Get an <strong>Anthropic API key</strong> from <span className="underline">console.anthropic.com</span> and add it</li>
          <li>Create a <strong>LinkedIn Developer App</strong> at <span className="underline">linkedin.com/developers/apps</span></li>
          <li>Add your Client ID + Secret to <code className="bg-indigo-100 px-1 rounded">.env</code>, then click &quot;Connect LinkedIn&quot; below</li>
          <li>Restart the server, then click &quot;Validate All&quot; to confirm connections</li>
        </ol>
      </div>

      {/* Integration status + configuration */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Integrations</h2>
          <div className="flex items-center gap-2">
            {validated && (
              <span className="text-xs text-emerald-600 flex items-center gap-1 animate-fade-in">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Validated
              </span>
            )}
            <button
              onClick={handleValidate}
              disabled={validating}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
            >
              {validating ? (
                <><div className="animate-spin w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full" /> Validating...</>
              ) : "Validate All"}
            </button>
          </div>
        </div>

        <div className="divide-y divide-gray-50">
          {/* LinkedIn */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${status?.linkedin_status === "connected" ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">LinkedIn</p>
                  <p className="text-xs text-gray-400 capitalize">{status?.linkedin_status?.replace("_", " ") || "not configured"}</p>
                </div>
              </div>
              {envConfig?.linkedin.client_id.set && !envConfig?.linkedin.access_token.set && (
                <a
                  href="http://localhost:8000/api/auth/linkedin"
                  className="rounded-lg bg-[#0A66C2] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#004182] shadow-sm flex items-center gap-1.5"
                >
                  Connect LinkedIn
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 ml-12">
              <EnvKeyStatus label="Client ID" status={envConfig?.linkedin.client_id} envKey="LINKEDIN_CLIENT_ID" />
              <EnvKeyStatus label="Client Secret" status={envConfig?.linkedin.client_secret} envKey="LINKEDIN_CLIENT_SECRET" />
              <EnvKeyStatus label="Access Token" status={envConfig?.linkedin.access_token} envKey="auto via OAuth" />
              <EnvKeyStatus label="Person URN" status={envConfig?.linkedin.person_urn} envKey="auto via OAuth" />
            </div>
            {envConfig && (
              <p className="text-[10px] text-gray-400 mt-2 ml-12">
                Callback URL: <code className="bg-gray-50 px-1 rounded">{envConfig.linkedin.redirect_uri}</code>
              </p>
            )}
          </div>

          {/* Anthropic */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${status?.llm_status === "connected" ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Anthropic (Claude)</p>
                <p className="text-xs text-gray-400 capitalize">{status?.llm_status?.replace("_", " ") || "not configured"}</p>
              </div>
            </div>
            <div className="ml-12">
              <EnvKeyStatus label="API Key" status={envConfig?.anthropic.api_key} envKey="ANTHROPIC_API_KEY" />
            </div>
          </div>

          {/* News API */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${envConfig?.news.api_key.set ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400"}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">News API <span className="text-[10px] text-gray-400">(optional — falls back to RSS)</span></p>
                <p className="text-xs text-gray-400">{envConfig?.news.api_key.set ? "Configured" : "Using free RSS/Reddit/HN sources"}</p>
              </div>
            </div>
            <div className="ml-12">
              <EnvKeyStatus label="API Key" status={envConfig?.news.api_key} envKey="NEWS_API_KEY" />
            </div>
          </div>
        </div>
      </div>

      {/* Personality Profile */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Writing Personality</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Defines your voice, style, and guardrails for all AI-generated content
            </p>
          </div>
          {profile?.is_default && (
            <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md">Using defaults</span>
          )}
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Author Name</label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              placeholder="Your name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Voice & Style Profile
              <span className="text-[10px] text-gray-400 font-normal ml-2">Injected into every AI prompt</span>
            </label>
            <textarea
              value={personalityPrompt}
              onChange={(e) => setPersonalityPrompt(e.target.value)}
              rows={12}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-y leading-relaxed"
              placeholder={"## Author Personality Profile\n\nVoice:\n- Clear and direct\n- Professional but human\n...\n\nPreferred hooks:\n- Bold claim\n- Contrarian take\n...\n\nAvoid:\n- Generic AI enthusiasm\n- Soft openings"}
            />
            <p className="text-[10px] text-gray-400 mt-1">{personalityPrompt.length} chars. Describes your archetype, voice, hooks, structure, and what to avoid.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Content Guardrails
              <span className="text-[10px] text-gray-400 font-normal ml-2">Strict rules that override all style guidance</span>
            </label>
            <textarea
              value={contentGuardrails}
              onChange={(e) => setContentGuardrails(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-y leading-relaxed"
              placeholder={"## Content Guardrails\n\nNEVER use:\n- Em dashes\n- Generic AI openings\n...\n\nALWAYS:\n- Use commas instead of dashes\n- Start with the insight"}
            />
            <p className="text-[10px] text-gray-400 mt-1">{contentGuardrails.length} chars. Patterns to avoid in generated content (e.g., no em dashes, no hype language).</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center gap-2"
            >
              {savingProfile && <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
            {profileSaved && (
              <span className="text-xs text-emerald-600 flex items-center gap-1 animate-fade-in">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                Profile saved. Active on next run.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* .env reference */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">.env File Reference</h2>
        </div>
        <div className="p-5">
          <pre className="text-[11px] text-gray-600 font-mono leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-4 border border-gray-100">{`# Required
ANTHROPIC_API_KEY=sk-ant-...

# LinkedIn OAuth (from Developer Portal > Auth tab)
LINKEDIN_CLIENT_ID=your-app-id
LINKEDIN_CLIENT_SECRET=your-app-secret
LINKEDIN_REDIRECT_URI=http://localhost:8000/api/auth/linkedin/callback

# Optional
NEWS_API_KEY=your-newsapi-key
DATABASE_URL=sqlite:///data/app.db
TIMEZONE=Asia/Kolkata`}</pre>
          <p className="text-[10px] text-gray-400 mt-2">
            Or use the CLI: <code className="bg-gray-50 px-1 rounded">python scripts/set_secret.py ANTHROPIC_API_KEY</code>
          </p>
        </div>
      </div>

      {/* Account preferences */}
      <form onSubmit={handleSaveSettings} className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Posting Preferences</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white">
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="America/Chicago">America/Chicago (CST)</option>
              <option value="America/Denver">America/Denver (MST)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Europe/Berlin">Europe/Berlin (CET)</option>
              <option value="Europe/Paris">Europe/Paris (CET)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
              <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
              <option value="Pacific/Auckland">Pacific/Auckland (NZST)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Daily Post Budget</label>
              <select value={dailyBudget} onChange={(e) => setDailyBudget(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white">
                {[1, 2, 3, 4, 5].map((n) => (<option key={n} value={n}>{n} post{n > 1 ? "s" : ""} / day</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Min Gap Between Posts</label>
              <select value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white">
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={180}>3 hours</option>
                <option value={360}>6 hours</option>
                <option value={720}>12 hours</option>
                <option value={1440}>24 hours</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2.5 text-sm text-rose-700">{error}</div>
          )}
          {saved && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-sm text-emerald-700 flex items-center gap-2 animate-fade-in">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              Settings saved
            </div>
          )}
          <button type="submit" disabled={saving} className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center gap-2">
            {saving && <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>

      {/* Database info */}
      {envConfig && (
        <div className="mt-6 text-[10px] text-gray-300 flex items-center gap-2">
          <span>DB: {envConfig.app.database_url}</span>
          <span>|</span>
          <span>PostPilot v1.0</span>
        </div>
      )}
    </div>
  );
}

function EnvKeyStatus({
  label,
  status,
  envKey,
}: {
  label: string;
  status?: { set: boolean; preview: string };
  envKey: string;
}) {
  if (!status) return null;
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${status.set ? "bg-emerald-500" : "bg-gray-300"}`} />
        <span className="text-[11px] text-gray-600">{label}</span>
      </div>
      {status.set ? (
        <code className="text-[10px] text-gray-400 font-mono">{status.preview}</code>
      ) : (
        <code className="text-[10px] text-gray-400 font-mono">{envKey}</code>
      )}
    </div>
  );
}
