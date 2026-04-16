from __future__ import annotations

import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.backend.core.database import get_db
from app.backend.models.campaign import Campaign
from app.backend.models.daily_run import DailyRun
from app.backend.services.pipeline_service import execute_daily_run

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.get("/{campaign_id}")
def list_runs(
    campaign_id: int,
    db: Session = Depends(get_db),
):
    """List all daily runs for a campaign."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    runs = (
        db.query(DailyRun)
        .filter(DailyRun.campaign_id == campaign_id)
        .order_by(DailyRun.run_date_local.desc())
        .all()
    )
    return {
        "campaign_id": campaign_id,
        "campaign_name": campaign.name,
        "runs": [
            {
                "id": r.id,
                "run_date_local": r.run_date_local,
                "status": r.status,
                "degraded_flag": r.degraded_flag,
                "skip_reason": r.skip_reason,
                "started_at": str(r.started_at) if r.started_at else None,
                "completed_at": str(r.completed_at) if r.completed_at else None,
            }
            for r in runs
        ],
    }


@router.post("/{campaign_id}/trigger")
def trigger_run(
    campaign_id: int,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """Manually trigger a daily run. Use ?force=true to re-run even if today already ran."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status != "active":
        raise HTTPException(status_code=409, detail="Campaign must be active to trigger a run")

    today = str(datetime.now().date())
    existing = (
        db.query(DailyRun)
        .filter(DailyRun.campaign_id == campaign_id, DailyRun.run_date_local == today)
        .first()
    )

    if existing and not force:
        return {
            "detail": f"Run already exists for today ({existing.status}). Use ?force=true to re-run.",
            "campaign_id": campaign_id,
            "existing_run_id": existing.id,
            "status": existing.status,
        }

    if existing and force:
        db.delete(existing)
        db.commit()

    thread = threading.Thread(target=execute_daily_run, args=(campaign_id,), daemon=True)
    thread.start()

    return {
        "detail": f"Daily run triggered for campaign '{campaign.name}'" + (" (forced re-run)" if force else ""),
        "campaign_id": campaign_id,
    }
