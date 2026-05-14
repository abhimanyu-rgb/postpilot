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


def _ensure_utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware UTC. SQLite stores naive datetimes."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

scheduler = BackgroundScheduler()

# Global kill switch — when True, publish queue processor skips all publishes
_publish_paused = False

# Content generation runs at this hour the day before posting. Picked to land
# inside the window when this user's laptop is most likely awake (16:00–18:00 IST).
# Misfire grace is wide enough that a laptop coming online by ~19:00 still
# catches today's run; beyond that it falls to the next day.
GENERATION_HOUR = 16  # 4 PM
MISFIRE_GRACE_SECONDS = 3 * 3600  # 3 hours


def _schedule_campaign(campaign: Campaign) -> None:
    """Schedule content generation for a campaign.

    Runs in the late afternoon so drafts are ready for review the same evening
    or the next morning.
    """
    job_id = f"daily_run_campaign_{campaign.id}"

    trigger = CronTrigger(hour=GENERATION_HOUR, minute=0, timezone=settings.timezone)
    scheduler.add_job(
        execute_daily_run,
        trigger=trigger,
        args=[campaign.id],
        id=job_id,
        replace_existing=True,
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
    )
    logger.info(
        "Scheduled content generation for campaign %d at %02d:00 %s (misfire grace %dh)",
        campaign.id,
        GENERATION_HOUR,
        settings.timezone,
        MISFIRE_GRACE_SECONDS // 3600,
    )


def is_publishing_paused() -> bool:
    return _publish_paused


def set_publishing_paused(paused: bool) -> None:
    global _publish_paused
    _publish_paused = paused
    logger.info("Publishing %s", "PAUSED" if paused else "RESUMED")


def process_publish_queue() -> None:
    """Check for approved posts and publish them in FIFO order."""
    if _publish_paused:
        logger.debug("Publishing paused, skipping queue")
        return

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
        today_start_naive = today_start.astimezone(timezone.utc).replace(tzinfo=None)
        posts_today = (
            db.query(PublishedPost)
            .filter(PublishedPost.published_at >= today_start_naive)
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
            gap_end = _ensure_utc(last_post.published_at) + timedelta(minutes=min_gap)
            if datetime.now(timezone.utc) < gap_end:
                logger.debug("Min gap not met yet, skipping publish queue")
                return

        # Get queued drafts in FIFO order (oldest first)
        queued_drafts = (
            db.query(Draft)
            .filter(Draft.status.in_(["approved", "queued", "queued_for_publish"]))
            .order_by(Draft.created_at.asc())
            .all()
        )

        if not queued_drafts:
            return

        remaining_budget = daily_budget - posts_today

        for draft in queued_drafts:
            if remaining_budget <= 0:
                break

            # Re-check min gap before each publish (not just at the start)
            last = db.query(PublishedPost).order_by(PublishedPost.published_at.desc()).first()
            if last and last.published_at:
                if datetime.now(timezone.utc) < _ensure_utc(last.published_at) + timedelta(minutes=min_gap):
                    logger.debug("Min gap not met for next draft, stopping queue processing")
                    break

            # Resolve posting window: draft override (user-drafted posts) > campaign > default
            campaign = None
            if draft.selected_opportunity_id and draft.selected_opportunity_id > 0:
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

            if draft.posting_window_start and draft.posting_window_end:
                window_start = draft.posting_window_start
                window_end = draft.posting_window_end
            elif campaign:
                window_start = campaign.posting_window_start or "09:00"
                window_end = campaign.posting_window_end or "18:00"
            else:
                window_start = "09:00"
                window_end = "18:00"

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
                    "Auto-published draft %d for %s (%d/%d today)",
                    draft.id,
                    f"campaign '{campaign.name}'" if campaign else "user post",
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

        today_start_naive = today_start.astimezone(timezone.utc).replace(tzinfo=None)
        posts_today = (
            db.query(PublishedPost)
            .filter(PublishedPost.published_at >= today_start_naive)
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

    # Weekly analytics refresh: Saturday 09:00 in user's timezone.
    # 24h misfire grace so a Saturday-laptop-off doesn't lose the run if the
    # user opens their laptop sometime that weekend.
    scheduler.add_job(
        process_weekly_analytics,
        trigger=CronTrigger(day_of_week="sat", hour=9, minute=0, timezone=settings.timezone),
        id="weekly_analytics_refresh",
        replace_existing=True,
        misfire_grace_time=86400,
    )
    logger.info("Scheduled weekly analytics refresh (Saturday 09:00 %s)", settings.timezone)

    scheduler.start()


def process_weekly_analytics() -> None:
    """Saturday cron: refresh engagement for posts in the X-14..X-7 window."""
    from app.backend.services.analytics_service import refresh_analytics

    db = SessionLocal()
    try:
        result = refresh_analytics(db)
        logger.info("Weekly analytics refresh result: %s", result)
    except Exception as e:
        logger.error("Weekly analytics refresh failed: %s", e)
    finally:
        db.close()


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
