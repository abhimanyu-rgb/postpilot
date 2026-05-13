from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.backend.core.database import get_db
from app.backend.services import analytics_service

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/posts")
def list_posts(db: Session = Depends(get_db)):
    """Latest engagement snapshot per post, joined with manual feedback if any."""
    bundle = analytics_service.list_analytics_with_drafts(db)
    return {
        "posts": bundle["posts"],
        "threshold": bundle["threshold"],
        "threshold_basis": bundle["threshold_basis"],
        "last_refresh": analytics_service.get_last_refresh(db),
    }


@router.post("/refresh")
def refresh_now(db: Session = Depends(get_db)):
    """On-demand scrape + score + insight extraction. Idempotent within a day."""
    try:
        return analytics_service.refresh_analytics(db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analytics refresh failed: {e}")


@router.get("/insights/staged")
def list_staged_insights(db: Session = Depends(get_db)):
    """Pending insights awaiting human review."""
    return analytics_service.list_pending_insights(db)


@router.post("/insights/{insight_id}/promote")
def promote_insight(insight_id: int, db: Session = Depends(get_db)):
    """Append insight to learned_context."""
    return analytics_service.promote_insight(db, insight_id)


@router.post("/insights/{insight_id}/reject")
def reject_insight(insight_id: int, db: Session = Depends(get_db)):
    """Dismiss an insight."""
    return analytics_service.reject_insight(db, insight_id)
