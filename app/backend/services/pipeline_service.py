from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app.backend.core.config import settings
from app.backend.core.database import SessionLocal
from app.backend.core.logging import get_run_logger
from app.backend.core.storage import LocalStorageManager
from app.backend.models.campaign import Campaign
from app.backend.models.daily_run import DailyRun
from app.backend.models.integration_config import IntegrationConfig
from app.backend.services.content_extractor import enrich_signals_with_content
from app.backend.services.draft_service import generate_drafts
from app.backend.services.scoring_service import score_opportunities
from app.backend.services.selection_service import select_opportunities
from app.backend.services.signal_ranker import rank_signals_by_relevance
from app.backend.services.source_service import fetch_sources

logger = logging.getLogger("orchestrator")


def execute_daily_run(campaign_id: int) -> None:
    """Entry point for the daily pipeline. Called by APScheduler.

    Manages its own DB session — not from FastAPI dependency injection.
    """
    db = SessionLocal()
    run = None

    try:
        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if not campaign or campaign.status != "active":
            logger.info("Skipping run: campaign %d is not active", campaign_id)
            return

        today = str(datetime.now().date())

        existing = (
            db.query(DailyRun)
            .filter(
                DailyRun.campaign_id == campaign_id,
                DailyRun.run_date_local == today,
            )
            .first()
        )
        if existing:
            logger.info("Run already exists for campaign %d on %s", campaign_id, today)
            return

        run = DailyRun(
            campaign_id=campaign_id,
            run_date_local=today,
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        run_logger = get_run_logger(settings.data_dir, today, run.id)
        storage = LocalStorageManager(settings.data_dir)
        degraded = False

        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        budget = config.daily_post_budget if config else settings.daily_post_budget

        run_logger.info(
            "Starting daily run for campaign '%s' (id=%d, budget=%d)",
            campaign.name,
            campaign.id,
            budget,
        )

        # Step 1: Fetch sources
        try:
            signals = fetch_sources(db, run.id, campaign, storage, run_logger)
            run_logger.info("Step 1 complete: %d signals fetched", len(signals))
        except Exception as e:
            run_logger.error("Step 1 failed (source fetching): %s", e)
            signals = []
            degraded = True

        if not signals:
            run.status = "completed"
            run.skip_reason = "no_signals"
            run.completed_at = datetime.now(timezone.utc)
            run.degraded_flag = degraded
            db.commit()
            run_logger.info("Run completed early: no signals found")
            return

        # Step 1b: TF-IDF pre-ranking — narrow 3500+ signals to top 50 most relevant
        try:
            topics = json.loads(campaign.topics_json)
            signals = rank_signals_by_relevance(signals, topics, top_n=50, run_logger=run_logger)
            run_logger.info("Step 1b complete: ranked to %d signals", len(signals))
        except Exception as e:
            run_logger.error("Step 1b failed (TF-IDF ranking): %s", e)
            signals = signals[:50]
            degraded = True

        # Step 1c: Enrich top signals with full article content via trafilatura
        try:
            enriched_content = enrich_signals_with_content(signals, run_logger, max_to_enrich=30)
            run_logger.info("Step 1c complete: enriched %d signals with article content", len(enriched_content))
        except Exception as e:
            run_logger.error("Step 1c failed (content extraction): %s", e)
            enriched_content = {}
            degraded = True

        # Step 2: Score opportunities
        try:
            candidates = score_opportunities(
                db, run.id, campaign, signals, run_logger, enriched_content=enriched_content
            )
            run_logger.info("Step 2 complete: %d candidates scored", len(candidates))
        except Exception as e:
            run_logger.error("Step 2 failed (scoring): %s", e)
            candidates = []
            degraded = True

        if not candidates:
            run.status = "completed"
            run.skip_reason = "no_candidates"
            run.completed_at = datetime.now(timezone.utc)
            run.degraded_flag = degraded
            db.commit()
            run_logger.info("Run completed early: no candidates produced")
            return

        # Step 3: Select opportunities
        try:
            selected = select_opportunities(db, campaign, candidates, budget, run_logger)
            run_logger.info("Step 3 complete: %d opportunities selected", len(selected))
        except Exception as e:
            run_logger.error("Step 3 failed (selection): %s", e)
            selected = []
            degraded = True

        if not selected:
            run.status = "completed"
            run.skip_reason = "no_selections"
            run.completed_at = datetime.now(timezone.utc)
            run.degraded_flag = degraded
            db.commit()
            run_logger.info("Run completed early: no opportunities selected")
            return

        # Step 4: Generate drafts
        try:
            drafts = generate_drafts(
                db, campaign, selected, candidates, signals, storage, run_logger
            )
            run_logger.info("Step 4 complete: %d drafts generated", len(drafts))
        except Exception as e:
            run_logger.error("Step 4 failed (draft generation): %s", e)
            drafts = []
            degraded = True

        if drafts:
            run_logger.info("%d drafts ready for review in the dashboard", len(drafts))

        # Finalize
        run.status = "completed"
        run.degraded_flag = degraded
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        run_logger.info(
            "Daily run completed (degraded=%s, drafts=%d)", degraded, len(drafts)
        )

    except Exception as e:
        logger.error("Pipeline crashed for campaign %d: %s", campaign_id, e)
        if run:
            try:
                run.status = "failed"
                run.completed_at = datetime.now(timezone.utc)
                db.commit()
            except Exception:
                pass
    finally:
        db.close()
