"""Publish service: queue and publish drafts to LinkedIn.

Two modes:
1. queue_for_publish() — called by the UI "Publish to LinkedIn" button.
   Marks the draft as "queued". The scheduler publishes it within the
   campaign's posting window.
2. execute_publish() — called by the scheduler's publish queue processor.
   Actually posts to LinkedIn via the UGC API.
"""
from __future__ import annotations

import logging
import zoneinfo
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.campaign import Campaign
from app.backend.models.draft import Draft
from app.backend.models.published_post import PublishedPost
from app.backend.models.selected_opportunity import SelectedOpportunity

logger = logging.getLogger("orchestrator")

LINKEDIN_UGC_URL = "https://api.linkedin.com/v2/ugcPosts"


def queue_for_publish(db: Session, draft_id: int) -> dict:
    """Queue an approved draft for publishing within the campaign's time slot.

    Does NOT publish immediately. The scheduler handles actual publishing.
    """
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status == "published":
        raise HTTPException(
            status_code=409,
            detail="Draft is already published",
        )

    draft.status = "queued"
    db.commit()

    # Calculate when it will be published
    schedule_message = _get_next_publish_window(db, draft)

    logger.info("Draft %d queued for publish — %s", draft_id, schedule_message)
    return {
        "id": draft.id,
        "status": "queued",
        "message": schedule_message,
    }


def execute_publish(db: Session, draft_id: int) -> dict:
    """Actually publish a draft to LinkedIn. Called by the scheduler only."""
    import json as json_mod

    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")

    token = settings.linkedin_access_token
    person_urn = settings.linkedin_person_urn
    if not token or not person_urn:
        raise HTTPException(status_code=400, detail="LinkedIn not connected")

    # Build post text with selected media links appended
    post_text = draft.primary_text
    if draft.selected_media_json:
        try:
            selected_urls = json_mod.loads(draft.selected_media_json)
            link_urls = [u for u in selected_urls if u.startswith("http") and not _is_image_url(u)]
            if link_urls:
                post_text = post_text.rstrip() + "\n\n" + "\n".join(link_urls[:2])
        except (json_mod.JSONDecodeError, TypeError):
            pass

    # Check if there's a selected article link to use as share URL
    share_url = None
    if draft.selected_media_json:
        try:
            selected_urls = json_mod.loads(draft.selected_media_json)
            for u in selected_urls:
                if u.startswith("http") and not _is_image_url(u):
                    share_url = u
                    break
        except (json_mod.JSONDecodeError, TypeError):
            pass

    # Build UGC payload, with article link if available
    if share_url:
        payload = {
            "author": person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": draft.primary_text},
                    "shareMediaCategory": "ARTICLE",
                    "media": [
                        {
                            "status": "READY",
                            "originalUrl": share_url,
                        }
                    ],
                }
            },
            "visibility": {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
            },
        }
    else:
        payload = {
            "author": person_urn,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": post_text},
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
            },
        }

    try:
        resp = httpx.post(
            LINKEDIN_UGC_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
            },
            timeout=15,
        )

        if resp.status_code == 201:
            post_id = resp.headers.get("X-RestLi-Id", resp.json().get("id", ""))
            draft.status = "published"

            published = PublishedPost(
                draft_id=draft.id,
                publish_mode="linkedin_api",
                published_text=draft.primary_text,
                published_at=datetime.now(timezone.utc),
                external_ref=post_id,
                status="published",
            )
            db.add(published)
            db.commit()

            # Update voice snapshot with new published position
            try:
                from app.backend.services.voice_memory import update_voice_snapshot
                update_voice_snapshot(db)
            except Exception as e:
                logger.debug("Voice snapshot update after publish failed: %s", e)

            logger.info("Draft %d published to LinkedIn (post_id=%s)", draft_id, post_id)
            return {
                "id": draft.id,
                "status": "published",
                "linkedin_post_id": post_id,
            }
        else:
            error_body = resp.text[:500]
            logger.error("LinkedIn publish failed: %d %s", resp.status_code, error_body)
            # Revert to approved so it can be retried
            draft.status = "approved"
            db.commit()
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"LinkedIn API error: {error_body}",
            )

    except httpx.RequestError as e:
        draft.status = "approved"
        db.commit()
        logger.error("LinkedIn publish request failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Failed to reach LinkedIn API: {e}")


def _get_next_publish_window(db: Session, draft: Draft) -> str:
    """Calculate when a queued draft will be published."""
    sel = (
        db.query(SelectedOpportunity)
        .filter(SelectedOpportunity.id == draft.selected_opportunity_id)
        .first()
    )
    if not sel:
        return "Will be published in the next available slot"

    campaign = db.query(Campaign).filter(Campaign.id == sel.campaign_id).first()
    if not campaign:
        return "Will be published in the next available slot"

    window_start = campaign.posting_window_start or "09:00"
    window_end = campaign.posting_window_end or "18:00"

    try:
        tz = zoneinfo.ZoneInfo(settings.timezone or "UTC")
    except Exception:
        tz = zoneinfo.ZoneInfo("UTC")

    now = datetime.now(tz)
    start_h, start_m = int(window_start.split(":")[0]), int(window_start.split(":")[1])
    end_h, end_m = int(window_end.split(":")[0]), int(window_end.split(":")[1])

    window_start_today = now.replace(hour=start_h, minute=start_m, second=0)
    window_end_today = now.replace(hour=end_h, minute=end_m, second=0)

    if window_start_today <= now <= window_end_today:
        return f"Queued. Will publish within the next 30 minutes ({window_start} to {window_end} window)"
    elif now < window_start_today:
        return f"Queued. Will publish today at {window_start} ({window_start} to {window_end} window)"
    else:
        return f"Queued. Will publish tomorrow at {window_start} ({window_start} to {window_end} window)"


def _is_image_url(url: str) -> bool:
    """Check if a URL looks like an image."""
    lower = url.lower()
    return any(lower.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"))
