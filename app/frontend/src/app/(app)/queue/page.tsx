"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface DraftItem {
  id: number;
  status: string;
  version: number;
  primary_text: string;
  alternate_hooks_json: string;
  grounding_summary: string;
  rationale: string;
  confidence_score: number;
  prompt_version: string;
  created_at: string;
  campaign_name: string;
  headline: string;
  narrative_type: string;
  selection_date: string;
}

interface AlternateIdea {
  id: number;
  headline: string;
  narrative_type: string;
  relevance_score: number;
  novelty_score: number;
  global_score: number;
}

interface MediaSuggestion {
  type: "image" | "link";
  url: string;
  title: string;
  source_url: string;
  source_domain: string;
}

export default function QueuePage() {
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Polish state
  const [polishingId, setPolishingId] = useState<number | null>(null);
  const [polishInstructions, setPolishInstructions] = useState("");
  const [showPolishInput, setShowPolishInput] = useState<number | null>(null);
  const [polishResult, setPolishResult] = useState<{ id: number; changes: string } | null>(null);

  // Alternates state
  const [alternatesForId, setAlternatesForId] = useState<number | null>(null);
  const [alternates, setAlternates] = useState<AlternateIdea[]>([]);
  const [generatingCandidate, setGeneratingCandidate] = useState<number | null>(null);

  // Approval schedule state
  const [approvalInfo, setApprovalInfo] = useState<{ id: number; message: string; scheduledAt: string | null } | null>(null);

  // Media state
  const [mediaForId, setMediaForId] = useState<number | null>(null);
  const [mediaSuggestions, setMediaSuggestions] = useState<MediaSuggestion[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());

  useEffect(() => {
    api
      .get<DraftItem[]>("/api/drafts/?status=pending_review")
      .then(setDrafts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleApprove(id: number) {
    setActionLoading(id);
    setApprovalInfo(null);
    try {
      // Save selected media before approving
      if (selectedMedia.size > 0) {
        await api.put(`/api/drafts/${id}/media`, {
          selected_media: Array.from(selectedMedia),
        }).catch(() => {});
      }

      const result = await api.post<{
        id: number;
        status: string;
        scheduled_at: string | null;
        schedule_message: string;
      }>(`/api/drafts/${id}/approve`);
      setApprovalInfo({
        id,
        message: result.schedule_message,
        scheduledAt: result.scheduled_at,
      });
      // Remove from list after showing the message briefly
      setTimeout(() => {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setApprovalInfo(null);
      }, 4000);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: number) {
    setActionLoading(id);
    try {
      await api.post(`/api/drafts/${id}/reject`);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reject failed");
    } finally {
      setActionLoading(null);
    }
  }

  function startEdit(draft: DraftItem) {
    setEditingId(draft.id);
    setEditText(draft.primary_text);
  }

  async function saveEdit(id: number) {
    setSavingEdit(true);
    try {
      await api.put(`/api/drafts/${id}/text`, { primary_text: editText });
      setDrafts((prev) =>
        prev.map((d) => (d.id === id ? { ...d, primary_text: editText } : d))
      );
      setEditingId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handlePolish(id: number) {
    setPolishingId(id);
    setPolishResult(null);
    try {
      const result = await api.post<{
        id: number;
        primary_text: string;
        version: number;
        changes_made: string;
      }>(`/api/drafts/${id}/polish`, { instructions: polishInstructions });
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, primary_text: result.primary_text, version: result.version }
            : d
        )
      );
      setPolishResult({ id, changes: result.changes_made });
      setShowPolishInput(null);
      setPolishInstructions("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Polish failed");
    } finally {
      setPolishingId(null);
    }
  }

  async function loadAlternates(draftId: number) {
    if (alternatesForId === draftId) {
      setAlternatesForId(null);
      return;
    }
    setAlternatesForId(draftId);
    try {
      const ideas = await api.get<AlternateIdea[]>(`/api/drafts/${draftId}/alternates`);
      setAlternates(ideas);
    } catch {
      setAlternates([]);
    }
  }

  async function loadMedia(draftId: number) {
    if (mediaForId === draftId) {
      setMediaForId(null);
      return;
    }
    setMediaForId(draftId);
    setMediaLoading(true);
    setSelectedMedia(new Set());
    try {
      const media = await api.get<MediaSuggestion[]>(`/api/drafts/${draftId}/media`);
      setMediaSuggestions(media);
      // Auto-select first image if available
      const firstImage = media.find((m) => m.type === "image");
      if (firstImage) setSelectedMedia(new Set([firstImage.url]));
    } catch {
      setMediaSuggestions([]);
    } finally {
      setMediaLoading(false);
    }
  }

  function toggleMedia(url: string) {
    setSelectedMedia((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleGenerateFromCandidate(candidateId: number) {
    setGeneratingCandidate(candidateId);
    try {
      const result = await api.post<{
        id: number;
        primary_text: string;
        headline: string;
        confidence_score: number;
        campaign_name: string;
      }>(`/api/drafts/generate-from-candidate/${candidateId}`);
      // Reload drafts
      const updated = await api.get<DraftItem[]>("/api/drafts/?status=pending_review");
      setDrafts(updated);
      setAlternatesForId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGeneratingCandidate(null);
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
    <div className="p-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Review Queue</h1>
        {drafts.length > 0 && (
          <span className="rounded-full bg-indigo-100 text-indigo-700 px-2.5 py-0.5 text-xs font-semibold">
            {drafts.length}
          </span>
        )}
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">No drafts pending review</h3>
          <p className="text-sm text-gray-400">Drafts will appear here after a pipeline run.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const isExpanded = expandedId === draft.id;
            const isEditing = editingId === draft.id;
            const isActing = actionLoading === draft.id;
            const isPolishing = polishingId === draft.id;
            const showAlternates = alternatesForId === draft.id;
            let hooks: string[] = [];
            try { hooks = JSON.parse(draft.alternate_hooks_json || "[]"); } catch { /* empty */ }

            return (
              <div key={draft.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden animate-fade-in">
                {/* Header */}
                <div className="px-5 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {draft.campaign_name}
                      </span>
                      <span className="text-xs text-gray-400">{draft.selection_date}</span>
                      {draft.version > 1 && (
                        <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">
                          v{draft.version}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900">{draft.headline}</h3>
                    <span className="text-[11px] text-gray-400 capitalize">{draft.narrative_type.replace("_", " ")}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Confidence</p>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            draft.confidence_score >= 0.7 ? "bg-emerald-500" :
                            draft.confidence_score >= 0.4 ? "bg-amber-500" : "bg-rose-500"
                          }`}
                          style={{ width: `${draft.confidence_score * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-600">{(draft.confidence_score * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>

                {/* Approval schedule banner */}
                {approvalInfo?.id === draft.id && (
                  <div className="mx-5 mb-3 rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 animate-fade-in">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-indigo-800">Post approved!</p>
                        <p className="text-xs text-indigo-600">{approvalInfo.message}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Draft text — editable or read-only */}
                <div className="px-5 pb-3">
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={10}
                        className="w-full rounded-lg border border-indigo-300 p-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none font-mono leading-relaxed"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{editText.length} chars</span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveEdit(draft.id)}
                            disabled={savingEdit}
                            className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {savingEdit && <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />}
                            Save Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 relative group">
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {draft.primary_text}
                      </p>
                      <button
                        onClick={() => startEdit(draft)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 rounded-md bg-white border border-gray-200 p-1.5 text-gray-400 hover:text-indigo-600 shadow-sm"
                        title="Edit draft"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Polish result banner */}
                {polishResult?.id === draft.id && (
                  <div className="mx-5 mb-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2 animate-fade-in">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Polished: {polishResult.changes}
                  </div>
                )}

                {/* Polish input */}
                {showPolishInput === draft.id && (
                  <div className="mx-5 mb-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2 animate-fade-in">
                    <p className="text-xs font-medium text-indigo-700">Polish with AI</p>
                    <input
                      type="text"
                      value={polishInstructions}
                      onChange={(e) => setPolishInstructions(e.target.value)}
                      placeholder="Optional: e.g. 'Make it more provocative' or 'Add a personal anecdote hook'"
                      className="w-full rounded-md border border-indigo-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handlePolish(draft.id)}
                        disabled={isPolishing}
                        className="rounded-md bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isPolishing ? (
                          <><div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Polishing...</>
                        ) : (
                          <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg> Run Polish</>
                        )}
                      </button>
                      <button
                        onClick={() => { setShowPolishInput(null); setPolishInstructions(""); }}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Expandable details */}
                <div className="px-5">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-3"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    {isExpanded ? "Hide details" : "Show details"}
                  </button>

                  {isExpanded && (
                    <div className="space-y-3 pb-3 animate-fade-in">
                      {hooks.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Alternate Hooks</p>
                          <div className="space-y-1.5">
                            {hooks.map((hook, i) => (
                              <p key={i} className="text-xs text-gray-600 bg-gray-50 rounded-md px-3 py-2 border border-gray-100">{hook}</p>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Grounding</p>
                        <p className="text-xs text-gray-600">{draft.grounding_summary}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Rationale</p>
                        <p className="text-xs text-gray-600">{draft.rationale}</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Alternate ideas section */}
                <div className="px-5 pb-3">
                  <button
                    onClick={() => loadAlternates(draft.id)}
                    className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1 font-medium"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${showAlternates ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                    {showAlternates ? "Hide other ideas" : "Other post ideas"}
                  </button>

                  {showAlternates && (
                    <div className="mt-2 space-y-2 animate-fade-in">
                      {alternates.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No alternate ideas from this run.</p>
                      ) : (
                        alternates.map((alt) => (
                          <div key={alt.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between hover:border-indigo-200">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-800 truncate">{alt.headline}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-gray-400 capitalize">{alt.narrative_type.replace("_", " ")}</span>
                                <span className="text-[10px] text-gray-300">|</span>
                                <span className="text-[10px] text-gray-400">Score: {alt.global_score.toFixed(2)}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleGenerateFromCandidate(alt.id)}
                              disabled={generatingCandidate === alt.id}
                              className="rounded-md bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 shrink-0 ml-3 flex items-center gap-1"
                            >
                              {generatingCandidate === alt.id ? (
                                <><div className="animate-spin w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full" /> Generating...</>
                              ) : (
                                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Generate Draft</>
                              )}
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Media suggestions */}
                <div className="px-5 pb-3">
                  <button
                    onClick={() => loadMedia(draft.id)}
                    disabled={mediaLoading && mediaForId === draft.id}
                    className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1 font-medium"
                  >
                    {mediaLoading && mediaForId === draft.id ? (
                      <><div className="animate-spin w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full" /> Finding media...</>
                    ) : (
                      <>
                        <svg className={`w-3.5 h-3.5 transition-transform ${mediaForId === draft.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {mediaForId === draft.id ? "Hide media" : "Suggest images & links"}
                      </>
                    )}
                  </button>

                  {mediaForId === draft.id && !mediaLoading && (
                    <div className="mt-2 space-y-2 animate-fade-in">
                      {mediaSuggestions.length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">No media found from source articles.</p>
                      ) : (
                        <>
                          <p className="text-[10px] text-gray-400">Select media to include with your post:</p>
                          <div className="grid grid-cols-2 gap-2">
                            {mediaSuggestions.filter((m) => m.type === "image").map((media) => (
                              <button
                                key={media.url}
                                onClick={() => toggleMedia(media.url)}
                                className={`rounded-lg border overflow-hidden text-left ${
                                  selectedMedia.has(media.url) ? "border-indigo-400 ring-2 ring-indigo-500/20" : "border-gray-200 hover:border-gray-300"
                                }`}
                              >
                                <div className="aspect-video bg-gray-100 relative">
                                  <img
                                    src={media.url}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                  {selectedMedia.has(media.url) && (
                                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 flex items-center justify-center">
                                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    </div>
                                  )}
                                </div>
                                <div className="px-2 py-1.5">
                                  <p className="text-[10px] text-gray-500 truncate">{media.source_domain}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                          {/* Links */}
                          {mediaSuggestions.filter((m) => m.type === "link").length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[10px] text-gray-400 mt-1">Source links:</p>
                              {mediaSuggestions.filter((m) => m.type === "link").map((media) => (
                                <div
                                  key={media.url}
                                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer ${
                                    selectedMedia.has(media.url) ? "border-indigo-400 bg-indigo-50/50" : "border-gray-200 hover:border-gray-300"
                                  }`}
                                  onClick={() => toggleMedia(media.url)}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedMedia.has(media.url)}
                                    readOnly
                                    className="rounded border-gray-300 text-indigo-600 w-3.5 h-3.5 pointer-events-none"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] text-gray-700 truncate">{media.title}</p>
                                    <p className="text-[10px] text-gray-400">{media.source_domain}</p>
                                  </div>
                                  <a
                                    href={media.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-gray-400 hover:text-indigo-600 shrink-0"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                  </a>
                                </div>
                              ))}
                            </div>
                          )}
                          {selectedMedia.size > 0 && (
                            <p className="text-[10px] text-indigo-600 font-medium">{selectedMedia.size} item{selectedMedia.size > 1 ? "s" : ""} selected — will be appended to post</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Action bar */}
                <div className="px-5 py-3 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
                  <div className="flex gap-2">
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(draft)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 hover:border-indigo-200 flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setShowPolishInput(showPolishInput === draft.id ? null : draft.id);
                        setPolishInstructions("");
                      }}
                      disabled={isPolishing}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Polish with AI
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReject(draft.id)}
                      disabled={isActing}
                      className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(draft.id)}
                      disabled={isActing}
                      className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 shadow-sm flex items-center gap-1.5"
                    >
                      {isActing ? (
                        <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
