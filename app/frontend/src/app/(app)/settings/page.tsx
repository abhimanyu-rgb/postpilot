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

interface EvolutionEntry {
  date: string;
  feedback_count: number;
  summary: string;
  suggestions: { area: string; current: string; suggested: string; reason: string }[];
}

interface PersonalityProfile { author_name: string; personality_prompt: string; content_guardrails: string; learned_context: string; is_default: boolean; evolution_suggestions: EvolutionEntry[]; }

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
  const [maxActiveCampaigns, setMaxActiveCampaigns] = useState(3);
  const [linkedinHandle, setLinkedinHandle] = useState("");
  const [evolutionMinFeedbacks, setEvolutionMinFeedbacks] = useState(5);
  const [evolutionMinSnapshots, setEvolutionMinSnapshots] = useState(4);
  const [savingMemory, setSavingMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [learnedContext, setLearnedContext] = useState("");
  const [editingLearned, setEditingLearned] = useState(false);
  const [savingLearned, setSavingLearned] = useState(false);
  const [learnedSaved, setLearnedSaved] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<EnvConfig>("/api/setup/env-config").then(setEnvConfig).catch(() => {});
    api.get<PersonalityProfile>("/api/setup/personality").then((p) => {
      setProfile(p); setAuthorName(p.author_name); setPersonalityPrompt(p.personality_prompt); setContentGuardrails(p.content_guardrails); setLearnedContext(p.learned_context || "");
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (status) {
      setTimezone(status.timezone || "UTC"); setDailyBudget(status.daily_post_budget); setMinGap(status.min_gap_minutes); setMaxActiveCampaigns(status.max_active_campaigns ?? 3); setLinkedinHandle(status.linkedin_profile_handle || "");
      setEvolutionMinFeedbacks(status.evolution_min_feedbacks ?? 5);
      setEvolutionMinSnapshots(status.evolution_min_snapshots ?? 4);
      setEditingPrefs(!status.setup_complete);
    }
  }, [status]);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError(null); setSaved(false);
    try { await api.put("/api/setup/settings", { timezone, daily_post_budget: dailyBudget, min_gap_minutes: minGap, max_active_campaigns: maxActiveCampaigns, linkedin_profile_handle: linkedinHandle.trim() || null, evolution_min_feedbacks: evolutionMinFeedbacks, evolution_min_snapshots: evolutionMinSnapshots }); setSaved(true); setEditingPrefs(false); refresh(); setTimeout(() => setSaved(false), 3000); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function handleSaveProfile() {
    setSavingProfile(true); setProfileSaved(false);
    try { await api.put("/api/setup/personality", { author_name: authorName, personality_prompt: personalityPrompt, content_guardrails: contentGuardrails }); setProfileSaved(true); setEditingProfile(false); setTimeout(() => setProfileSaved(false), 3000); }
    catch (e) { alert(e instanceof Error ? e.message : "Save failed"); } finally { setSavingProfile(false); }
  }

  async function handleValidate() {
    setValidating(true); setValidated(false);
    try { await api.post("/api/setup/validate-env"); await refresh(); const u = await api.get<EnvConfig>("/api/setup/env-config"); setEnvConfig(u); setValidated(true); setTimeout(() => setValidated(false), 3000); }
    catch (e) { alert(e instanceof Error ? e.message : "Validation failed"); } finally { setValidating(false); }
  }

  async function handleSaveMemory() {
    if (!status) return;
    setSavingMemory(true); setMemoryError(null); setMemorySaved(false);
    try {
      await api.put("/api/setup/settings", {
        timezone, daily_post_budget: dailyBudget, min_gap_minutes: minGap,
        max_active_campaigns: maxActiveCampaigns,
        linkedin_profile_handle: linkedinHandle.trim() || null,
        evolution_min_feedbacks: evolutionMinFeedbacks,
        evolution_min_snapshots: evolutionMinSnapshots,
      });
      setMemorySaved(true); refresh();
      setTimeout(() => setMemorySaved(false), 3000);
    } catch (e) { setMemoryError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSavingMemory(false); }
  }

  async function handleSaveLearned() {
    setSavingLearned(true); setLearnedSaved(false);
    try { await api.put("/api/setup/personality/learned", { learned_context: learnedContext }); setLearnedSaved(true); setEditingLearned(false); setTimeout(() => setLearnedSaved(false), 3000); }
    catch (e) { alert(e instanceof Error ? e.message : "Save failed"); } finally { setSavingLearned(false); }
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
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Max Active Campaigns</label>
                <select value={maxActiveCampaigns} onChange={(e) => setMaxActiveCampaigns(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 bg-white">
                  {[1,2,3,4,5,6,7,8,10,15,20].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <p className="text-[9px] text-gray-400 mt-1">Cap on campaigns in active status at once. Raise to run more in parallel.</p>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">LinkedIn Profile Handle</label>
                <input
                  type="text"
                  value={linkedinHandle}
                  onChange={(e) => setLinkedinHandle(e.target.value)}
                  placeholder="e.g. yourname or paste your full profile URL"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                />
                <p className="text-[9px] text-gray-400 mt-1">The <span className="font-mono">{`<handle>`}</span> in <span className="font-mono">linkedin.com/in/&lt;handle&gt;</span>. Used by Analytics to scrape weekly engagement on your posts.</p>
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
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-[10px] text-gray-400">Timezone</p><p className="text-xs font-medium text-gray-700">{timezone}</p></div>
                <div><p className="text-[10px] text-gray-400">Budget</p><p className="text-xs font-medium text-gray-700">{dailyBudget}/day</p></div>
                <div><p className="text-[10px] text-gray-400">Min Gap</p><p className="text-xs font-medium text-gray-700">{minGap}m</p></div>
                <div><p className="text-[10px] text-gray-400">Max Active Campaigns</p><p className="text-xs font-medium text-gray-700">{maxActiveCampaigns}</p></div>
                <div className="col-span-2"><p className="text-[10px] text-gray-400">LinkedIn Profile Handle</p><p className="text-xs font-medium text-gray-700 font-mono">{linkedinHandle ? `linkedin.com/in/${linkedinHandle}` : <span className="text-rose-500 not-italic font-sans">Not set — Analytics won&rsquo;t work</span>}</p></div>
              </div>
              {saved && <p className="text-[10px] text-emerald-600 mt-2 animate-fade-in">Saved</p>}
            </div>
          )}
        </div>
      </div>

      {/* Memory & Learning — thresholds for when engagement/feedback shapes the personality */}
      <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm mb-4">
        <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Memory & Learning</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">When does PostPilot start learning from your manual feedback and post engagement?</p>
          </div>
          <div className="flex items-center gap-2">
            {memorySaved && <span className="text-[10px] text-emerald-600 animate-fade-in">Saved</span>}
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Min Manual Feedbacks</label>
              <input type="number" min={2} max={50} value={evolutionMinFeedbacks}
                onChange={(e) => setEvolutionMinFeedbacks(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" />
              <p className="text-[9px] text-gray-400 mt-1">Personality evolution fires once you&rsquo;ve rated at least this many posts. Lower = faster learning, more noise.</p>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-1">Min Engagement Snapshots</label>
              <input type="number" min={2} max={50} value={evolutionMinSnapshots}
                onChange={(e) => setEvolutionMinSnapshots(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" />
              <p className="text-[9px] text-gray-400 mt-1">Engagement-based learning fires after this many weekly scrapes. Same threshold gates the &ldquo;top quartile&rdquo; marker in Analytics.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={handleSaveMemory} disabled={savingMemory}
              className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3.5 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm">
              {savingMemory ? "Saving..." : "Save thresholds"}
            </button>
            {memoryError && <p className="text-[10px] text-rose-600">{memoryError}</p>}
          </div>
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

      {/* Learned Context — separate from personality, system-generated + user-editable */}
      <div className="rounded-xl border border-amber-200/50 bg-amber-50/10 shadow-sm mb-4">
        <div className="px-4 py-3 border-b border-amber-100/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            <div>
              <h2 className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Learned Context</h2>
              <p className="text-[9px] text-amber-600">Auto-generated from feedback. Editable. Merged with personality at prompt time.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {learnedSaved && <span className="text-[10px] text-emerald-600 animate-fade-in">Saved</span>}
            {!editingLearned && <button onClick={() => setEditingLearned(true)} className="text-[10px] font-medium text-amber-700 hover:text-amber-800">Edit</button>}
          </div>
        </div>
        {editingLearned ? (
          <div className="p-4 space-y-2">
            <textarea
              value={learnedContext}
              onChange={(e) => setLearnedContext(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-amber-200 px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-500/20 resize-y leading-relaxed bg-white"
              placeholder={"Lines auto-added from feedback analysis:\n- [hooks] Use system-level challenges (learned: 4/5 top posts used this)\n- [structure] Old vs new contrast framing works (learned: 80% approval rate)\n\nYou can edit, remove, or add your own observations here."}
            />
            <div className="flex items-center gap-2">
              <button onClick={handleSaveLearned} disabled={savingLearned}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 shadow-sm">
                {savingLearned ? "Saving..." : "Save Learnings"}
              </button>
              <button onClick={() => setEditingLearned(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="p-4">
            {learnedContext ? (
              <div className="rounded-lg bg-white border border-amber-100 p-2.5 max-h-28 overflow-hidden">
                <p className="text-[10px] text-gray-700 font-mono whitespace-pre-wrap leading-relaxed">{learnedContext.slice(0, 300)}{learnedContext.length > 300 ? "..." : ""}</p>
              </div>
            ) : (
              <p className="text-[10px] text-amber-600 italic">No learnings yet. Learnings auto-populate after 10 post feedbacks.</p>
            )}
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
