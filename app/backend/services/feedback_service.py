"""Post feedback service — save performance data and learnings per post.

Feedback is used by the scoring and draft generation prompts to learn
from past posts and improve future content for each campaign.
"""
from __future__ import annotations

import json
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.backend.models.post_feedback import PostFeedback

logger = logging.getLogger("orchestrator")


def save_feedback(
    db: Session,
    draft_id: int,
    campaign_id: int,
    data: dict,
) -> PostFeedback:
    """Save feedback for a published draft. Immutable once submitted."""
    from fastapi import HTTPException

    existing = (
        db.query(PostFeedback).filter(PostFeedback.draft_id == draft_id).first()
    )

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Feedback already submitted for this draft. Feedback is locked after submission.",
        )

    feedback = PostFeedback(
        draft_id=draft_id,
        campaign_id=campaign_id,
        impressions=data.get("impressions"),
        reactions=data.get("reactions"),
        comments=data.get("comments"),
        reposts=data.get("reposts"),
        clicks=data.get("clicks"),
        performance_rating=data.get("performance_rating"),
        what_worked=data.get("what_worked"),
        what_didnt_work=data.get("what_didnt_work"),
        audience_reaction_notes=data.get("audience_reaction_notes"),
        improvement_notes=data.get("improvement_notes"),
        effective_elements_json=json.dumps(data.get("effective_elements", [])),
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    logger.info("Feedback saved for draft %d", draft_id)

    # Trigger personality evolution analysis every 10 feedbacks
    total_feedbacks = db.query(PostFeedback).count()
    if total_feedbacks > 0 and total_feedbacks % 10 == 0:
        try:
            from app.backend.services.voice_memory import analyze_personality_evolution
            analyze_personality_evolution(db)
        except Exception as e:
            logger.debug("Personality evolution analysis failed: %s", e)
    return feedback


def get_feedback(db: Session, draft_id: int) -> dict | None:
    """Get feedback for a specific draft."""
    fb = db.query(PostFeedback).filter(PostFeedback.draft_id == draft_id).first()
    if not fb:
        return None
    return _serialize(fb)


def get_campaign_feedback(db: Session, campaign_id: int, limit: int = 10) -> list[dict]:
    """Get recent feedback for a campaign — used by LLM prompts for learning."""
    feedbacks = (
        db.query(PostFeedback)
        .filter(PostFeedback.campaign_id == campaign_id)
        .order_by(PostFeedback.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize(fb) for fb in feedbacks]


# ~4 chars per token is a rough estimate for English text.
# 800 tokens * 4 = 3200 chars — keeps feedback well under 10% of context.
MAX_FEEDBACK_CHARS = 3200


def build_feedback_prompt_context(db: Session, campaign_id: int) -> str:
    """Build a token-budgeted prompt section from past feedback.

    Strategy:
    - Fetch up to 10 most recent feedbacks (ordered by recency)
    - Build each feedback block, adding to output until char budget is hit
    - Most recent feedback always gets priority
    - High-performing posts ("great") get full detail; others get condensed
    - Returns empty string if no feedback exists
    """
    feedbacks = get_campaign_feedback(db, campaign_id, limit=10)
    if not feedbacks:
        return ""

    header = "## Learnings from Past Posts (use these to improve new content)\n\n"
    blocks: list[str] = []
    total_chars = len(header)

    for i, fb in enumerate(feedbacks, 1):
        rating = fb.get("performance_rating", "unknown")
        is_top = rating in ("great", "good")

        # Build this feedback block
        lines: list[str] = []
        lines.append(f"**Post {i}** (Performance: {rating})")

        # Always include improvement notes — most actionable
        if fb.get("improvement_notes"):
            lines.append(f"- Improve: {_truncate(fb['improvement_notes'], 150)}")

        # What worked/didn't — full for top performers, condensed for others
        if fb.get("what_worked"):
            limit = 150 if is_top else 80
            lines.append(f"- Worked: {_truncate(fb['what_worked'], limit)}")
        if fb.get("what_didnt_work"):
            limit = 150 if is_top else 80
            lines.append(f"- Didn't work: {_truncate(fb['what_didnt_work'], limit)}")

        # Elements and metrics — only for top performers to save tokens
        if is_top:
            if fb.get("audience_reaction_notes"):
                lines.append(f"- Audience: {_truncate(fb['audience_reaction_notes'], 100)}")
            elements = fb.get("effective_elements", [])
            if elements:
                lines.append(f"- Effective: {', '.join(elements[:6])}")

        # Compact metrics line
        metrics = []
        for key in ["impressions", "reactions", "comments"]:
            if fb.get(key) is not None:
                metrics.append(f"{key}={fb[key]}")
        if metrics:
            lines.append(f"- Stats: {', '.join(metrics)}")

        block = "\n".join(lines) + "\n"
        block_chars = len(block)

        # Check budget
        if total_chars + block_chars > MAX_FEEDBACK_CHARS:
            # Try a minimal version — just rating + improvement note
            minimal = f"**Post {i}** ({rating})"
            if fb.get("improvement_notes"):
                minimal += f" — {_truncate(fb['improvement_notes'], 80)}"
            minimal += "\n"
            if total_chars + len(minimal) <= MAX_FEEDBACK_CHARS:
                blocks.append(minimal)
                total_chars += len(minimal)
            break  # Budget exhausted

        blocks.append(block)
        total_chars += block_chars

    if not blocks:
        return ""

    return header + "\n".join(blocks)


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len chars, adding ellipsis if needed."""
    text = text.strip().replace("\n", " ")
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _serialize(fb: PostFeedback) -> dict:
    elements = []
    if fb.effective_elements_json:
        try:
            elements = json.loads(fb.effective_elements_json)
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "id": fb.id,
        "draft_id": fb.draft_id,
        "campaign_id": fb.campaign_id,
        "impressions": fb.impressions,
        "reactions": fb.reactions,
        "comments": fb.comments,
        "reposts": fb.reposts,
        "clicks": fb.clicks,
        "performance_rating": fb.performance_rating,
        "what_worked": fb.what_worked,
        "what_didnt_work": fb.what_didnt_work,
        "audience_reaction_notes": fb.audience_reaction_notes,
        "improvement_notes": fb.improvement_notes,
        "effective_elements": elements,
        "created_at": str(fb.created_at),
        "updated_at": str(fb.updated_at),
    }
