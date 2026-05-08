"""Analytics orchestration: scrape engagement, score, extract insights, stage for review.

Triggered weekly by the scheduler (Saturday 09:00 user-local) and on-demand
via the /api/analytics/refresh endpoint.

Cohort: posts published days X-14 to X-7 (gives each post a week to mature
before we measure engagement). Score: simple — reactions + 3*comments, with
comments null on public-profile scrapes so it collapses to reactions for now.
Top quartile of the last 90 days = "high engagement" → Claude extracts what
worked → staged for human review before promotion to learned_context.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import TypedDict

import anthropic
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.draft import Draft
from app.backend.models.integration_config import IntegrationConfig
from app.backend.models.post_analytics import PostAnalytics, StagedInsight
from app.backend.models.published_post import PublishedPost
from app.backend.services.analytics_scraper import (
    match_activity_to_share,
    scrape_profile_posts,
)
from app.backend.services.secret_service import get_secret

logger = logging.getLogger("orchestrator")

INSIGHT_QUARTILE = 0.75
LOOKBACK_DAYS_FOR_QUARTILE = 90
COHORT_LAG_START_DAYS = 14  # post must be at least this old
COHORT_LAG_END_DAYS = 7  # post must be at most this old


class RefreshResult(TypedDict):
    scraped_count: int
    matched_count: int
    new_snapshots: int
    new_insights: int
    skipped_already_scraped_today: int


def _get_linkedin_handle() -> str | None:
    """Vanity handle for the public profile URL — the `<handle>` in linkedin.com/in/<handle>.

    Resolution order: integration_config row (user-configurable in Settings) →
    LINKEDIN_PROFILE_HANDLE env var (legacy / deployment override).
    """
    from app.backend.core.database import SessionLocal

    db = SessionLocal()
    try:
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        if config and config.linkedin_profile_handle:
            return config.linkedin_profile_handle.strip() or None
    finally:
        db.close()
    return (get_secret("LINKEDIN_PROFILE_HANDLE") or settings.linkedin_profile_handle).strip() or None


def _engagement_score(reactions: int | None, comments: int | None) -> float:
    """Simple weighted score. Tunable later."""
    r = reactions or 0
    c = comments or 0
    return float(r + 3 * c)


def _cohort_drafts(db: Session) -> list[tuple[Draft, PublishedPost]]:
    """Posts published in the lag window: between X-14 and X-7 days ago."""
    now = datetime.utcnow()
    start = now - timedelta(days=COHORT_LAG_START_DAYS)
    end = now - timedelta(days=COHORT_LAG_END_DAYS)
    rows = (
        db.query(Draft, PublishedPost)
        .join(PublishedPost, PublishedPost.draft_id == Draft.id)
        .filter(PublishedPost.published_at >= start)
        .filter(PublishedPost.published_at <= end)
        .filter(PublishedPost.external_ref.isnot(None))
        .all()
    )
    return rows


def _high_engagement_threshold(db: Session) -> float | None:
    """Return the engagement_score at the configured quartile, over the last
    90 days of analytics snapshots. Returns None if not enough data yet
    (need at least 4 snapshots to draw a meaningful quartile).
    """
    cutoff = datetime.utcnow() - timedelta(days=LOOKBACK_DAYS_FOR_QUARTILE)
    # Take the most recent snapshot per draft (avoid counting the same draft
    # multiple times across weeks).
    sub = (
        db.query(PostAnalytics.draft_id, PostAnalytics.engagement_score)
        .filter(PostAnalytics.scraped_at >= cutoff)
        .filter(PostAnalytics.engagement_score.isnot(None))
        .all()
    )
    if len(sub) < 4:
        return None
    latest_per_draft: dict[int, float] = {}
    for draft_id, score in sub:
        # Latest wins (we order by id ascending so newer rows overwrite —
        # close enough since ids are monotonic).
        latest_per_draft[draft_id] = score
    scores = sorted(latest_per_draft.values())
    idx = int(len(scores) * INSIGHT_QUARTILE)
    idx = min(idx, len(scores) - 1)
    return scores[idx]


def _extract_insight(draft: Draft, score: float, manual_feedback: dict | None) -> dict | None:
    """Ask Claude what made this post work. Manual feedback (if present) is
    treated as gold context; engagement is the supporting signal.

    Returns dict with keys: insight, reasoning, source_summary. None on failure.
    """
    api_key = settings.anthropic_api_key
    if not api_key:
        logger.warning("No Anthropic key configured; skipping insight extraction")
        return None

    client = anthropic.Anthropic(api_key=api_key)

    feedback_block = ""
    if manual_feedback:
        feedback_block = f"\n## Manual feedback the user recorded\n{json.dumps(manual_feedback, indent=2)}\n"

    user_prompt = f"""A LinkedIn post performed in the top quartile of recent engagement (score: {score:.0f}).
{feedback_block}
## The post
{draft.primary_text}

## Task
Extract one concrete, transferable insight about what made this post work — something the author can apply to future posts. Be specific (e.g., "system-level challenges as hooks" not "good hook"). If manual feedback is present, weight it heavily; engagement alone can be misleading. If you can't find a useful insight, say so.

## Output
Return ONLY a JSON object:
{{
  "insight": "One sentence the author can lift into future posts. Concrete and specific.",
  "reasoning": "Why this insight is supported by the post text and (if any) feedback.",
  "source_summary": "30-word summary of the post for later identification."
}}"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
            messages=[{"role": "user", "content": user_prompt}],
        )
        from app.backend.services.token_tracker import track_usage
        track_usage(response, service="analytics_insight")

        text = response.content[0].text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:])
            if text.endswith("```"):
                text = text[:-3]
        parsed = json.loads(text)
        if not parsed.get("insight"):
            return None
        return parsed
    except Exception as e:
        logger.error("Insight extraction failed for draft %d: %s", draft.id, e)
        return None


def _fetch_manual_feedback(db: Session, draft_id: int) -> dict | None:
    from app.backend.models.post_feedback import PostFeedback

    fb = db.query(PostFeedback).filter(PostFeedback.draft_id == draft_id).first()
    if not fb:
        return None
    return {
        "performance_rating": fb.performance_rating,
        "what_worked": fb.what_worked,
        "what_didnt_work": fb.what_didnt_work,
        "audience_reaction_notes": fb.audience_reaction_notes,
        "improvement_notes": fb.improvement_notes,
        "effective_elements": json.loads(fb.effective_elements_json) if fb.effective_elements_json else [],
    }


def refresh_analytics(db: Session, handle: str | None = None) -> RefreshResult:
    """End-to-end: scrape -> match -> snapshot -> score -> extract insights.

    Idempotent within a day: if a draft already has a snapshot scraped today,
    we skip re-scraping and re-asking Claude for it.
    """
    if handle is None:
        handle = _get_linkedin_handle()
    if not handle:
        raise ValueError(
            "No LinkedIn handle configured. Set LINKEDIN_PROFILE_HANDLE secret "
            "or env var to your LinkedIn vanity name."
        )

    cohort = _cohort_drafts(db)
    if not cohort:
        logger.info("Analytics refresh: no posts in lag window (X-14 to X-7)")
        return {
            "scraped_count": 0,
            "matched_count": 0,
            "new_snapshots": 0,
            "new_insights": 0,
            "skipped_already_scraped_today": 0,
        }

    logger.info("Analytics refresh: %d posts in cohort", len(cohort))
    posts = scrape_profile_posts(handle)
    logger.info("Analytics refresh: %d posts scraped", len(posts))

    # Map: external_ref -> (draft, published_post)
    by_share: dict[str, tuple[Draft, PublishedPost]] = {
        pp.external_ref: (d, pp) for d, pp in cohort if pp.external_ref
    }
    candidate_share_urns = list(by_share.keys())

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    matched = 0
    new_snapshots = 0
    new_insights = 0
    skipped = 0

    threshold = _high_engagement_threshold(db)

    for p in posts:
        try:
            activity_id = int(p["activity_id"])
        except (ValueError, KeyError):
            continue

        # Prefer exact match via published_post.activity_urn (set at publish
        # time for new posts); fall back to numeric heuristic for old posts.
        share_urn = _exact_match_via_activity_urn(db, activity_id, candidate_share_urns)
        if not share_urn:
            share_urn = match_activity_to_share(activity_id, candidate_share_urns)
        if not share_urn or share_urn not in by_share:
            continue

        draft, pp = by_share[share_urn]
        matched += 1

        # Idempotence: skip if already scraped today
        already = (
            db.query(PostAnalytics)
            .filter(PostAnalytics.draft_id == draft.id)
            .filter(PostAnalytics.scraped_at >= today_start)
            .first()
        )
        if already:
            skipped += 1
            continue

        score = _engagement_score(p.get("reactions"), p.get("comments"))
        snap = PostAnalytics(
            draft_id=draft.id,
            scraped_at=datetime.utcnow(),
            reactions=p.get("reactions"),
            comments=p.get("comments"),
            engagement_score=score,
            activity_urn=f"urn:li:activity:{activity_id}",
            posted_at_relative=p.get("posted_at_relative"),
            raw_snapshot_json=json.dumps(p),
        )
        db.add(snap)
        db.flush()
        new_snapshots += 1

        # Backfill activity_urn on published_post if missing
        if not pp.activity_urn:
            pp.activity_urn = f"urn:li:activity:{activity_id}"

        # If above threshold, extract insight and stage it
        if threshold is not None and score >= threshold:
            manual_fb = _fetch_manual_feedback(db, draft.id)
            insight = _extract_insight(draft, score, manual_fb)
            if insight:
                staged = StagedInsight(
                    analytics_id=snap.id,
                    draft_id=draft.id,
                    insight_text=insight["insight"],
                    reasoning=insight.get("reasoning"),
                    source_summary=insight.get("source_summary"),
                    status="pending",
                )
                db.add(staged)
                new_insights += 1
                logger.info(
                    "Staged insight from draft %d (score=%.0f, threshold=%.0f)",
                    draft.id, score, threshold,
                )

    db.commit()
    logger.info(
        "Analytics refresh done: scraped=%d matched=%d new_snapshots=%d new_insights=%d skipped=%d",
        len(posts), matched, new_snapshots, new_insights, skipped,
    )
    return {
        "scraped_count": len(posts),
        "matched_count": matched,
        "new_snapshots": new_snapshots,
        "new_insights": new_insights,
        "skipped_already_scraped_today": skipped,
    }


def _exact_match_via_activity_urn(
    db: Session, activity_id: int, candidate_share_urns: list[str]
) -> str | None:
    """If we recorded the activity URN at publish time, use it for an exact
    match. Returns the corresponding share URN.
    """
    target = f"urn:li:activity:{activity_id}"
    pp = (
        db.query(PublishedPost)
        .filter(PublishedPost.activity_urn == target)
        .first()
    )
    if pp and pp.external_ref in candidate_share_urns:
        return pp.external_ref
    return None


def promote_insight(db: Session, insight_id: int) -> dict:
    """Append an insight to the configured learned_context. The personality_service
    composes learned_context into draft prompts on the next pipeline run.
    """
    insight = db.query(StagedInsight).filter(StagedInsight.id == insight_id).first()
    if not insight:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Insight not found")
    if insight.status != "pending":
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409, detail=f"Insight is already {insight.status}"
        )

    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if not config:
        from fastapi import HTTPException

        raise HTTPException(status_code=500, detail="Config row missing")

    existing = (config.learned_context or "").rstrip()
    appended = f"- {insight.insight_text}".strip()
    config.learned_context = (existing + "\n" + appended).strip() if existing else appended

    insight.status = "promoted"
    insight.promoted_at = datetime.utcnow()
    db.commit()
    logger.info("Insight %d promoted to learned_context", insight_id)
    return {"id": insight.id, "status": "promoted"}


def reject_insight(db: Session, insight_id: int) -> dict:
    insight = db.query(StagedInsight).filter(StagedInsight.id == insight_id).first()
    if not insight:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Insight not found")
    if insight.status != "pending":
        from fastapi import HTTPException

        raise HTTPException(
            status_code=409, detail=f"Insight is already {insight.status}"
        )
    insight.status = "rejected"
    insight.rejected_at = datetime.utcnow()
    db.commit()
    return {"id": insight.id, "status": "rejected"}


def list_analytics_with_drafts(db: Session, limit: int = 50) -> list[dict]:
    """Return recent analytics rows joined with draft info for the Analytics tab."""
    rows = (
        db.query(PostAnalytics, Draft, PublishedPost)
        .join(Draft, Draft.id == PostAnalytics.draft_id)
        .join(PublishedPost, PublishedPost.draft_id == Draft.id)
        .order_by(PostAnalytics.scraped_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    seen_drafts: set[int] = set()  # one row per draft (latest snapshot)
    for analytics, draft, pp in rows:
        if draft.id in seen_drafts:
            continue
        seen_drafts.add(draft.id)
        manual_fb = _fetch_manual_feedback(db, draft.id)
        out.append({
            "draft_id": draft.id,
            "scraped_at": analytics.scraped_at.isoformat(),
            "published_at": pp.published_at.isoformat() if pp.published_at else None,
            "primary_text_first_200": (draft.primary_text or "")[:200],
            "reactions": analytics.reactions,
            "comments": analytics.comments,
            "engagement_score": analytics.engagement_score,
            "activity_urn": analytics.activity_urn,
            "manual_feedback": manual_fb,
        })
    return out


def list_pending_insights(db: Session) -> list[dict]:
    rows = (
        db.query(StagedInsight, Draft)
        .outerjoin(Draft, Draft.id == StagedInsight.draft_id)
        .filter(StagedInsight.status == "pending")
        .order_by(StagedInsight.created_at.desc())
        .all()
    )
    return [
        {
            "id": insight.id,
            "draft_id": insight.draft_id,
            "draft_text_first_200": (draft.primary_text or "")[:200] if draft else None,
            "insight_text": insight.insight_text,
            "reasoning": insight.reasoning,
            "source_summary": insight.source_summary,
            "created_at": insight.created_at.isoformat(),
        }
        for insight, draft in rows
    ]


def get_last_refresh(db: Session) -> str | None:
    row = db.query(PostAnalytics).order_by(PostAnalytics.scraped_at.desc()).first()
    return row.scraped_at.isoformat() if row else None
