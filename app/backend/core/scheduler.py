"""Scheduler for content generation and publishing.

Two types of jobs:
1. Content generation: runs the evening BEFORE the posting day so drafts
   are ready for review in the morning.
2. Publish processor: runs every 30 minutes during the day, checks for
   approved posts, and publishes them in FIFO order respecting campaign
   posting windows and the global daily post limit.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.backend.core.config import settings
from app.backend.core.database import SessionLocal
from app.backend.models.campaign import Campaign
from app.backend.models.draft import Draft
from app.backend.models.integration_config import IntegrationConfig
from app.backend.models.published_post import PublishedPost
from app.backend.models.selected_opportunity import SelectedOpportunity
from app.backend.services.pipeline_service import execute_daily_run

logger = logging.getLogger("orchestrator")

scheduler = BackgroundScheduler()

# Content generation runs at this hour the evening before posting day
GENERATION_HOUR = 20  # 8 PM


def _schedule_campaign(campaign: Campaign) -> None:
    """Schedule content generation for a campaign.

    Runs at 8 PM the day before, so drafts are ready for morning review.
    """
    job_id = f"daily_run_campaign_{campaign.id}"

    trigger = CronTrigger(hour=GENERATION_HOUR, minute=0, timezone=settings.timezone)
    scheduler.add_job(
        execute_daily_run,
        trigger=trigger,
        args=[campaign.id],
        id=job_id,
        replace_existing=True,
        misfire_grace_time=3600,
    )
    logger.info(
        "Scheduled content generation for campaign %d at %02d:00 %s (day before posting)",
        campaign.id,
        GENERATION_HOUR,
        settings.timezone,
    )


def process_publish_queue() -> None:
    """Check for approved posts and publish them in FIFO order.

    Runs every 30 minutes. Respects:
    - Campaign posting window (only publish within the window)
    - Global daily post limit (max posts per day across all campaigns)
    - Min gap between posts
    - FIFO order (oldest approved first)
    """
    import zoneinfo

    db = SessionLocal()
    try:
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        if not config:
            return

        daily_budget = config.daily_post_budget or settings.daily_post_budget
        min_gap = config.min_gap_minutes or settings.min_gap_minutes

        try:
            user_tz = zoneinfo.ZoneInfo(config.timezone or settings.timezone or "UTC")
        except Exception:
            user_tz = zoneinfo.ZoneInfo("UTC")

        now_local = datetime.now(user_tz)
        today_str = now_local.strftime("%Y-%m-%d")

        # Count posts already published today (global counter)
        today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        posts_today = (
            db.query(PublishedPost)
            .filter(PublishedPost.published_at >= today_start.astimezone(timezone.utc))
            .count()
        )

        if posts_today >= daily_budget:
            logger.debug("Daily post limit reached (%d/%d), skipping publish queue", posts_today, daily_budget)
            return

        # Check min gap since last post
        last_post = (
            db.query(PublishedPost)
            .order_by(PublishedPost.published_at.desc())
            .first()
        )
        if last_post and last_post.published_at:
            gap_end = last_post.published_at + timedelta(minutes=min_gap)
            if datetime.now(timezone.utc) < gap_end:
                logger.debug("Min gap not met yet, skipping publish queue")
                return

        # Get queued drafts in FIFO order (oldest first)
        queued_drafts = (
            db.query(Draft)
            .filter(Draft.status == "queued")
            .order_by(Draft.created_at.asc())
            .all()
        )

        if not queued_drafts:
            return

        remaining_budget = daily_budget - posts_today

        for draft in queued_drafts:
            if remaining_budget <= 0:
                break

            # Get the campaign for this draft to check posting window
            sel = (
                db.query(SelectedOpportunity)
                .filter(SelectedOpportunity.id == draft.selected_opportunity_id)
                .first()
            )
            if not sel:
                continue

            campaign = db.query(Campaign).filter(Campaign.id == sel.campaign_id).first()
            if not campaign:
                continue

            # Check if we're within this campaign's posting window
            window_start = campaign.posting_window_start or "09:00"
            window_end = campaign.posting_window_end or "18:00"

            try:
                start_h, start_m = int(window_start.split(":")[0]), int(window_start.split(":")[1])
                end_h, end_m = int(window_end.split(":")[0]), int(window_end.split(":")[1])
            except (ValueError, IndexError):
                start_h, start_m, end_h, end_m = 9, 0, 18, 0

            window_start_dt = now_local.replace(hour=start_h, minute=start_m, second=0)
            window_end_dt = now_local.replace(hour=end_h, minute=end_m, second=0)

            if not (window_start_dt <= now_local <= window_end_dt):
                continue

            # Publish this draft
            try:
                from app.backend.services.publish_service import execute_publish
                result = execute_publish(db, draft.id)
                logger.info(
                    "Auto-published draft %d for campaign '%s' (%d/%d today)",
                    draft.id,
                    campaign.name,
                    posts_today + 1,
                    daily_budget,
                )

                posts_today += 1
                remaining_budget -= 1

            except Exception as e:
                logger.error("Auto-publish failed for draft %d: %s", draft.id, e)

    except Exception as e:
        logger.error("Publish queue processor failed: %s", e)
    finally:
        db.close()


def get_publish_queue_status() -> dict:
    """Get the current publish queue status for the dashboard."""
    import zoneinfo

    db = SessionLocal()
    try:
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        daily_budget = config.daily_post_budget if config else settings.daily_post_budget

        try:
            user_tz = zoneinfo.ZoneInfo((config.timezone if config else None) or settings.timezone or "UTC")
        except Exception:
            user_tz = zoneinfo.ZoneInfo("UTC")

        now_local = datetime.now(user_tz)
        today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)

        posts_today = (
            db.query(PublishedPost)
            .filter(PublishedPost.published_at >= today_start.astimezone(timezone.utc))
            .count()
        )

        approved_waiting = db.query(Draft).filter(Draft.status.in_(["approved", "queued"])).count()
        queued_count = db.query(Draft).filter(Draft.status == "queued").count()

        return {
            "posts_today": posts_today,
            "daily_budget": daily_budget,
            "remaining": max(0, daily_budget - posts_today),
            "approved_waiting": approved_waiting,
            "queued_for_publish": queued_count,
        }
    finally:
        db.close()


def start_scheduler() -> None:
    """Called from FastAPI lifespan."""
    db = SessionLocal()
    try:
        campaigns = db.query(Campaign).filter(Campaign.status == "active").all()
        for campaign in campaigns:
            _schedule_campaign(campaign)
        logger.info("Scheduled content generation for %d campaigns", len(campaigns))
    finally:
        db.close()

    # Publish queue processor: runs every 30 minutes
    scheduler.add_job(
        process_publish_queue,
        trigger=IntervalTrigger(minutes=30),
        id="publish_queue_processor",
        replace_existing=True,
        misfire_grace_time=300,
    )
    logger.info("Scheduled publish queue processor (every 30 min)")

    scheduler.start()


def add_campaign_job(campaign_id: int) -> None:
    """Called when a campaign is activated."""
    db = SessionLocal()
    try:
        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if campaign:
            _schedule_campaign(campaign)
    finally:
        db.close()


def remove_campaign_job(campaign_id: int) -> None:
    """Called when a campaign is paused or archived."""
    job_id = f"daily_run_campaign_{campaign_id}"
    try:
        scheduler.remove_job(job_id)
        logger.info("Removed scheduler job for campaign %d", campaign_id)
    except Exception:
        pass


def shutdown_scheduler() -> None:
    """Clean shutdown of the scheduler."""
    scheduler.shutdown(wait=False)
    logger.info("Scheduler shut down")
