from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import anthropic

from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.campaign import Campaign
from app.backend.models.candidate_opportunity import CandidateOpportunity
from app.backend.models.source_signal import SourceSignal

logger = logging.getLogger("orchestrator")

SCORING_PROMPT_VERSION = "v1.0"


def _build_scoring_system_blocks(
    campaign: Campaign, topics: list[str], feedback_context: str = ""
) -> tuple[str, str]:
    """Return (stable_block, campaign_block).

    The stable block is identical across every scoring call regardless of campaign,
    so it caches reliably. The campaign block holds campaign-specific data — it
    rebuilds per call but is small enough that cache misses on it don't matter.
    """
    from app.backend.services.personality_service import (
        get_content_guardrails,
        get_personality_prompt,
    )

    guardrails = get_content_guardrails()
    personality = get_personality_prompt()

    stable_block = f"""You are a LinkedIn content strategist. Your job is to analyze news signals and identify compelling content opportunities for a LinkedIn thought leader.

## Priority Order (follow strictly)
1. Content guardrails (never violate)
2. Source signals (ground scoring in real content)
3. Feedback learnings (prioritize what performed well before)
4. Personality profile (match the author's interests and angle)

{guardrails}

{personality}

## Your Task
Analyze the provided news signals and identify content opportunities — angles that this person could write about on LinkedIn. For each opportunity:

1. **headline**: A concise headline for the content opportunity (not the final post title)
2. **narrative_type**: One of: "trend_analysis", "hot_take", "practical_insight", "story", "contrarian_view"
3. **source_refs**: Array of signal IDs (integers) that inform this opportunity
4. **relevance_score**: 0.0-1.0 — how relevant is this to the campaign topics and persona?
5. **novelty_score**: 0.0-1.0 — how fresh/unexpected is this angle? (penalize obvious takes)

## Rules
- Identify 3-8 opportunities from the signals
- Each opportunity should have a distinct angle — don't repeat the same take
- You may combine multiple signals into one opportunity
- Score honestly — not everything is a 0.9
- Return ONLY a JSON array, no other text

## Output Format
```json
[
  {{
    "headline": "Why the latest AI regulation signals a shift in enterprise adoption",
    "narrative_type": "trend_analysis",
    "source_refs": [1, 3],
    "relevance_score": 0.85,
    "novelty_score": 0.7
  }}
]
```"""

    feedback_section = f"\n{feedback_context}\n" if feedback_context else ""
    campaign_block = f"""## Campaign Context
- **Topics of expertise**: {", ".join(topics)}
- **Persona**: {campaign.persona}
- **Tone**: {campaign.tone}
{feedback_section}"""

    return stable_block, campaign_block


def _build_scoring_user_prompt(
    signals: list[SourceSignal],
    enriched_content: dict[int, str] | None = None,
) -> str:
    enriched = enriched_content or {}
    signal_list = []
    for signal in signals:
        entry: dict = {
            "id": signal.id,
            "title": signal.title_or_summary,
            "url": signal.url_or_ref,
            "published_at": str(signal.published_at) if signal.published_at else None,
        }
        # Include extracted article excerpt when available
        if signal.id in enriched:
            entry["excerpt"] = enriched[signal.id][:500]
        signal_list.append(entry)

    return f"Here are today's signals to analyze:\n\n```json\n{json.dumps(signal_list, indent=2)}\n```"


def _parse_scoring_response(response: anthropic.types.Message) -> list[dict]:
    text = response.content[0].text
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]
    return json.loads(text)


MAX_SIGNALS_FOR_SCORING = 50


def score_opportunities(
    db: Session,
    run_id: int,
    campaign: Campaign,
    signals: list[SourceSignal],
    run_logger: logging.Logger,
    enriched_content: dict[int, str] | None = None,
) -> list[CandidateOpportunity]:
    """Use Claude to analyze signals and produce scored CandidateOpportunity records."""
    if not signals:
        run_logger.info("No signals to score")
        return []

    # Cap signals — safety net if TF-IDF ranking wasn't applied
    if len(signals) > MAX_SIGNALS_FOR_SCORING:
        scored = sorted(
            signals,
            key=lambda s: (
                s.published_at or datetime.min.replace(tzinfo=timezone.utc),
                1 if s.title_or_summary else 0,
            ),
            reverse=True,
        )
        signals = scored[:MAX_SIGNALS_FOR_SCORING]
        run_logger.info("Capped signals from %d to %d for scoring", len(scored), len(signals))

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    topics = json.loads(campaign.topics_json)

    # Inject learnings from past post feedback
    from app.backend.services.feedback_service import build_feedback_prompt_context
    feedback_context = build_feedback_prompt_context(db, campaign.id)

    stable_block, campaign_block = _build_scoring_system_blocks(
        campaign, topics, feedback_context=feedback_context
    )
    user_prompt = _build_scoring_user_prompt(signals, enriched_content=enriched_content)

    enriched_count = sum(1 for s in signals if enriched_content and s.id in enriched_content)
    run_logger.info(
        "Calling Claude for opportunity scoring (%d signals, %d with article content)",
        len(signals),
        enriched_count,
    )

    # Two-block system prompt:
    # - stable_block carries guardrails + personality + scoring rules. Identical for
    #   every scoring call, marked cache_control: ephemeral so it's served from the
    #   prompt cache after the first call (90% input-token discount).
    # - campaign_block carries the per-campaign context. Small enough that not
    #   caching it is fine. Order matters: stable first, then campaign — the cache
    #   only covers the prefix up to the cache breakpoint.
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1600,
        system=[
            {
                "type": "text",
                "text": stable_block,
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": campaign_block,
            },
        ],
        messages=[{"role": "user", "content": user_prompt}],
    )

    from app.backend.services.token_tracker import track_usage
    track_usage(response, service="scoring", campaign_id=campaign.id)

    try:
        opportunities_data = _parse_scoring_response(response)
    except (json.JSONDecodeError, IndexError, KeyError) as e:
        run_logger.error("Failed to parse scoring response: %s", e)
        run_logger.error("Raw response: %s", response.content[0].text[:500])
        return []

    signal_ids = {s.id for s in signals}
    candidates: list[CandidateOpportunity] = []

    for opp in opportunities_data:
        source_refs = [ref for ref in opp.get("source_refs", []) if ref in signal_ids]
        relevance = max(0.0, min(1.0, float(opp.get("relevance_score", 0))))
        novelty = max(0.0, min(1.0, float(opp.get("novelty_score", 0))))
        global_score = relevance * 0.6 + novelty * 0.4

        candidate = CandidateOpportunity(
            run_id=run_id,
            campaign_id=campaign.id,
            headline=opp.get("headline", "Untitled opportunity"),
            narrative_type=opp.get("narrative_type", "practical_insight"),
            source_refs_json=json.dumps(source_refs),
            relevance_score=relevance,
            novelty_score=novelty,
            global_score=global_score,
            similarity_group_id=opp.get("similarity_group"),
            suppression_reason=(
                "below_threshold" if global_score < campaign.significance_threshold else None
            ),
        )
        db.add(candidate)
        candidates.append(candidate)

    db.commit()
    run_logger.info(
        "Scored %d candidates (%d above threshold)",
        len(candidates),
        sum(1 for c in candidates if c.suppression_reason is None),
    )
    return candidates
