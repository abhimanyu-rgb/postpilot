"use client";

import { FormEvent, useState } from "react";

export interface CampaignFormData {
  name: string;
  topics_json: string[];
  persona: string;
  tone: string;
  frequency: string;
  posting_window_start: string;
  posting_window_end: string;
  significance_threshold: number;
  source_preferences_json: string[];
  novelty_cooldown_days: number;
  profile_adherence_override: string;
  custom_rss_feeds_json: string[];
}

const SOURCE_OPTIONS = ["news", "rss", "reddit", "hackernews"];
const TONE_OPTIONS = ["professional", "conversational", "thought-leader", "casual", "analytical"];

interface Props {
  initial?: Partial<CampaignFormData>;
  onSubmit: (data: CampaignFormData) => Promise<void>;
  submitLabel: string;
  loading?: boolean;
}

export default function CampaignForm({ initial, onSubmit, submitLabel, loading }: Props) {
  const [name, setName] = useState(initial?.name || "");
  const [topicsText, setTopicsText] = useState(initial?.topics_json?.join(", ") || "");
  const [persona, setPersona] = useState(initial?.persona || "");
  const [tone, setTone] = useState(initial?.tone || "professional");
  const [frequency, setFrequency] = useState(initial?.frequency || "daily");
  const [windowStart, setWindowStart] = useState(initial?.posting_window_start || "09:00");
  const [windowEnd, setWindowEnd] = useState(initial?.posting_window_end || "18:00");
  const [threshold, setThreshold] = useState(initial?.significance_threshold ?? 0.5);
  const [sources, setSources] = useState<string[]>(initial?.source_preferences_json || ["news"]);
  const [cooldown, setCooldown] = useState(initial?.novelty_cooldown_days ?? 3);
  const [adherence, setAdherence] = useState(initial?.profile_adherence_override || "");
  const [customFeeds, setCustomFeeds] = useState(initial?.custom_rss_feeds_json?.join("\n") || "");
  const [error, setError] = useState<string | null>(null);

  function toggleSource(src: string) {
    setSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const topics = topicsText.split(",").map((t) => t.trim()).filter(Boolean);
    if (topics.length === 0) {
      setError("At least one topic is required");
      return;
    }
    if (sources.length === 0) {
      setError("At least one source must be enabled");
      return;
    }
    try {
      await onSubmit({
        name,
        topics_json: topics,
        persona,
        tone,
        frequency,
        posting_window_start: windowStart,
        posting_window_end: windowEnd,
        significance_threshold: threshold,
        source_preferences_json: sources,
        novelty_cooldown_days: cooldown,
        profile_adherence_override: adherence || "",
        custom_rss_feeds_json: customFeeds.split("\n").map((f) => f.trim()).filter(Boolean),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save campaign");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {/* Basics */}
      <Section title="Basics">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Campaign Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            placeholder="e.g. AI Leadership Insights"
            required
          />
        </div>
      </Section>

      {/* Topics */}
      <Section title="Topics & Angle">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Topics</label>
          <input
            type="text"
            value={topicsText}
            onChange={(e) => setTopicsText(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            placeholder="AI, SaaS, product management"
            required
          />
          <p className="text-xs text-gray-400 mt-1">Separate multiple topics with commas</p>
        </div>
      </Section>

      {/* Persona & Tone */}
      <Section title="Persona & Tone">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Persona</label>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-none"
            placeholder="e.g. Senior product leader sharing insights on building AI products"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Tone</label>
          <div className="flex flex-wrap gap-2">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                  tone === t
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Schedule */}
      <Section title="Schedule">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 bg-white"
            >
              <option value="daily">Daily</option>
              <option value="weekday">Weekdays</option>
              <option value="3_to_4_per_week">3-4 per week</option>
              <option value="2_to_3_per_week">2-3 per week</option>
              <option value="1_to_2_per_week">1-2 per week</option>
              <option value="opportunistic">Opportunistic</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Window Start</label>
            <input
              type="time"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Window End</label>
            <input
              type="time"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
      </Section>

      {/* Sources */}
      <Section title="Source Preferences">
        <div className="flex flex-wrap gap-2">
          {SOURCE_OPTIONS.map((src) => (
            <button
              key={src}
              type="button"
              onClick={() => toggleSource(src)}
              className={`rounded-lg px-3.5 py-2 text-xs font-medium border flex items-center gap-1.5 ${
                sources.includes(src)
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${sources.includes(src) ? "bg-indigo-500" : "bg-gray-300"}`} />
              {src.replace("_", " ")}
            </button>
          ))}
        </div>
        {sources.includes("rss") && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Custom RSS Feeds
              <span className="text-[10px] text-gray-400 font-normal ml-2">Optional. One URL per line. Added alongside default feeds.</span>
            </label>
            <textarea
              value={customFeeds}
              onChange={(e) => setCustomFeeds(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-xs font-mono focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-y"
              placeholder={"https://example.com/feed.xml\nhttps://blog.example.com/rss"}
            />
          </div>
        )}
      </Section>

      {/* Thresholds */}
      <Section title="Quality Controls">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Significance Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="flex-1 accent-indigo-600"
              />
              <span className="text-sm font-mono text-indigo-600 w-10 text-right">{threshold.toFixed(2)}</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Higher = more selective</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Novelty Cooldown</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                value={cooldown}
                onChange={(e) => setCooldown(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <span className="text-sm text-gray-400 shrink-0">days</span>
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Profile Adherence</label>
          <div className="flex gap-2">
            {["", "low", "medium", "high"].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setAdherence(val)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium border ${
                  adherence === val
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                }`}
              >
                {val || "Default"}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center gap-2"
      >
        {loading && <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
        {loading ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5 space-y-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}
