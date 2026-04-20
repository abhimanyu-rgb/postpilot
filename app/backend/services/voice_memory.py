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
from app.backend.models.post_feedback import PostFeedback
from app.backend.models.published_post import PublishedPost

logger = logging.getLogger("orchestrator")


def update_voice_snapshot(db: Session) -> None:
    """Rebuild the voice snapshot from recent published posts (last 30 days).

    Called after each publish. Summarizes the user's recent public positions
    into a compact snapshot that can be used for drift detection.
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

    # Collect the published texts
    post_texts = []
    for pub in recent_posts:
        draft = db.query(Draft).filter(Draft.id == pub.draft_id).first()
        if draft:
            post_texts.append(draft.primary_text[:300])

    if not post_texts:
        return

    # Use Claude to create a compact summary of positions and themes
    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        posts_block = "\n---\n".join(post_texts)

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": f"""Analyze these recent LinkedIn posts and create a compact summary of:
1. Key positions and opinions expressed
2. Recurring themes and topics
3. The author's stance on major topics
4. Any strong claims or predictions made

Keep it under 400 words. Be specific about positions taken.

Posts (most recent first):
{posts_block}""",
            }],
        )

        snapshot = response.content[0].text.strip()
        config.voice_snapshot = snapshot
        config.voice_snapshot_post_count = len(recent_posts)
        db.commit()
        logger.info("Voice snapshot updated (%d posts)", len(recent_posts))

        from app.backend.services.token_tracker import track_usage
        track_usage(response, service="voice_snapshot")

    except Exception as e:
        logger.error("Voice snapshot update failed: %s", e)


def check_drift(db: Session, draft_text: str) -> dict | None:
    """Check if a draft contradicts or drifts from recent published positions.

    Returns None if no drift detected, or a dict with:
    {
        "has_drift": True,
        "severity": "low" | "medium" | "high",
        "explanation": "This draft takes position X, but you recently said Y..."
    }
    """
    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if not config or not config.voice_snapshot:
        return None

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": f"""Compare this new draft against the author's recent published positions. Does the draft contradict, significantly deviate from, or undermine any positions the author has publicly taken?

RECENT PUBLISHED POSITIONS:
{config.voice_snapshot}

NEW DRAFT:
{draft_text[:500]}

Respond with ONLY a JSON object:
- If no meaningful drift: {{"has_drift": false}}
- If drift detected: {{"has_drift": true, "severity": "low|medium|high", "explanation": "brief explanation of the inconsistency"}}

Only flag genuine contradictions or significant stance changes. Topic variety across campaigns is normal and NOT drift. Drift means saying opposite things about the same topic.""",
            }],
        )

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = text[:-3]

        result = json.loads(text)

        from app.backend.services.token_tracker import track_usage
        track_usage(response, service="drift_check")

        if result.get("has_drift"):
            return result
        return None

    except Exception as e:
        logger.debug("Drift check failed: %s", e)
        return None


def analyze_personality_evolution(db: Session) -> dict | None:
    """Analyze feedback patterns to suggest personality profile updates.

    Called periodically (e.g., after every 10 feedbacks). Looks at:
    - Which post types consistently perform well
    - Which elements are repeatedly tagged as effective
    - What improvement notes keep recurring
    - How the user's voice has naturally shifted

    Returns suggested updates, or None if not enough data.
    """
    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if not config:
        return None

    feedbacks = (
        db.query(PostFeedback)
        .order_by(PostFeedback.created_at.desc())
        .limit(20)
        .all()
    )

    if len(feedbacks) < 5:
        return None

    # Build feedback summary
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

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        current_profile = config.personality_prompt or ""

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": f"""Based on these feedback patterns from {len(feedbacks)} posts, suggest specific updates to the author's personality profile.

CURRENT PROFILE:
{current_profile[:500]}

FEEDBACK PATTERNS:
- Ratings: {great_count} great/good, {poor_count} average/poor out of {len(ratings)}
- Top effective elements: {', '.join(f'{el} ({count}x)' for el, count in top_elements)}
- Recurring improvement notes: {'; '.join(improvements[:5])}

Respond with ONLY a JSON object:
{{
  "has_suggestions": true/false,
  "suggestions": [
    {{"area": "hooks|structure|tone|topics", "current": "what the profile says now", "suggested": "what it should say", "reason": "based on what feedback pattern"}}
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
