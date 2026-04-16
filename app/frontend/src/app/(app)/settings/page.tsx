"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSetupStatus } from "@/hooks/useSetupStatus";

interface EnvConfig {
  linkedin: { client_id: { set: boolean; preview: string }; client_secret: { set: boolean; preview: string }; access_token: { set: boolean; preview: string }; person_urn: { set: boolean; preview: string }; redirect_uri: string; };
  anthropic: { api_key: { set: boolean; preview: string } };
  slack: { webhook_url: { set: boolean; preview: string } };
  news: { api_key: { set: boolean; preview: string } };
  app: { database_url: string; timezone: string; daily_post_budget: number; min_gap_minutes: number; };
}

interface PersonalityProfile { author_name: string; personality_prompt: string; content_guardrails: string; is_default: boolean; }

export default function SettingsPage() {
  const { status, loading, refresh } = useSetupStatus();
  const [envConfig, setEnvConfig] = useState<EnvConfig | null>(null);
  const [profile, setProfile] = useState<PersonalityProfile | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [personalityPrompt, setPersonalityPrompt] = useState("");
  const [contentGuardrails, setContentGuardrails] = useState("");
  const [timezone, setTimezone] = useState("");
  const [dailyBudget, setDailyBudget] = useState(1);
  const [minGap, setMinGap] = useState(180);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<EnvConfig>("/api/setup/env-config").then(setEnvConfig).catch(() => {});
    api.get<PersonalityProfile>("/api/setup/personality").then((p) => {
      setProfile(p); setAuthorName(p.author_name); setPersonalityPrompt(p.personality_prompt); setContentGuardrails(p.content_guardrails);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (status) {
      setTimezone(status.timezone || "UTC"); setDailyBudget(status.daily_post_budget); setMinGap(status.min_gap_minutes);
      setEditingPrefs(!status.setup_complete);
    }
  }, [status]);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError(null); setSaved(false);
    try { await api.put("/api/setup/settings", { timezone, daily_post_budget: dailyBudget, min_gap_minutes: minGap }); setSaved(true); setEditingPrefs(false); refresh(); setTimeout(() => setSaved(false), 3000); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function handleSaveProfile() {
    setSavingProfile(true); setProfileSaved(false);
    try { await api.put("/api/setup/personality", { author_name: authorName, personality_prompt: personalityPrompt, content_guardrails: contentGuardrails }); setProfileSaved(true); setEditingProfile(false); setTimeout(() => setProfileSaved(false), 3000); }
    catch { /* empty */ } finally { setSavingProfile(false); }
  }

  async function handleValidate() {
    setValidating(true); setValidated(false);
    try { await api.post("/api/setup/validate-env"); await refresh(); const u = await api.get<EnvConfig>("/api/setup/env-config"); setEnvConfig(u); setValidated(true); setTimeout(() => setValidated(false), 3000); }
    catch { /* empty */ } finally { setValidating(false); }
  }

  if (loading) return (<div className="p-6"><div className="animate-pulse space-y-3"><div className="h-6 w-40 bg-gray-200 rounded" /><div className="h-32 bg-gray-100 rounded-xl" /></div></div>);

  return (
    <div className="p-6 max-w-[900px]">
      <h1 className="text-xl font-semibold text-gray-900 mb-0.5">Settings</h1>
      <p className="text-xs text-gray-400 mb-5">Credentials stored locally in <code className="bg-gray-100 px-1 rounded text-[10px]">.env</code></p>

      {/* Two-column layout: Integrations + Preferences */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {/* Integrations */}
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Integrations</h2>
            <button onClick={handleValidate} disabled={validating}
              className="text-[10px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50 flex items-center gap-1">
              {validating ? <div className="animate-spin w-2.5 h-2.5 border border-violet-600 border-t-transparent rounded-full" /> : null}
              {validated ? "Done" : validating ? "Checking..." : "Validate"}
            </button>
          </div>
          <div className="divide-y divide-indigo-50/50">
            <IntRow name="LinkedIn" connected={status?.linkedin_status === "connected"}
              status={status?.linkedin_status}
              detail={
                status?.linkedin_status === "connected"
                  ? `Connected ${envConfig?.linkedin.person_urn.set ? `(${envConfig.linkedin.person_urn.preview})` : ""}`
                  : !envConfig?.linkedin.client_id.set
                  ? "Set LINKEDIN_CLIENT_ID + SECRET in .env"
                  : envConfig?.linkedin.client_id.set && !envConfig?.linkedin.access_token.set
                  ? "OAuth configured, click Connect"
                  : "Not connected"
              }
              action={
                status?.linkedin_status === "connected" ? (
                  <span className="text-[9px] text-emerald-600 font-medium">Active</span>
                ) : envConfig?.linkedin.client_id.set && !envConfig?.linkedin.access_token.set ? (
                  <a href="http://localhost:8000/api/auth/linkedin" className="rounded-md bg-[#0A66C2] px-2 py-0.5 text-[9px] font-medium text-white hover:bg-[#004182]">Connect</a>
                ) : null
              } />
            <IntRow name="Anthropic" connected={status?.llm_status === "connected"}
              status={status?.llm_status}
              detail={
                status?.llm_status === "connected"
                  ? `Validated (${envConfig?.anthropic.api_key.preview || "key set"})`
                  : status?.llm_status === "invalid"
                  ? "Key invalid, check .env"
                  : "Set ANTHROPIC_API_KEY in .env"
              } />
            <IntRow name="News API" connected={envConfig?.news.api_key.set || false}
              detail={envConfig?.news.api_key.set ? `Configured (${envConfig.news.api_key.preview})` : "Optional. Using free RSS/Reddit/HN"} />
          </div>
        </div>

        {/* Posting Preferences */}
        <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Posting Preferences</h2>
            {!editingPrefs && <button onClick={() => setEditingPrefs(true)} className="text-[10px] font-medium text-violet-600 hover:text-violet-700">Edit</button>}
          </div>
          {editingPrefs ? (
            <form onSubmit={handleSaveSettings} className="p-4 space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 bg-white">
                  {["Asia/Kolkata", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "UTC"].map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Daily Budget</label>
                  <select value={dailyBudget} onChange={(e) => setDailyBudget(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 bg-white">
                    {[1,2,3,4,5].map((n) => <option key={n} value={n}>{n}/day</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Min Gap</label>
                  <select value={minGap} onChange={(e) => setMinGap(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 bg-white">
                    {[{v:30,l:"30m"},{v:60,l:"1h"},{v:120,l:"2h"},{v:180,l:"3h"},{v:360,l:"6h"},{v:720,l:"12h"}].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={saving}
                  className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm">
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" onClick={() => setEditingPrefs(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="p-4">
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-[10px] text-gray-400">Timezone</p><p className="text-xs font-medium text-gray-700">{timezone}</p></div>
                <div><p className="text-[10px] text-gray-400">Budget</p><p className="text-xs font-medium text-gray-700">{dailyBudget}/day</p></div>
                <div><p className="text-[10px] text-gray-400">Min Gap</p><p className="text-xs font-medium text-gray-700">{minGap}m</p></div>
              </div>
              {saved && <p className="text-[10px] text-emerald-600 mt-2 animate-fade-in">Saved</p>}
            </div>
          )}
        </div>
      </div>

      {/* Writing Personality — full width */}
      <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm mb-4">
        <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Writing Personality</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">Voice, style, and guardrails for AI content</p>
          </div>
          <div className="flex items-center gap-2">
            {profile?.is_default && <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-medium">DEFAULTS</span>}
            {profileSaved && <span className="text-[10px] text-emerald-600 animate-fade-in">Saved</span>}
            {!editingProfile && <button onClick={() => setEditingProfile(true)} className="text-[10px] font-medium text-violet-600 hover:text-violet-700">Edit</button>}
          </div>
        </div>
        {editingProfile ? (
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Author Name</label>
              <input type="text" value={authorName} onChange={(e) => setAuthorName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" placeholder="Your name" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">
                  Voice & Style <span className="font-normal text-gray-400">({personalityPrompt.length} chars)</span>
                </label>
                <textarea value={personalityPrompt} onChange={(e) => setPersonalityPrompt(e.target.value)} rows={10}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 resize-y leading-relaxed"
                  placeholder="## Author Personality Profile&#10;&#10;Voice:&#10;- Clear and direct&#10;..." />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">
                  Guardrails <span className="font-normal text-gray-400">({contentGuardrails.length} chars)</span>
                </label>
                <textarea value={contentGuardrails} onChange={(e) => setContentGuardrails(e.target.value)} rows={10}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 resize-y leading-relaxed"
                  placeholder="## Content Guardrails&#10;&#10;NEVER use:&#10;- Em dashes&#10;..." />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleSaveProfile} disabled={savingProfile}
                className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm">
                {savingProfile ? "Saving..." : "Save Profile"}
              </button>
              <button onClick={() => setEditingProfile(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="mb-3">
              <p className="text-[10px] text-gray-400">Author</p>
              <p className="text-xs font-medium text-gray-700">{authorName || "Not set"}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-gray-400 mb-1">Voice & Style ({personalityPrompt.length} chars)</p>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-2.5 max-h-24 overflow-hidden">
                  <p className="text-[10px] text-gray-600 font-mono whitespace-pre-wrap leading-relaxed">{personalityPrompt.slice(0, 200)}{personalityPrompt.length > 200 ? "..." : ""}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-gray-400 mb-1">Guardrails ({contentGuardrails.length} chars)</p>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-2.5 max-h-24 overflow-hidden">
                  <p className="text-[10px] text-gray-600 font-mono whitespace-pre-wrap leading-relaxed">{contentGuardrails.slice(0, 200)}{contentGuardrails.length > 200 ? "..." : ""}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300 mt-4">PostPilot v1.0</p>
    </div>
  );
}

function IntRow({ name, connected, status, detail, action }: { name: string; connected: boolean; status?: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          connected ? "bg-emerald-500" :
          status === "invalid" ? "bg-rose-400" :
          "bg-gray-300"
        }`} />
        <div>
          <p className="text-xs font-medium text-gray-900">{name}</p>
          <p className={`text-[10px] ${status === "invalid" ? "text-rose-500" : "text-gray-400"}`}>{detail}</p>
        </div>
      </div>
      {action}
    </div>
  );
}
