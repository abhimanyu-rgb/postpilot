from __future__ import annotations

import json
import logging

import anthropic

from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.core.storage import LocalStorageManager
from app.backend.models.campaign import Campaign
from app.backend.models.candidate_opportunity import CandidateOpportunity
from app.backend.models.draft import Draft
from app.backend.models.selected_opportunity import SelectedOpportunity
from app.backend.models.source_signal import SourceSignal

logger = logging.getLogger("orchestrator")

DRAFT_PROMPT_VERSION = "v1.0"
CRITIC_VERSION = "v1.0"


def _build_draft_system_prompt(campaign: Campaign, feedback_context: str = "") -> str:
    from app.backend.services.personality_service import (
        get_content_guardrails,
        get_personality_prompt,
    )

    topics = json.loads(campaign.topics_json)
    feedback_section = f"\n{feedback_context}\n" if feedback_context else ""
    guardrails = get_content_guardrails()
    personality = get_personality_prompt()
    return f"""You are a LinkedIn ghostwriter for a thought leader. Write an engaging LinkedIn post based on the provided content opportunity and source material.

## Priority Order (follow strictly)
1. Content guardrails (never violate)
2. Source content (ground the post in real facts)
3. Feedback learnings (apply what worked before)
4. Personality profile (match the author's voice)

{guardrails}

## Campaign Context
- **Topics of expertise**: {", ".join(topics)}
- **Persona**: {campaign.persona}
- **Tone**: {campaign.tone}
{feedback_section}
{personality}

## LinkedIn Post Guidelines
- **Length**: 500-1100 characters (matching the author's preferred range)
- **Structure**: Strong hook (first 2 lines are critical, they appear before "see more"), body with value, clear ending
- **Hook**: Start with a bold claim, operator truth, contrarian reframe, or strong field signal. Never start with "I" or context.
- **Body**: Deliver on the hook's promise. Use short paragraphs (1-3 sentences). Front-load the insight.
- **Ending**: End with a clear implication, operator conclusion, or future line. Not a generic question.
- **No hashtags** at the end. At most 2 naturally woven in.
- **No emojis** in every line. Sparse if at all.
- Write in first person as the author

## Output Format
Return ONLY a JSON object (no other text):
```json
{{
  "primary_text": "The full LinkedIn post text",
  "alternate_hooks": ["Hook variant 1", "Hook variant 2"],
  "grounding_summary": "Brief explanation of the factual basis for this post",
  "rationale": "Why this angle was chosen for this persona and audience",
  "confidence_score": 0.85
}}
```"""


def _build_draft_user_prompt(
    candidate: CandidateOpportunity,
    relevant_signals: list[SourceSignal],
) -> str:
    signals_context = []
    for s in relevant_signals:
        signals_context.append(
            {
                "title": s.title_or_summary,
                "url": s.url_or_ref,
                "published_at": str(s.published_at) if s.published_at else None,
            }
        )

    return f"""## Content Opportunity
- **Headline**: {candidate.headline}
- **Narrative type**: {candidate.narrative_type}
- **Relevance score**: {candidate.relevance_score:.2f}

## Source Material
```json
{json.dumps(signals_context, indent=2)}
```

Write the LinkedIn post now."""


def _parse_draft_response(response: anthropic.types.Message) -> dict:
    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]
    return json.loads(text)


def generate_drafts(
    db: Session,
    campaign: Campaign,
    selected: list[SelectedOpportunity],
    candidates: list[CandidateOpportunity],
    signals: list[SourceSignal],
    storage: LocalStorageManager,
    run_logger: logging.Logger,
) -> list[Draft]:
    """Generate a LinkedIn post draft for each selected opportunity using Claude."""
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Inject learnings from past post feedback
    from app.backend.services.feedback_service import build_feedback_prompt_context
    feedback_context = build_feedback_prompt_context(db, campaign.id)

    system_prompt = _build_draft_system_prompt(campaign, feedback_context=feedback_context)

    candidates_by_id = {c.id: c for c in candidates}
    signals_by_id = {s.id: s for s in signals}

    drafts: list[Draft] = []

    for sel in selected:
        candidate = candidates_by_id.get(sel.candidate_id)
        if not candidate:
            run_logger.warning("Candidate %d not found for selection %d", sel.candidate_id, sel.id)
            continue

        source_ref_ids = json.loads(candidate.source_refs_json)
        relevant_signals = [signals_by_id[sid] for sid in source_ref_ids if sid in signals_by_id]

        user_prompt = _build_draft_user_prompt(candidate, relevant_signals)

        try:
            run_logger.info("Generating draft for: %s", candidate.headline)

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1600,
                system=[
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_prompt}],
            )

            from app.backend.services.token_tracker import track_usage
            track_usage(response, service="drafting", campaign_id=campaign.id)

            draft_data = _parse_draft_response(response)

            draft = Draft(
                selected_opportunity_id=sel.id,
                version=1,
                status="pending_review",
                primary_text=draft_data["primary_text"],
                alternate_hooks_json=json.dumps(draft_data.get("alternate_hooks", [])),
                grounding_summary=draft_data.get("grounding_summary", ""),
                rationale=draft_data.get("rationale", ""),
                confidence_score=max(0.0, min(1.0, float(draft_data.get("confidence_score", 0.5)))),
                profile_used=False,
                prompt_version=DRAFT_PROMPT_VERSION,
                critic_version=CRITIC_VERSION,
            )
            db.add(draft)
            db.flush()

            storage.write_draft_input(draft.id, {
                "candidate": {
                    "headline": candidate.headline,
                    "narrative_type": candidate.narrative_type,
                },
                "signals": [
                    {"title": s.title_or_summary, "url": s.url_or_ref}
                    for s in relevant_signals
                ],
            })
            storage.write_draft_output(draft.id, 1, draft_data)

            drafts.append(draft)
            run_logger.info("Draft generated (id=%d, confidence=%.2f)", draft.id, draft.confidence_score)

        except (json.JSONDecodeError, KeyError) as e:
            run_logger.error(
                "Failed to parse draft response for candidate %d: %s", candidate.id, e
            )
        except Exception as e:
            run_logger.error("Draft generation failed for candidate %d: %s", candidate.id, e)

    db.commit()
    return drafts
