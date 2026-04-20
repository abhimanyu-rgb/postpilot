from __future__ import annotations

import json
import logging

import anthropic
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.approval_action import ApprovalAction
from app.backend.models.campaign import Campaign
from app.backend.models.candidate_opportunity import CandidateOpportunity
from app.backend.models.daily_run import DailyRun
from app.backend.models.draft import Draft
from app.backend.models.integration_config import IntegrationConfig
from app.backend.models.published_post import PublishedPost
from app.backend.models.selected_opportunity import SelectedOpportunity

logger = logging.getLogger("orchestrator")


def list_drafts(db: Session, status_filter: str | None = None) -> list[dict]:
    """List drafts with joined campaign/opportunity info."""
    query = db.query(Draft)
    if status_filter:
        query = query.filter(Draft.status == status_filter)

    drafts = query.order_by(Draft.created_at.desc()).all()
    result = []

    for draft in drafts:
        # User-generated drafts have selected_opportunity_id=0
        is_user_draft = draft.selected_opportunity_id == 0

        sel = None
        candidate = None
        campaign_name = "Your Post" if is_user_draft else ""

        if not is_user_draft:
            sel = (
                db.query(SelectedOpportunity)
                .filter(SelectedOpportunity.id == draft.selected_opportunity_id)
                .first()
            )
            if sel:
                candidate = (
                    db.query(CandidateOpportunity)
                    .filter(CandidateOpportunity.id == sel.candidate_id)
                    .first()
                )
                from app.backend.models.campaign import Campaign

                campaign = db.query(Campaign).filter(Campaign.id == sel.campaign_id).first()
                campaign_name = campaign.name if campaign else ""

        # Get publish info if published
        published = (
            db.query(PublishedPost)
            .filter(PublishedPost.draft_id == draft.id)
            .first()
        )

        # Check if feedback exists
        from app.backend.models.post_feedback import PostFeedback
        has_feedback = (
            db.query(PostFeedback)
            .filter(PostFeedback.draft_id == draft.id)
            .first()
        ) is not None

        result.append(
            {
                "id": draft.id,
                "status": draft.status,
                "version": draft.version,
                "primary_text": draft.primary_text,
                "alternate_hooks_json": draft.alternate_hooks_json,
                "grounding_summary": draft.grounding_summary,
                "rationale": draft.rationale,
                "confidence_score": draft.confidence_score,
                "prompt_version": draft.prompt_version,
                "created_at": str(draft.created_at),
                "campaign_name": campaign_name,
                "campaign_id": sel.campaign_id if sel else None,
                "headline": candidate.headline if candidate else (draft.grounding_summary[:60] if draft.grounding_summary else "User post"),
                "narrative_type": candidate.narrative_type if candidate else "user_generated",
                "selection_date": sel.selection_date if sel else str(draft.created_at)[:10],
                "published_at": str(published.published_at) if published else None,
                "linkedin_post_ref": published.external_ref if published else None,
                "has_feedback": has_feedback,
            }
        )

    return result


def approve_draft(db: Session, draft_id: int) -> dict:
    """Approve a draft and calculate the next available posting slot."""
    from datetime import datetime, timedelta, timezone as tz
    import zoneinfo

    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "pending_review":
        raise HTTPException(status_code=409, detail=f"Draft is already {draft.status}")

    draft.status = "approved"

    action = ApprovalAction(
        draft_id=draft.id,
        action_type="approved",
        source_surface="web",
    )
    db.add(action)

    # Calculate next posting slot based on campaign window + min gap
    scheduled_at = None
    schedule_message = "Ready to publish manually anytime"

    sel = db.query(SelectedOpportunity).filter(
        SelectedOpportunity.id == draft.selected_opportunity_id
    ).first()
    if sel:
        campaign = db.query(Campaign).filter(Campaign.id == sel.campaign_id).first()
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()

        if campaign and config:
            try:
                user_tz = zoneinfo.ZoneInfo(config.timezone or "UTC")
            except Exception:
                user_tz = zoneinfo.ZoneInfo("UTC")

            now_local = datetime.now(user_tz)
            window_start = campaign.posting_window_start or "09:00"
            window_end = campaign.posting_window_end or "18:00"
            min_gap = config.min_gap_minutes or 180

            start_h, start_m = int(window_start.split(":")[0]), int(window_start.split(":")[1])
            end_h, end_m = int(window_end.split(":")[0]), int(window_end.split(":")[1])

            # Find the last published post time for gap enforcement
            last_published = (
                db.query(PublishedPost)
                .order_by(PublishedPost.published_at.desc())
                .first()
            )
            earliest_after_gap = now_local
            if last_published and last_published.published_at:
                gap_end = last_published.published_at.astimezone(user_tz) + timedelta(minutes=min_gap)
                if gap_end > earliest_after_gap:
                    earliest_after_gap = gap_end

            # Find next slot within the posting window
            candidate_time = max(now_local, earliest_after_gap)
            window_start_today = candidate_time.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
            window_end_today = candidate_time.replace(hour=end_h, minute=end_m, second=0, microsecond=0)

            if candidate_time <= window_end_today and candidate_time >= window_start_today:
                # Within today's window
                scheduled_at = candidate_time
            elif candidate_time < window_start_today:
                # Before today's window
                scheduled_at = window_start_today
            else:
                # After today's window — schedule for tomorrow
                tomorrow = candidate_time + timedelta(days=1)
                scheduled_at = tomorrow.replace(hour=start_h, minute=start_m, second=0, microsecond=0)

            schedule_message = (
                f"Scheduled for {scheduled_at.strftime('%b %d at %I:%M %p')} "
                f"({window_start}–{window_end} window)"
            )

    db.commit()
    logger.info("Draft %d approved — %s", draft_id, schedule_message)
    return {
        "id": draft.id,
        "status": "approved",
        "scheduled_at": str(scheduled_at) if scheduled_at else None,
        "schedule_message": schedule_message,
    }


def reject_draft(db: Session, draft_id: int, reason: str = "") -> dict:
    """Reject a draft."""
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status != "pending_review":
        raise HTTPException(status_code=409, detail=f"Draft is already {draft.status}")

    draft.status = "rejected"

    action = ApprovalAction(
        draft_id=draft.id,
        action_type="rejected",
        source_surface="web",
        action_note=reason or None,
    )
    db.add(action)
    db.commit()
    logger.info("Draft %d rejected", draft_id)
    return {"id": draft.id, "status": "rejected"}


def update_draft_text(db: Session, draft_id: int, new_text: str) -> dict:
    """Save manual edits to a draft."""
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    draft.primary_text = new_text
    db.commit()
    logger.info("Draft %d text updated manually", draft_id)
    return {"id": draft.id, "primary_text": draft.primary_text}


def polish_draft(db: Session, draft_id: int, instructions: str = "", current_text: str | None = None) -> dict:
    """Use Claude to polish/rewrite a draft based on optional instructions."""
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    # If user sent edited text from the frontend, save it first
    if current_text and current_text != draft.primary_text:
        draft.primary_text = current_text
        db.commit()

    # Get campaign context for persona/tone (user drafts have id=0)
    sel = None
    campaign = None
    if draft.selected_opportunity_id and draft.selected_opportunity_id > 0:
        sel = db.query(SelectedOpportunity).filter(
            SelectedOpportunity.id == draft.selected_opportunity_id
        ).first()
        if sel:
            campaign = db.query(Campaign).filter(Campaign.id == sel.campaign_id).first()

    persona = campaign.persona if campaign else "As defined in personality profile"
    tone = campaign.tone if campaign else "thought-leader"
    topics = json.loads(campaign.topics_json) if campaign else []

    from app.backend.services.personality_service import get_content_guardrails, get_personality_prompt

    user_instructions = instructions or "Polish and improve this LinkedIn post. Strengthen the hook, tighten the language, and make it more follow-worthy."
    guardrails = get_content_guardrails()
    personality = get_personality_prompt()

    system_prompt = f"""You are a LinkedIn content editor. Your job is to polish and improve LinkedIn posts for a thought leader.

## Priority Order (follow strictly)
1. Content guardrails (never violate)
2. The existing draft content (preserve core message)
3. Feedback/instructions (apply the requested changes)
4. Personality profile (match the author's voice)

{guardrails}

## Campaign Context
- **Topics**: {", ".join(topics)}
- **Persona**: {persona}
- **Tone**: {tone}

{personality}

## Rewrite Rules
- Keep the core message and angle. Do not change the topic.
- Strengthen the hook if the first two lines are weak. Move insight earlier if buried.
- Compress context aggressively. Remove filler words.
- Keep the author's voice. Do not make it sound generic or hypey.
- Keep length 500-1100 characters.
- No hashtag spam, no emoji overload.
- Preserve any Unicode bold/italic formatting in the text. Do not convert it to plain text.
- Return ONLY a JSON object with the polished post.

## Output Format
```json
{{
  "primary_text": "The polished LinkedIn post",
  "changes_made": "Brief description of what was improved"
}}
```"""

    user_prompt = f"""## Current Draft
{draft.primary_text}

## Instructions
{user_instructions}

Polish this post now."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1600,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_prompt}],
    )

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]

    from app.backend.services.token_tracker import track_usage
    track_usage(response, service="polishing", draft_id=draft_id)

    result = json.loads(text)
    new_text = result.get("primary_text", draft.primary_text)
    changes = result.get("changes_made", "")

    # Update the draft
    draft.primary_text = new_text
    draft.version += 1
    db.commit()

    logger.info("Draft %d polished by LLM (v%d): %s", draft_id, draft.version, changes)
    return {
        "id": draft.id,
        "primary_text": new_text,
        "version": draft.version,
        "changes_made": changes,
    }


def get_alternate_ideas(db: Session, draft_id: int) -> list[dict]:
    """Get other candidate opportunities from the same run that weren't selected."""
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    sel = db.query(SelectedOpportunity).filter(
        SelectedOpportunity.id == draft.selected_opportunity_id
    ).first()
    if not sel:
        return []

    candidate = db.query(CandidateOpportunity).filter(
        CandidateOpportunity.id == sel.candidate_id
    ).first()
    if not candidate:
        return []

    # Get all candidates from the same run, excluding the selected one
    all_candidates = (
        db.query(CandidateOpportunity)
        .filter(
            CandidateOpportunity.run_id == candidate.run_id,
            CandidateOpportunity.id != candidate.id,
            CandidateOpportunity.suppression_reason.is_(None),
        )
        .order_by(CandidateOpportunity.global_score.desc())
        .all()
    )

    return [
        {
            "id": c.id,
            "headline": c.headline,
            "narrative_type": c.narrative_type,
            "relevance_score": c.relevance_score,
            "novelty_score": c.novelty_score,
            "global_score": c.global_score,
        }
        for c in all_candidates[:5]
    ]


def generate_draft_for_candidate(db: Session, candidate_id: int) -> dict:
    """Generate a new draft for an alternate candidate opportunity."""
    candidate = db.query(CandidateOpportunity).filter(
        CandidateOpportunity.id == candidate_id
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    campaign = db.query(Campaign).filter(Campaign.id == candidate.campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    topics = json.loads(campaign.topics_json)

    from app.backend.services.personality_service import get_content_guardrails, get_personality_prompt
    guardrails = get_content_guardrails()
    personality = get_personality_prompt()

    system_prompt = f"""You are a LinkedIn ghostwriter for a thought leader. Write an engaging LinkedIn post.

## Priority Order (follow strictly)
1. Content guardrails (never violate)
2. Source content (ground the post in real facts)
3. Personality profile (match the author's voice)

{guardrails}

## Campaign Context
- **Topics**: {", ".join(topics)}
- **Persona**: {campaign.persona}
- **Tone**: {campaign.tone}

{personality}

## Guidelines
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
  "grounding_summary": "Factual basis",
  "rationale": "Why this angle",
  "confidence_score": 0.85
}}
```"""

    user_prompt = f"""## Content Opportunity
- **Headline**: {candidate.headline}
- **Type**: {candidate.narrative_type}
- **Relevance**: {candidate.relevance_score:.2f}

Write the LinkedIn post now."""

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1600,
        system=[{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_prompt}],
    )

    from app.backend.services.token_tracker import track_usage
    track_usage(response, service="alternate_draft", campaign_id=campaign.id)

    text = response.content[0].text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]

    draft_data = json.loads(text)

    # Create a SelectedOpportunity for this candidate
    sel = SelectedOpportunity(
        candidate_id=candidate.id,
        campaign_id=campaign.id,
        selection_rank=0,
        selection_date=str(__import__("datetime").datetime.now().date()),
        selection_reason="Manually selected alternate idea",
    )
    db.add(sel)
    db.flush()

    draft = Draft(
        selected_opportunity_id=sel.id,
        version=1,
        status="pending_review",
        primary_text=draft_data["primary_text"],
        alternate_hooks_json="[]",
        grounding_summary=draft_data.get("grounding_summary", ""),
        rationale=draft_data.get("rationale", ""),
        confidence_score=max(0.0, min(1.0, float(draft_data.get("confidence_score", 0.5)))),
        profile_used=False,
        prompt_version="v1.0",
        critic_version="v1.0",
    )
    db.add(draft)
    db.commit()
    db.refresh(draft)

    logger.info("Generated draft %d for alternate candidate %d", draft.id, candidate_id)
    return {
        "id": draft.id,
        "primary_text": draft.primary_text,
        "headline": candidate.headline,
        "confidence_score": draft.confidence_score,
        "campaign_name": campaign.name,
    }
