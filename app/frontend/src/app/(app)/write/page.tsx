"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function WritePage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [enrichSources, setEnrichSources] = useState(true);
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{
    id: number;
    primary_text: string;
    headline: string;
    confidence_score: number;
    grounding_summary: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!topic.trim()) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{
        id: number;
        primary_text: string;
        headline: string;
        confidence_score: number;
        grounding_summary: string;
      }>("/api/drafts/write", {
        topic: topic.trim(),
        notes: notes.trim(),
        enrich_with_sources: enrichSources,
        posting_window_start: windowStart,
        posting_window_end: windowEnd,
      });
      setResult(res);
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setError(err?.body?.detail || err?.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-6 max-w-[700px]">
      <h1 className="text-xl font-semibold text-gray-900 mb-0.5">Write a Post</h1>
      <p className="text-xs text-gray-400 mb-5">Start with your idea. AI will refine it using your voice, sources, and learnings.</p>

      {!result ? (
        <div className="space-y-4">
          {/* Topic input */}
          <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm p-4">
            <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-2">What do you want to write about?</label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 resize-none"
              placeholder="e.g. Why most companies are using AI to fix broken workflows instead of redesigning them"
              autoFocus
            />
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm p-4">
            <label className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold block mb-2">
              Additional notes <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 resize-none"
              placeholder="Key points, a personal angle, specific data, or a take you want to include..."
            />
          </div>

          {/* Options */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enrichSources}
                onChange={(e) => setEnrichSources(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-600">Enrich with recent news and sources</span>
            </label>
          </div>

          {/* Posting window (locked after generate) */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Posting window</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
                className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="time"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
                className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <span className="text-[11px] text-gray-400 ml-1">Auto-publishes in this window (FIFO with campaigns). Locked after generation.</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || !topic.trim()}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-3 text-sm font-semibold text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Generating your draft...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Generate Draft
              </>
            )}
          </button>
        </div>
      ) : (
        /* Result */
        <div className="space-y-4 animate-fade-in">
          <div className="rounded-xl border border-indigo-100/50 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-indigo-50 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-900">{result.headline}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Confidence: {(result.confidence_score * 100).toFixed(0)}%</p>
              </div>
              <span className="text-[9px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-medium">YOUR POST</span>
            </div>

            {/* Draft text */}
            <div className="p-4">
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-4">
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{result.primary_text}</p>
              </div>
              {/* Char count */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-gray-400">{result.primary_text.length} chars</span>
                <span className="text-[10px] text-gray-300">|</span>
                <span className={`text-[10px] ${result.primary_text.length <= 210 ? "text-emerald-500" : "text-amber-500"}`}>
                  {result.primary_text.length <= 210 ? "All above fold" : `${210} above fold`}
                </span>
              </div>
            </div>

            {/* Grounding */}
            {result.grounding_summary && (
              <div className="px-4 pb-3">
                <p className="text-[10px] text-gray-400 mb-0.5">Grounded in:</p>
                <p className="text-[10px] text-gray-600">{result.grounding_summary}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/queue")}
              className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:from-indigo-600 hover:to-violet-700 shadow-sm text-center"
            >
              Review in Queue
            </button>
            <button
              onClick={() => { setResult(null); setTopic(""); setNotes(""); }}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Write Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
