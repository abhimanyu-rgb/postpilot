"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type QueueTab = "pending_review" | "approved" | "queued";

const TAB_ORDER: QueueTab[] = ["pending_review", "approved", "queued"];
const TAB_LABEL: Record<QueueTab, string> = {
  pending_review: "Pending Review",
  approved: "Approved",
  queued: "Queued",
};

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
  const [activeTab, setActiveTab] = useState<QueueTab>("pending_review");
  const [counts, setCounts] = useState<Record<QueueTab, number>>({ pending_review: 0, approved: 0, queued: 0 });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Preview mode
  const [previewId, setPreviewId] = useState<number | null>(null);

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

  // Drift check state
  const [driftResults, setDriftResults] = useState<Record<number, { has_drift: boolean; severity?: string; explanation?: string }>>({});
  const [repetitionResults, setRepetitionResults] = useState<Record<number, { has_repetition: boolean; severity?: string; explanation?: string; similar_count?: number }>>({});
  const [dupResults, setDupResults] = useState<Record<number, { has_overlap: boolean; similarity?: number; similar_headline?: string; published_date?: string }>>({});

  // Media state
  const [mediaForId, setMediaForId] = useState<number | null>(null);
  const [mediaSuggestions, setMediaSuggestions] = useState<MediaSuggestion[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());

  const loadDrafts = useCallback(async (tab: QueueTab) => {
    setLoading(true);
    try {
      const data = await api.get<DraftItem[]>(`/api/drafts/?status=${tab}`);
      setDrafts(data);
      // Drift + duplicate checks only matter when reviewing — once approved
      // or queued the user has already accepted the post.
      if (tab === "pending_review") {
        data.forEach((d) => {
          api.get<{ has_drift: boolean; severity?: string; explanation?: string }>(
            `/api/drafts/${d.id}/drift-check`
          ).then((result) => {
            if (result.has_drift) setDriftResults((prev) => ({ ...prev, [d.id]: result }));
          }).catch(() => {});
          api.get<{ has_repetition: boolean; severity?: string; explanation?: string; similar_count?: number }>(
            `/api/drafts/${d.id}/repetition-check`
          ).then((result) => {
            if (result.has_repetition) setRepetitionResults((prev) => ({ ...prev, [d.id]: result }));
          }).catch(() => {});
          api.get<{ has_overlap: boolean; similarity?: number; similar_headline?: string; published_date?: string }>(
            `/api/drafts/${d.id}/duplicate-check`
          ).then((result) => {
            if (result.has_overlap) setDupResults((prev) => ({ ...prev, [d.id]: result }));
          }).catch(() => {});
        });
      }
    } catch {
      // fail open — empty list is fine
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCounts = useCallback(async () => {
    const results = await Promise.all(
      TAB_ORDER.map((t) =>
        api.get<DraftItem[]>(`/api/drafts/?status=${t}`).then((d) => [t, d.length] as const).catch(() => [t, 0] as const)
      )
    );
    setCounts(Object.fromEntries(results) as Record<QueueTab, number>);
  }, []);

  useEffect(() => {
    loadDrafts(activeTab);
  }, [activeTab, loadDrafts]);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts, drafts.length]);

  async function handleApprove(id: number) {
    setActionLoading(id);
    setApprovalInfo(null);
    try {
      // Persist any unsaved manual edits before approving
      if (editingId === id && editText.trim()) {
        await api.put(`/api/drafts/${id}/text`, { primary_text: editText });
        setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, primary_text: editText } : d)));
        setEditingId(null);
      }

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

  async function handleRevert(id: number) {
    setActionLoading(id);
    try {
      await api.post(`/api/drafts/${id}/revert`);
      // Drop from current tab — it's now in Pending Review
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      alert(err?.body?.detail || err?.message || "Revert failed");
    } finally {
      setActionLoading(null);
    }
  }

  const [rejectingId, setRejectingId] = useState<number | null>(null);

  function openRejectModal(id: number) {
    setRejectingId(id);
  }

  async function confirmReject(id: number, tag: "repetitive" | "drift" | "off_topic" | "poor_hook" | "other") {
    setRejectingId(null);
    setActionLoading(id);
    try {
      await api.post(`/api/drafts/${id}/reject?rejection_reason=${tag}`);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      alert(err?.body?.detail || err?.message || "Reject failed");
    } finally {
      setActionLoading(null);
    }
  }

  // Unicode formatting for LinkedIn
  const BOLD_MAP: Record<string, string> = {};
  const ITALIC_MAP: Record<string, string> = {};
  const REVERSE_MAP: Record<string, string> = {};
  "abcdefghijklmnopqrstuvwxyz".split("").forEach((c, i) => {
    const b = String.fromCodePoint(0x1d5ee + i);
    const B = String.fromCodePoint(0x1d5d4 + i);
    const it = String.fromCodePoint(0x1d608 + i);
    BOLD_MAP[c] = b;
    BOLD_MAP[c.toUpperCase()] = B;
    ITALIC_MAP[c] = it;
    REVERSE_MAP[b] = c;
    REVERSE_MAP[B] = c.toUpperCase();
    REVERSE_MAP[it] = c;
  });
  "0123456789".split("").forEach((c, i) => {
    const b = String.fromCodePoint(0x1d7ec + i);
    BOLD_MAP[c] = b;
    REVERSE_MAP[b] = c;
  });

  function toUnicodeBold(text: string): string {
    return [...text].map((c) => BOLD_MAP[c] || c).join("");
  }
  function toUnicodeItalic(text: string): string {
    return [...text].map((c) => ITALIC_MAP[c] || c).join("");
  }
  function toPlainText(text: string): string {
    return [...text].map((c) => REVERSE_MAP[c] || c).join("");
  }

  function applyFormat(type: "bold" | "italic" | "plain" | "bullet" | "line") {
    const el = document.getElementById("draft-editor") as HTMLTextAreaElement | null;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = editText.slice(start, end);

    let replacement = selected;
    let cursorOffset = 0;

    if (type === "bold" && selected) {
      replacement = toUnicodeBold(selected);
    } else if (type === "italic" && selected) {
      replacement = toUnicodeItalic(selected);
    } else if (type === "plain" && selected) {
      replacement = toPlainText(selected);
    } else if (type === "bullet") {
      replacement = selected ? selected.split("\n").map((l) => `\u2022 ${l}`).join("\n") : "\u2022 ";
      cursorOffset = replacement.length;
    } else if (type === "line") {
      replacement = "\n\u2014\u2014\u2014\u2014\u2014\n";
      cursorOffset = replacement.length;
    }

    const newText = editText.slice(0, start) + replacement + editText.slice(end);
    setEditText(newText);

    // Restore cursor
    setTimeout(() => {
      el.focus();
      const pos = start + (cursorOffset || replacement.length);
      el.setSelectionRange(pos, pos);
    }, 0);
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

    // Send the current text (edited or original) so polish works on what the user sees
    const currentDraft = drafts.find((d) => d.id === id);
    const textToPolish = editingId === id ? editText : currentDraft?.primary_text || "";

    try {
      const result = await api.post<{
        id: number;
        primary_text: string;
        version: number;
        changes_made: string;
      }>(`/api/drafts/${id}/polish`, {
        instructions: polishInstructions,
        current_text: textToPolish,
      });

      // Update the draft text in the main view
      setDrafts((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, primary_text: result.primary_text, version: result.version }
            : d
        )
      );

      // If user was editing, update the edit text too
      if (editingId === id) {
        setEditText(result.primary_text);
      }

      // Brief toast, auto-dismiss
      setPolishResult({ id, changes: result.changes_made });
      setTimeout(() => setPolishResult(null), 5000);

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
      // Reload drafts in the currently visible tab
      const updated = await api.get<DraftItem[]>(`/api/drafts/?status=${activeTab}`);
      setDrafts(updated);
      setAlternatesForId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGeneratingCandidate(null);
    }
  }

  return (
    <div className="p-6 max-w-[900px]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Review Queue</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${activeTab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {TAB_LABEL[t]}{counts[t] > 0 ? ` (${counts[t]})` : ""}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-48 bg-gray-100 rounded-xl" />
          <div className="h-32 bg-gray-100 rounded-xl" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-700 mb-1">
            {activeTab === "pending_review" ? "No drafts pending review" :
             activeTab === "approved" ? "No approved drafts waiting to publish" :
             "Nothing in the publish queue"}
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            {activeTab === "pending_review" ? "Drafts appear after campaign runs or when you write a post." :
             activeTab === "approved" ? "Approved drafts move to Queued once the publish processor picks them up." :
             "Queued drafts publish in FIFO order respecting your posting window and daily budget."}
          </p>
          {activeTab === "pending_review" && (
            <a href="/write" className="text-xs font-medium text-violet-600 hover:text-violet-700">Write a Post</a>
          )}
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
              <div key={draft.id} className="rounded-xl border border-indigo-100/50 bg-white shadow-sm overflow-hidden animate-fade-in">
                {/* Header */}
                <div className="px-4 py-3 flex items-start justify-between gap-4">
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

                {/* Voice drift warning */}
                {driftResults[draft.id]?.has_drift && (
                  <div className={`mx-5 mb-3 rounded-lg px-4 py-2.5 flex items-start gap-2.5 animate-fade-in ${
                    driftResults[draft.id].severity === "high"
                      ? "bg-rose-50 border border-rose-200"
                      : driftResults[draft.id].severity === "medium"
                      ? "bg-amber-50 border border-amber-200"
                      : "bg-sky-50 border border-sky-200"
                  }`}>
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                      driftResults[draft.id].severity === "high" ? "bg-rose-100" :
                      driftResults[draft.id].severity === "medium" ? "bg-amber-100" : "bg-sky-100"
                    }`}>
                      <svg className={`w-3.5 h-3.5 ${
                        driftResults[draft.id].severity === "high" ? "text-rose-600" :
                        driftResults[draft.id].severity === "medium" ? "text-amber-600" : "text-sky-600"
                      }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <p className={`text-xs font-medium ${
                        driftResults[draft.id].severity === "high" ? "text-rose-800" :
                        driftResults[draft.id].severity === "medium" ? "text-amber-800" : "text-sky-800"
                      }`}>
                        Voice drift detected ({driftResults[draft.id].severity})
                      </p>
                      <p className={`text-[11px] mt-0.5 ${
                        driftResults[draft.id].severity === "high" ? "text-rose-600" :
                        driftResults[draft.id].severity === "medium" ? "text-amber-600" : "text-sky-600"
                      }`}>
                        {driftResults[draft.id].explanation}
                      </p>
                    </div>
                  </div>
                )}

                {/* Over-repetition warning */}
                {repetitionResults[draft.id]?.has_repetition && (
                  <div className={`mx-5 mb-3 rounded-lg px-4 py-2.5 flex items-start gap-2.5 animate-fade-in ${
                    repetitionResults[draft.id].severity === "high"
                      ? "bg-rose-50 border border-rose-200"
                      : repetitionResults[draft.id].severity === "medium"
                      ? "bg-amber-50 border border-amber-200"
                      : "bg-sky-50 border border-sky-200"
                  }`}>
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                      repetitionResults[draft.id].severity === "high" ? "bg-rose-100" :
                      repetitionResults[draft.id].severity === "medium" ? "bg-amber-100" : "bg-sky-100"
                    }`}>
                      <svg className={`w-3.5 h-3.5 ${
                        repetitionResults[draft.id].severity === "high" ? "text-rose-600" :
                        repetitionResults[draft.id].severity === "medium" ? "text-amber-600" : "text-sky-600"
                      }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </div>
                    <div>
                      <p className={`text-xs font-medium ${
                        repetitionResults[draft.id].severity === "high" ? "text-rose-800" :
                        repetitionResults[draft.id].severity === "medium" ? "text-amber-800" : "text-sky-800"
                      }`}>
                        Repeating a recent point ({repetitionResults[draft.id].severity}{repetitionResults[draft.id].similar_count ? ` · ${repetitionResults[draft.id].similar_count} prior posts` : ""})
                      </p>
                      <p className={`text-[11px] mt-0.5 ${
                        repetitionResults[draft.id].severity === "high" ? "text-rose-600" :
                        repetitionResults[draft.id].severity === "medium" ? "text-amber-600" : "text-sky-600"
                      }`}>
                        {repetitionResults[draft.id].explanation}
                      </p>
                    </div>
                  </div>
                )}

                {/* Duplicate detection warning */}
                {dupResults[draft.id]?.has_overlap && (
                  <div className="mx-4 mb-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 flex items-start gap-2 animate-fade-in">
                    <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <p className="text-[11px] font-medium text-orange-800">
                        Similar content ({dupResults[draft.id].similarity}% overlap)
                      </p>
                      <p className="text-[10px] text-orange-600 mt-0.5">
                        Published {dupResults[draft.id].published_date}: &quot;{dupResults[draft.id].similar_headline}&quot;
                      </p>
                    </div>
                  </div>
                )}

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

                {/* Draft text — edit / plain / linkedin preview */}
                <div className="px-4 pb-2.5">
                  {isEditing ? (
                    <div className="space-y-2">
                      {/* Formatting toolbar */}
                      <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1 bg-gray-50">
                        <button type="button" onClick={() => applyFormat("bold")} title="Bold: select text then click"
                          className="px-1.5 py-0.5 rounded hover:bg-gray-200 text-xs font-bold text-gray-600">B</button>
                        <button type="button" onClick={() => applyFormat("italic")} title="Italic: select text then click"
                          className="px-1.5 py-0.5 rounded hover:bg-gray-200 text-xs italic text-gray-600">I</button>
                        <button type="button" onClick={() => applyFormat("plain")} title="Remove formatting: select text then click"
                          className="px-1.5 py-0.5 rounded hover:bg-gray-200 text-[10px] text-gray-500 underline">Plain</button>
                        <div className="w-px h-4 bg-gray-300 mx-1" />
                        <button type="button" onClick={() => applyFormat("bullet")} title="Add bullet point"
                          className="px-1.5 py-0.5 rounded hover:bg-gray-200 text-xs text-gray-600">&#8226; List</button>
                        <button type="button" onClick={() => applyFormat("line")} title="Add separator line"
                          className="px-1.5 py-0.5 rounded hover:bg-gray-200 text-xs text-gray-600">&#8212;</button>
                        <span className="text-[9px] text-gray-400 ml-auto">Select text, then format</span>
                      </div>
                      <textarea
                        id="draft-editor"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={10}
                        className="w-full rounded-lg border border-indigo-300 p-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none leading-relaxed"
                      />
                      {/* Character counter with fold indicator */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`text-xs ${editText.length > 3000 ? "text-rose-500 font-medium" : "text-gray-400"}`}>{editText.length} / 3,000</span>
                          <span className={`text-[10px] ${editText.length <= 210 ? "text-emerald-500" : "text-amber-500"}`}>
                            Fold at 210 chars {editText.length > 210 ? `(+${editText.length - 210} below fold)` : "(all above fold)"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setEditingId(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                          <button onClick={() => saveEdit(draft.id)} disabled={savingEdit}
                            className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 flex items-center gap-1.5">
                            {savingEdit && <div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" />}
                            Save Edit
                          </button>
                        </div>
                      </div>
                      {/* Fold preview line */}
                      {editText.length > 210 && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[10px] text-amber-700">
                          <span className="font-medium">Above the fold:</span> {editText.slice(0, 210)}
                          <span className="text-amber-400"> ...see more</span>
                        </div>
                      )}
                    </div>
                  ) : previewId === draft.id ? (
                    /* LinkedIn preview mockup */
                    <div className="relative rounded-lg border border-gray-200 bg-white p-0 max-w-[500px] mx-auto shadow-sm">
                      <button onClick={() => setPreviewId(null)} className="absolute top-2 right-2 z-10 rounded-full bg-gray-100 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200" title="Close preview">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                      {/* LinkedIn header */}
                      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
                          {draft.campaign_name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-[13px] font-semibold text-gray-900 leading-tight">Your Name</p>
                          <p className="text-[11px] text-gray-500 leading-tight">Your headline on LinkedIn</p>
                          <p className="text-[10px] text-gray-400">Just now</p>
                        </div>
                      </div>
                      {/* Post text with fold — uses live text if editing */}
                      <div className="px-4 pb-3">
                        {(() => { const t = isEditing ? editText : draft.primary_text; return t.length <= 210 ? (
                          <p className="text-[13px] text-gray-900 whitespace-pre-wrap leading-[1.4]">{t}</p>
                        ) : (
                          <div>
                            <p className="text-[13px] text-gray-900 whitespace-pre-wrap leading-[1.4]">
                              {t.slice(0, 210)}
                              <span className="text-[13px] text-gray-500 font-medium cursor-pointer">...see more</span>
                            </p>
                          </div>
                        ); })()}
                      </div>
                      {/* LinkedIn reaction bar */}
                      <div className="border-t border-gray-100 px-4 py-2 flex items-center justify-between">
                        <div className="flex gap-0.5">
                          <span className="text-[11px]">👍</span><span className="text-[11px]">❤️</span><span className="text-[11px]">💡</span>
                          <span className="text-[11px] text-gray-500 ml-1">23</span>
                        </div>
                        <span className="text-[11px] text-gray-500">4 comments</span>
                      </div>
                      {/* LinkedIn actions */}
                      <div className="border-t border-gray-100 px-2 py-1 flex justify-between">
                        {["Like", "Comment", "Repost", "Send"].map((a) => (
                          <button key={a} className="flex-1 text-center py-1.5 text-[11px] font-medium text-gray-500 rounded hover:bg-gray-50">{a}</button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-gray-50 border border-gray-100 p-4 relative group">
                      {/* Above-fold indicator */}
                      {draft.primary_text.length > 210 && (
                        <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full">
                          <div className="bg-emerald-400 rounded-full" style={{ height: `${Math.min(100, (210 / draft.primary_text.length) * 100)}%` }} />
                          <div className="bg-gray-200 rounded-full flex-1" style={{ height: `${100 - Math.min(100, (210 / draft.primary_text.length) * 100)}%` }} />
                        </div>
                      )}
                      <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {draft.primary_text}
                      </p>
                      {/* Char count */}
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
                        <span className={`text-[10px] ${draft.primary_text.length > 3000 ? "text-rose-500" : "text-gray-400"}`}>{draft.primary_text.length} chars</span>
                        <span className="text-[10px] text-gray-300">|</span>
                        <span className={`text-[10px] ${draft.primary_text.length <= 210 ? "text-emerald-500" : "text-amber-500"}`}>
                          {draft.primary_text.length <= 210 ? "All above fold" : `${210} above fold`}
                        </span>
                      </div>
                      {/* Action buttons */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1">
                        <button onClick={() => setPreviewId(draft.id)} title="LinkedIn preview"
                          className="rounded-md bg-white border border-gray-200 p-1.5 text-gray-400 hover:text-indigo-600 shadow-sm">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                        <button onClick={() => startEdit(draft)} title="Edit draft"
                          className="rounded-md bg-white border border-gray-200 p-1.5 text-gray-400 hover:text-indigo-600 shadow-sm">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Polish result toast — brief, auto-dismiss */}
                {polishResult?.id === draft.id && (
                  <div className="mx-4 mb-2 flex items-center gap-1.5 animate-fade-in">
                    <svg className="w-3 h-3 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    <span className="text-[10px] text-emerald-600">{polishResult.changes}</span>
                  </div>
                )}

                {/* Polish input — inline compact bar */}
                {showPolishInput === draft.id && (
                  <div className="mx-4 mb-2 flex items-center gap-2 animate-fade-in">
                    <input
                      type="text"
                      value={polishInstructions}
                      onChange={(e) => setPolishInstructions(e.target.value)}
                      placeholder="Polish instructions (optional): e.g. 'sharper hook' or 'more contrarian'"
                      className="flex-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-500/20 bg-white"
                      onKeyDown={(e) => { if (e.key === "Enter") handlePolish(draft.id); }}
                    />
                    <button
                      onClick={() => handlePolish(draft.id)}
                      disabled={isPolishing}
                      className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-3 py-1.5 text-[10px] font-medium text-white hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 shrink-0 flex items-center gap-1"
                    >
                      {isPolishing ? (
                        <><div className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full" /> Polishing</>
                      ) : "Polish"}
                    </button>
                    <button onClick={() => { setShowPolishInput(null); setPolishInstructions(""); }}
                      className="text-gray-400 hover:text-gray-600 shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
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
                <div className="px-4 pb-2.5">
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
                <div className="px-4 pb-2.5">
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
                <div className="px-4 py-2.5 bg-violet-50/20 border-t border-indigo-50 flex items-center justify-between">
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
                    {activeTab === "pending_review" ? (
                      <>
                        <button
                          onClick={() => openRejectModal(draft.id)}
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
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => openRejectModal(draft.id)}
                          disabled={isActing}
                          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 flex items-center gap-1.5"
                          title="Reject this draft — moves to history"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Reject
                        </button>
                        <button
                          onClick={() => handleRevert(draft.id)}
                          disabled={isActing}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1.5"
                          title="Move back to Pending Review to edit"
                        >
                          {isActing ? (
                            <div className="animate-spin w-3.5 h-3.5 border-2 border-indigo-700 border-t-transparent rounded-full" />
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          )}
                          Revert to Pending
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject reason modal */}
      {rejectingId !== null && (() => {
        const id = rejectingId;
        const suggested: "repetitive" | "drift" | "off_topic" | "poor_hook" | "other" =
          repetitionResults[id]?.has_repetition ? "repetitive"
          : driftResults[id]?.has_drift ? "drift"
          : "other";
        const tags: { tag: "repetitive" | "drift" | "off_topic" | "poor_hook" | "other"; label: string; description: string }[] = [
          { tag: "repetitive", label: "Repetitive", description: "Repeats a recent point" },
          { tag: "drift", label: "Drift", description: "Contradicts a recent position" },
          { tag: "off_topic", label: "Off-topic", description: "Doesn't fit the campaign" },
          { tag: "poor_hook", label: "Poor hook", description: "Opening doesn't land" },
          { tag: "other", label: "Other", description: "Something else" },
        ];
        return (
          <div className="fixed inset-0 bg-gray-900/40 flex items-center justify-center z-50 p-4" onClick={() => setRejectingId(null)}>
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Why reject?</h3>
              <p className="text-[11px] text-gray-500 mb-4">Tagging helps PostPilot diagnose patterns in monthly insights.</p>
              <div className="space-y-1.5">
                {tags.map(({ tag, label, description }) => (
                  <button
                    key={tag}
                    onClick={() => confirmReject(id, tag)}
                    className={`w-full text-left rounded-lg border px-3 py-2 hover:border-violet-300 hover:bg-violet-50/40 transition ${
                      tag === suggested ? "border-violet-400 bg-violet-50/60" : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-900">{label}</p>
                      {tag === suggested && <span className="text-[9px] font-semibold text-violet-600 uppercase tracking-wide">suggested</span>}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-0.5">{description}</p>
                  </button>
                ))}
              </div>
              <button onClick={() => setRejectingId(null)} className="mt-4 text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
