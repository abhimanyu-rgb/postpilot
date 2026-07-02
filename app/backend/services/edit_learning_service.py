"""Capture user edits at approve-time, classify them with Claude, and promote
recurring patterns into learned_context so future drafts adopt the correction
at generation."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import anthropic
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.draft_edit import DraftEdit
from app.backend.services.personality_service import get_learned_context, save_learned_context
from app.backend.services.token_tracker import track_usage

logger = logging.getLogger("orchestrator")

PROMOTION_THRESHOLD = 3  # ">2 posts" → promote on the 3rd occurrence

EDIT_TYPE_VOCAB = [
    "removed_hashtags",
    "added_hashtags",
    "shortened_opening",
    "rewrote_opening",
    "shortened_overall",
    "lengthened_overall",
    "replaced_jargon",
    "softened_cta",
    "strengthened_cta",
    "removed_cta",
    "added_personal_anecdote",
    "removed_personal_anecdote",
    "changed_tone",
    "restructured_paragraphs",
    "fixed_factual_claim",
    "removed_emojis",
    "added_emojis",
    "other",
]

CLASSIFIER_SYSTEM = f"""You compare an originally-generated LinkedIn post against the user's edited version and identify what categories of edits were made.

Available edit_type slugs (use these exactly; pick the closest match):
{", ".join(EDIT_TYPE_VOCAB)}

Return a JSON array of edit objects. Each object:
{{
  "edit_type": "<one slug from the list>",
  "description": "<one-sentence description of what the user changed>",
  "before_snippet": "<short quote from the original showing the thing changed, <=120 chars>",
  "after_snippet": "<short quote from the edit showing the replacement, <=120 chars>"
}}

Rules:
- Only report substantive edits. Whitespace, punctuation tweaks, single-word typo fixes — skip.
- If multiple distinct kinds of edits happened, return multiple objects.
- If the only change is trivial, return an empty array [].
- Use "other" only when none of the listed slugs fit. Add a description that names the pattern (so we can grow the vocabulary later).
- Return ONLY the JSON array, no prose."""


def _classify_edit(original: str, edited: str, draft_id: int) -> list[dict]:
    """One Claude call. Returns a list of normalized edit observations."""
    user_prompt = f"""## Original (generated)
{original}

## Edited (final, approved)
{edited}

Return the JSON array of edit observations."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=800,
        system=[{
            "type": "text",
            "text": CLASSIFIER_SYSTEM,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_prompt}],
    )
    track_usage(response, service="edit_classification", draft_id=draft_id)

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]
    text = text.strip()
    if not text:
        return []
    try:
        items = json.loads(text)
        if not isinstance(items, list):
            return []
        return [i for i in items if isinstance(i, dict) and i.get("edit_type")]
    except json.JSONDecodeError:
        logger.warning("Edit classifier returned invalid JSON for draft %d", draft_id)
        return []


def _promotion_rule_text(edit_type: str, examples: list[DraftEdit]) -> str:
    """Render a one-line learned-context rule for a recurring edit pattern."""
    count = len(examples)
    sample_descriptions = [e.description for e in examples[:3] if e.description]
    descriptions_blob = " | ".join(sample_descriptions) if sample_descriptions else ""
    if descriptions_blob:
        return f"- [{edit_type}] User has corrected this in {count} posts. Examples: {descriptions_blob}"
    return f"- [{edit_type}] User has corrected this in {count} posts."


def _append_to_learned_context(rule_line: str) -> None:
    existing = get_learned_context() or ""
    header = "## Recurring edit corrections (auto-learned from your edits at approve-time)"
    if header in existing:
        new = existing.rstrip() + "\n" + rule_line + "\n"
    else:
        spacer = "\n\n" if existing.strip() else ""
        new = existing.rstrip() + spacer + header + "\n" + rule_line + "\n"
    save_learned_context(new)


def _maybe_promote(db: Session, edit_type: str) -> None:
    """If this edit_type has hit threshold and hasn't been promoted, append to learned_context."""
    if edit_type == "other":
        return
    rows = (
        db.query(DraftEdit)
        .filter(DraftEdit.edit_type == edit_type)
        .order_by(DraftEdit.created_at.asc())
        .all()
    )
    if len(rows) < PROMOTION_THRESHOLD:
        return
    if any(r.promoted_at is not None for r in rows):
        return  # already promoted earlier

    rule = _promotion_rule_text(edit_type, rows)
    _append_to_learned_context(rule)
    now = datetime.now(timezone.utc)
    for r in rows:
        r.promoted_at = now
    db.commit()
    logger.info("Promoted edit pattern '%s' to learned_context (%d occurrences)", edit_type, len(rows))


def capture_edit_on_approve(db: Session, draft_id: int, original_text: str | None, final_text: str) -> int:
    """Compare original vs final. If they differ, classify and record. Returns count of edits recorded."""
    if not original_text or original_text.strip() == final_text.strip():
        return 0

    try:
        observations = _classify_edit(original_text, final_text, draft_id)
    except Exception as exc:
        logger.warning("Edit classification failed for draft %d: %s", draft_id, exc)
        return 0

    if not observations:
        return 0

    recorded_types: set[str] = set()
    for obs in observations:
        edit_type = (obs.get("edit_type") or "other").strip().lower()
        if edit_type not in EDIT_TYPE_VOCAB:
            edit_type = "other"
        edit = DraftEdit(
            draft_id=draft_id,
            original_text=original_text,
            edited_text=final_text,
            edit_type=edit_type,
            description=(obs.get("description") or "")[:1000],
            before_snippet=(obs.get("before_snippet") or "")[:200] or None,
            after_snippet=(obs.get("after_snippet") or "")[:200] or None,
        )
        db.add(edit)
        recorded_types.add(edit_type)
    db.commit()

    for et in recorded_types:
        _maybe_promote(db, et)

    return len(observations)


def list_edit_type_counts(db: Session) -> list[dict]:
    """Return per-edit-type counts and whether each has been promoted, for the Settings UI."""
    rows = (
        db.query(
            DraftEdit.edit_type,
            func.count(DraftEdit.id).label("count"),
            func.max(DraftEdit.promoted_at).label("promoted_at"),
        )
        .group_by(DraftEdit.edit_type)
        .order_by(func.count(DraftEdit.id).desc())
        .all()
    )
    return [
        {
            "edit_type": r.edit_type,
            "count": int(r.count),
            "promoted": r.promoted_at is not None,
            "threshold": PROMOTION_THRESHOLD,
        }
        for r in rows
    ]
