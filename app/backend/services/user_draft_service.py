"""User-initiated draft generation.

Takes a topic or idea from the user, optionally enriches it with
recent source signals, and generates a LinkedIn post draft.
The draft enters the same review queue as automated drafts.
"""
from __future__ import annotations

import json
import logging

import anthropic
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.draft import Draft
from app.backend.services.personality_service import get_content_guardrails, get_personality_prompt, get_learned_context
from app.backend.services.feedback_service import build_feedback_prompt_context

logger = logging.getLogger("orchestrator")


def generate_user_draft(
    db: Session,
    topic: str,
    notes: str = "",
    enrich_with_sources: bool = True,
    posting_window_start: str = "09:00",
    posting_window_end: str = "18:00",
) -> dict:
    """Generate a draft from a user-provided topic.

    1. Build context from personality + guardrails + feedback
    2. Optionally search recent source signals for supporting material
    3. Generate the draft via Claude
    4. Save as pending_review (enters the same queue as automated drafts)
    """
    guardrails = get_content_guardrails()
    personality = get_personality_prompt()
    learned = get_learned_context()

    # Get feedback learnings if any
    feedback_context = ""
    try:
        from app.backend.models.integration_config import IntegrationConfig
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        if config:
            # Use campaign_id=0 as a proxy for user-generated content
            feedback_context = build_feedback_prompt_context(db, 0)
    except Exception:
        pass

    # Optionally find relevant recent signals
    source_context = ""
    if enrich_with_sources:
        source_context = _find_relevant_signals(db, topic)

    learned_section = f"\n## Learned from Past Performance\n{learned}" if learned else ""

    system_prompt = f"""You are a LinkedIn ghostwriter for a thought leader.

## Priority Order (follow strictly)
1. Content guardrails (never violate)
2. The user's topic and notes (this is their idea, respect it)
3. Source material (ground in real facts if available)
4. Feedback learnings (apply what worked before)
5. Personality profile (match the author's voice)

{guardrails}

{personality}
{learned_section}
{feedback_context}

## LinkedIn Post Guidelines
- Length: 500-1100 characters
- Strong hook in first 2 lines
- Short paragraphs, front-load the insight
- End with a clear implication
- No hashtag spam
- First person as the author

## Output Format
Return ONLY a JSON object:
```json
{{
  "primary_text": "The full LinkedIn post",
  "headline": "A short headline for this post idea",
  "grounding_summary": "What facts/sources ground this post",
  "rationale": "Why this angle works for the author",
  "confidence_score": 0.85
}}
```"""

    user_prompt = f"## Topic\n{topic}"
    if notes:
        user_prompt += f"\n\n## Additional Notes\n{notes}"
    if source_context:
        user_prompt += f"\n\n## Relevant Source Material\n{source_context}"
    user_prompt += "\n\nWrite the LinkedIn post now."

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1600,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_prompt}],
    )

    from app.backend.services.token_tracker import track_usage
    track_usage(response, service="user_draft")

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]

    draft_data = json.loads(text)

    # Save as a draft (no campaign/selection linkage, standalone)
    draft = Draft(
        selected_opportunity_id=0,  # 0 = user-generated, not from pipeline
        version=1,
        status="pending_review",
        primary_text=draft_data["primary_text"],
        original_generated_text=draft_data["primary_text"],
        alternate_hooks_json="[]",
        grounding_summary=draft_data.get("grounding_summary", "User-initiated topic"),
        rationale=draft_data.get("rationale", ""),
        confidence_score=max(0.0, min(1.0, float(draft_data.get("confidence_score", 0.7)))),
        profile_used=True,
        prompt_version="v1.0-user",
        critic_version="v1.0",
        posting_window_start=posting_window_start,
        posting_window_end=posting_window_end,
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    logger.info("User draft generated (id=%d): %s", draft.id, draft_data.get("headline", ""))

    return {
        "id": draft.id,
        "primary_text": draft.primary_text,
        "headline": draft_data.get("headline", topic[:60]),
        "confidence_score": draft.confidence_score,
        "grounding_summary": draft.grounding_summary,
    }


def _find_relevant_signals(db: Session, topic: str, limit: int = 5) -> str:
    """Search recent source signals for content relevant to the topic."""
    from app.backend.models.source_signal import SourceSignal

    topic_words = topic.lower().split()
    signals = db.query(SourceSignal).order_by(SourceSignal.created_at.desc()).limit(500).all()

    relevant = []
    for s in signals:
        text = (s.title_or_summary or "").lower()
        matches = sum(1 for w in topic_words if w in text)
        if matches >= 1:
            relevant.append((matches, s))

    relevant.sort(key=lambda x: x[0], reverse=True)
    top = relevant[:limit]

    if not top:
        return ""

    lines = []
    for _, s in top:
        lines.append(f"- {s.title_or_summary} ({s.url_or_ref or 'no link'})")
    return "\n".join(lines)
