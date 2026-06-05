"""Voice memory: track published positions and detect drift in new drafts.

Two systems:
1. Voice snapshot: rolling summary of published posts, updated after each publish.
   Used to detect when a new draft contradicts recent public positions.

2. Personality evolution: periodic analysis of feedback patterns to suggest
   updates to the personality profile as the user naturally evolves.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import anthropic
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.core.database import SessionLocal
from app.backend.models.draft import Draft
from app.backend.models.integration_config import IntegrationConfig
from app.backend.models.post_analytics import PostAnalytics
from app.backend.models.post_feedback import PostFeedback
from app.backend.models.published_post import PublishedPost

logger = logging.getLogger("orchestrator")


def _latest_engagement_by_draft(db: Session, draft_ids: list[int]) -> dict[int, int]:
    """Return the most-recent reaction count per draft, from post_analytics.

    Returns {draft_id: reactions}. Drafts without any analytics snapshot are
    absent from the map (callers should treat that as 'unknown', not 'zero').
    """
    if not draft_ids:
        return {}
    rows = (
        db.query(PostAnalytics)
        .filter(PostAnalytics.draft_id.in_(draft_ids))
        .filter(PostAnalytics.reactions.isnot(None))
        .order_by(PostAnalytics.draft_id, PostAnalytics.scraped_at.desc())
        .all()
    )
    out: dict[int, int] = {}
    for r in rows:
        if r.draft_id not in out:  # first row per draft is the latest
            out[r.draft_id] = r.reactions
    return out


def update_voice_snapshot(db: Session) -> None:
    """Rebuild the voice snapshot from recent published posts (last 30 days).

    Called after each publish. Summarizes the user's recent public positions
    into a compact snapshot used for drift detection.

    Engagement-aware: each post is annotated with its latest reaction count
    when known, and posts above the median are explicitly tagged as
    "high-performer". This lets the summary privilege positions that
    resonated rather than treating every post as equal weight.
    """
    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if not config:
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    recent_posts = (
        db.query(PublishedPost)
        .filter(PublishedPost.published_at >= cutoff)
        .order_by(PublishedPost.published_at.desc())
        .limit(15)
        .all()
    )

    if not recent_posts:
        return

    # Pull draft + engagement for each
    draft_ids = [p.draft_id for p in recent_posts]
    drafts_by_id = {
        d.id: d for d in db.query(Draft).filter(Draft.id.in_(draft_ids)).all()
    }
    engagement_by_draft = _latest_engagement_by_draft(db, draft_ids)

    # Compute median over known engagement values, for high-performer tagging
    known = sorted([v for v in engagement_by_draft.values()])
    median = known[len(known) // 2] if known else None

    # Build engagement-annotated text blocks
    annotated_posts = []
    for pub in recent_posts:
        draft = drafts_by_id.get(pub.draft_id)
        if not draft:
            continue
        reactions = engagement_by_draft.get(pub.draft_id)
        if reactions is None:
            tag = "[engagement: not yet measured]"
        elif median is not None and reactions > median:
            tag = f"[engagement: {reactions} reactions — HIGH PERFORMER vs your median of {median}]"
        else:
            tag = f"[engagement: {reactions} reactions]"
        annotated_posts.append(f"{tag}\n{draft.primary_text[:300]}")

    if not annotated_posts:
        return

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        posts_block = "\n---\n".join(annotated_posts)

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": f"""Analyze these recent LinkedIn posts and create a compact summary of:
1. Key positions and opinions expressed
2. Recurring themes and topics
3. The author's stance on major topics
4. Any strong claims or predictions made
5. Which framings, hooks, or angles correlated with HIGH PERFORMER engagement

Privilege positions and framings from HIGH PERFORMER posts when summarizing the author's stance — those are the ones the audience actually responded to. Posts marked "not yet measured" are recent and uncalibrated; weight them as neutral.

Keep the whole summary under 450 words. Be specific about positions taken and what resonated.

Posts (most recent first):
{posts_block}""",
            }],
        )

        snapshot = response.content[0].text.strip()
        config.voice_snapshot = snapshot
        config.voice_snapshot_post_count = len(recent_posts)
        db.commit()
        logger.info(
            "Voice snapshot updated (%d posts, %d with engagement data, median=%s)",
            len(recent_posts), len(known), median,
        )

        from app.backend.services.token_tracker import track_usage
        track_usage(response, service="voice_snapshot")

    except Exception as e:
        logger.error("Voice snapshot update failed: %s", e)


def _recent_post_blocks(db: Session, days: int = 30, snippet_chars: int = 280) -> list[str]:
    """Return formatted [YYYY-MM-DD] snippet blocks for every published post in the
    last `days`. Shared input source for both drift and repetition checks so the two
    audits see identical context."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    recent_posts = (
        db.query(PublishedPost)
        .filter(PublishedPost.published_at >= cutoff)
        .order_by(PublishedPost.published_at.desc())
        .all()
    )
    if not recent_posts:
        return []
    draft_ids = [p.draft_id for p in recent_posts]
    drafts_by_id = {
        d.id: d for d in db.query(Draft).filter(Draft.id.in_(draft_ids)).all()
    }
    blocks: list[str] = []
    for pp in recent_posts:
        d = drafts_by_id.get(pp.draft_id)
        if d and d.primary_text:
            date_str = pp.published_at.date().isoformat() if pp.published_at else "?"
            blocks.append(f"[{date_str}] {d.primary_text[:snippet_chars]}")
    return blocks


def _run_audit_call(prompt: str, service_label: str) -> dict | None:
    """Shared Haiku call for drift/repetition. Returns parsed JSON or None on failure."""
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        from app.backend.services.token_tracker import track_usage
        track_usage(response, service=service_label)

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = text[:-3]
        return json.loads(text)
    except Exception as e:
        logger.debug("%s failed: %s", service_label, e)
        return None


def check_drift(db: Session, draft_text: str) -> dict | None:
    """Check if a draft contradicts recent published positions.

    Returns None if no drift, or:
    {
        "has_drift": True,
        "severity": "low" | "medium" | "high",
        "explanation": "<one sentence: the contradiction + a brief quote from the prior post>",
    }
    """
    blocks = _recent_post_blocks(db)
    if len(blocks) < 2:
        return None  # Need at least 2 prior posts for drift to be meaningful

    prior_block = "\n---\n".join(blocks)
    prompt = f"""You audit a LinkedIn author's drafts for voice drift — contradictions or significant stance reversals against positions the author has publicly taken in recent posts.

NEW DRAFT:
{draft_text[:600]}

AUTHOR'S RECENT POSTS (last 30 days, newest first):
{prior_block}

Respond with ONLY a JSON object:
- If no meaningful drift: {{"has_drift": false}}
- If drift detected: {{"has_drift": true, "severity": "low|medium|high", "explanation": "<one sentence: the contradiction + a brief quote from the prior post>"}}

Severity guide:
- low: subtle softening or hedging of a previously firm position
- medium: meaningful stance shift on the same topic
- high: direct contradiction — saying the opposite of what was said before

Only flag genuine contradictions or significant stance changes. Topic variety across campaigns is normal and NOT drift."""

    result = _run_audit_call(prompt, "drift_check")
    if result and result.get("has_drift"):
        return result
    return None


def check_repetition(db: Session, draft_text: str) -> dict | None:
    """Check if a draft over-repeats a point the author has made recently.

    Mirror of check_drift but for the opposite failure mode: drift catches
    contradictions; this catches saying the same thing too many times.

    Returns None if no over-repetition, or:
    {
        "has_repetition": True,
        "severity": "low" | "medium" | "high",
        "explanation": "You've made this point in 3 of your last 5 posts...",
        "similar_count": 3,
    }
    """
    blocks = _recent_post_blocks(db)
    if len(blocks) < 2:
        return None  # Need at least 2 prior posts for repetition to be meaningful

    prior_block = "\n---\n".join(blocks)
    prompt = f"""You audit a LinkedIn author's drafts for over-repetition. A point is over-repeated if the same core argument, framing, or insight has been made in multiple recent posts and showing up again risks fatiguing the audience.

NEW DRAFT:
{draft_text[:600]}

AUTHOR'S RECENT POSTS (last 30 days, newest first):
{prior_block}

Respond with ONLY a JSON object:
- If the draft introduces a fresh angle or topic: {{"has_repetition": false}}
- If the draft repeats a point already made: {{"has_repetition": true, "severity": "low|medium|high", "similar_count": <how many recent posts make the same point>, "explanation": "<one sentence: the point being repeated + a brief quote from the prior post>"}}

Severity guide:
- low: similar theme, different framing — only flag if it's already appeared twice
- medium: same point, slightly different wording, appeared 2 times before
- high: nearly identical argument, appeared 3+ times — strong fatigue risk

Topic variety across campaigns is normal — only flag when the SAME claim/insight is being recycled. Cross-campaign repetition counts too."""

    result = _run_audit_call(prompt, "repetition_check")
    if result and result.get("has_repetition"):
        return result
    return None


def _summarize_engagement_patterns(db: Session, top_n: int = 5) -> dict | None:
    """Pull top and bottom performers from post_analytics, with their post text.

    Returns {"top": [{text, reactions}], "bottom": [...], "snapshot_count": N}
    or None if no analytics rows yet.
    """
    # One snapshot per draft — take the latest for each
    latest_rows = (
        db.query(PostAnalytics, Draft)
        .join(Draft, Draft.id == PostAnalytics.draft_id)
        .filter(PostAnalytics.reactions.isnot(None))
        .order_by(PostAnalytics.draft_id, PostAnalytics.scraped_at.desc())
        .all()
    )
    if not latest_rows:
        return None
    seen: set[int] = set()
    latest: list[tuple[PostAnalytics, Draft]] = []
    for snap, draft in latest_rows:
        if draft.id in seen:
            continue
        seen.add(draft.id)
        latest.append((snap, draft))
    latest.sort(key=lambda r: r[0].reactions or 0, reverse=True)
    top = [
        {"text": d.primary_text[:280], "reactions": s.reactions}
        for s, d in latest[:top_n]
    ]
    bottom = [
        {"text": d.primary_text[:280], "reactions": s.reactions}
        for s, d in latest[-top_n:]
        if (s, d) not in latest[:top_n]
    ]
    return {"top": top, "bottom": bottom, "snapshot_count": len(latest)}


def analyze_personality_evolution(db: Session) -> dict | None:
    """Analyze feedback patterns AND engagement patterns to suggest personality updates.

    Dual-trigger: fires when either signal source has enough rows. Thresholds
    are user-configurable on integration_config (evolution_min_feedbacks /
    evolution_min_snapshots), defaults 5 and 4.

    Manual feedback is treated as the stronger signal ("what worked / didn't"
    is the user's judgment); engagement is supporting ("the audience
    responded"). Suggestions are still staged via the log + learned_context
    append — no silent overwrite of personality_prompt.
    """
    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if not config:
        return None

    min_feedbacks = config.evolution_min_feedbacks or 5
    min_snapshots = config.evolution_min_snapshots or 4

    feedbacks = (
        db.query(PostFeedback)
        .order_by(PostFeedback.created_at.desc())
        .limit(20)
        .all()
    )
    engagement = _summarize_engagement_patterns(db)
    feedback_ok = len(feedbacks) >= min_feedbacks
    engagement_ok = engagement is not None and engagement["snapshot_count"] >= min_snapshots

    if not feedback_ok and not engagement_ok:
        logger.info(
            "Personality evolution skipped — need >=%d feedbacks (%d) OR >=%d snapshots (%d)",
            min_feedbacks, len(feedbacks),
            min_snapshots, engagement["snapshot_count"] if engagement else 0,
        )
        return None

    # Build feedback summary (may be empty if engagement-only trigger fired)
    ratings = [f.performance_rating for f in feedbacks if f.performance_rating]
    elements: dict[str, int] = {}
    improvements: list[str] = []
    for fb in feedbacks:
        if fb.effective_elements_json:
            try:
                for el in json.loads(fb.effective_elements_json):
                    elements[el] = elements.get(el, 0) + 1
            except (json.JSONDecodeError, TypeError):
                pass
        if fb.improvement_notes:
            improvements.append(fb.improvement_notes)
    top_elements = sorted(elements.items(), key=lambda x: x[1], reverse=True)[:5]
    great_count = ratings.count("great") + ratings.count("good")
    poor_count = ratings.count("poor") + ratings.count("average")

    feedback_block = "(no manual feedback yet)"
    if feedback_ok:
        feedback_block = (
            f"- Ratings: {great_count} great/good, {poor_count} average/poor out of {len(ratings)}\n"
            f"- Top effective elements: {', '.join(f'{el} ({count}x)' for el, count in top_elements) or '(none)'}\n"
            f"- Recurring improvement notes: {'; '.join(improvements[:5]) or '(none)'}"
        )

    engagement_block = "(no engagement data yet)"
    if engagement_ok:
        top_lines = "\n".join(f"  - [{p['reactions']} reactions] {p['text']}" for p in engagement["top"])
        bottom_lines = "\n".join(f"  - [{p['reactions']} reactions] {p['text']}" for p in engagement["bottom"])
        engagement_block = (
            f"- Total posts measured: {engagement['snapshot_count']}\n"
            f"- TOP performers:\n{top_lines}\n"
            f"- BOTTOM performers:\n{bottom_lines}"
        )

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        current_profile = config.personality_prompt or ""
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{
                "role": "user",
                "content": f"""Suggest specific updates to the author's personality profile based on TWO signals.

CURRENT PROFILE:
{current_profile[:500]}

SIGNAL 1 — Manual feedback the author recorded (treat as the strongest signal — it's the author's own judgment of what worked):
{feedback_block}

SIGNAL 2 — Public engagement on published posts (treat as supporting evidence — audience reaction can be noisy):
{engagement_block}

Reconciliation rules:
- If both signals agree (e.g., hook style X is rated "great" AND its posts top engagement): high confidence, suggest.
- If only manual feedback supports a pattern: medium confidence, suggest if pattern is clear.
- If only engagement supports a pattern: lower confidence, suggest only if the pattern is strong (top performers share a clearly identifiable trait absent from bottom performers).
- If signals conflict (author rated "poor" but post got high engagement, or vice versa): note the conflict, do NOT suggest a change. Audience preference and author intent diverging is information, not a directive.

Respond with ONLY a JSON object:
{{
  "has_suggestions": true/false,
  "suggestions": [
    {{"area": "hooks|structure|tone|topics", "current": "what the profile says now", "suggested": "what it should say", "reason": "based on which signal(s) and what pattern", "confidence": "high|medium|low"}}
  ],
  "summary": "one line summary of the evolution direction"
}}

Only suggest changes supported by clear patterns (3+ consistent signals). Do not suggest changes that contradict the author's core identity.""",
            }],
        )

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = text[:-3]

        result = json.loads(text)

        from app.backend.services.token_tracker import track_usage
        track_usage(response, service="personality_evolution")

        if result.get("has_suggestions"):
            # Store in evolution log
            log_entry = {
                "date": str(datetime.now(timezone.utc).date()),
                "feedback_count": len(feedbacks),
                "suggestions": result.get("suggestions", []),
                "summary": result.get("summary", ""),
            }

            existing_log = []
            if config.personality_evolution_log:
                try:
                    existing_log = json.loads(config.personality_evolution_log)
                except (json.JSONDecodeError, TypeError):
                    pass

            existing_log.append(log_entry)
            # Keep last 10 entries
            config.personality_evolution_log = json.dumps(existing_log[-10:])

            # Auto-append new suggestions to learned_context
            new_lines = []
            for s in result.get("suggestions", []):
                new_lines.append(f"- [{s.get('area', 'general')}] {s.get('suggested', '')} (learned: {s.get('reason', '')})")
            if new_lines:
                existing_learned = config.learned_context or ""
                separator = "\n" if existing_learned else ""
                config.learned_context = (existing_learned + separator + "\n".join(new_lines)).strip()

            db.commit()

            logger.info("Personality evolution analyzed: %s", result.get("summary"))
            return result

        return None

    except Exception as e:
        logger.error("Personality evolution analysis failed: %s", e)
        return None


def get_evolution_log(db: Session) -> list[dict]:
    """Get the personality evolution log for the settings page."""
    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if not config or not config.personality_evolution_log:
        return []
    try:
        return json.loads(config.personality_evolution_log)
    except (json.JSONDecodeError, TypeError):
        return []
