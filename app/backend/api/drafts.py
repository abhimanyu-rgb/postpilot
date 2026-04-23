from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backend.core.database import get_db
from app.backend.services import draft_review_service
from app.backend.services.feedback_service import get_feedback, save_feedback
from app.backend.services.media_service import suggest_media_for_draft
from app.backend.services.publish_service import queue_for_publish

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


class DraftEditRequest(BaseModel):
    primary_text: str


class DraftPolishRequest(BaseModel):
    instructions: str = ""
    current_text: str | None = None


class UserDraftRequest(BaseModel):
    topic: str
    notes: str = ""
    enrich_with_sources: bool = True
    posting_window_start: str = "09:00"
    posting_window_end: str = "18:00"


@router.post("/write")
def write_user_draft(
    data: UserDraftRequest,
    db: Session = Depends(get_db),
):
    """Generate a draft from a user-provided topic."""
    from app.backend.services.user_draft_service import generate_user_draft
    return generate_user_draft(
        db,
        data.topic,
        data.notes,
        data.enrich_with_sources,
        posting_window_start=data.posting_window_start,
        posting_window_end=data.posting_window_end,
    )


@router.get("/")
def list_drafts(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """List drafts, optionally filtered by status."""
    return draft_review_service.list_drafts(db, status_filter=status)


@router.post("/{draft_id}/approve")
def approve_draft(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Approve a draft for publishing."""
    return draft_review_service.approve_draft(db, draft_id)


@router.post("/{draft_id}/reject")
def reject_draft(
    draft_id: int,
    reason: str = Query(default=""),
    db: Session = Depends(get_db),
):
    """Reject a draft."""
    return draft_review_service.reject_draft(db, draft_id, reason)


@router.get("/{draft_id}/duplicate-check")
def check_duplicate(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Check if a draft's topic overlaps with recent published posts."""
    from datetime import datetime, timedelta, timezone
    draft = db.query(draft_review_service.Draft).filter(draft_review_service.Draft.id == draft_id).first()
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")

    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    recent = (
        db.query(draft_review_service.PublishedPost)
        .filter(draft_review_service.PublishedPost.published_at >= cutoff)
        .all()
    )

    if not recent:
        return {"has_overlap": False}

    draft_words = set(draft.primary_text.lower().split())
    for pub in recent:
        pub_draft = db.query(draft_review_service.Draft).filter(draft_review_service.Draft.id == pub.draft_id).first()
        if not pub_draft:
            continue
        pub_words = set(pub_draft.primary_text.lower().split())
        overlap = len(draft_words & pub_words) / max(len(draft_words | pub_words), 1)
        if overlap > 0.3:
            return {
                "has_overlap": True,
                "similarity": round(overlap * 100),
                "similar_headline": pub_draft.primary_text[:80] + "...",
                "published_date": str(pub.published_at)[:10] if pub.published_at else "",
            }

    return {"has_overlap": False}


@router.get("/{draft_id}/drift-check")
def check_draft_drift(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Check if a draft contradicts recent published positions."""
    draft = db.query(draft_review_service.Draft).filter(
        draft_review_service.Draft.id == draft_id
    ).first()
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")
    from app.backend.services.voice_memory import check_drift
    result = check_drift(db, draft.primary_text)
    return result or {"has_drift": False}


@router.post("/{draft_id}/revert")
def revert_to_review(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Revert a draft back to pending_review status."""
    draft = db.query(draft_review_service.Draft).filter(
        draft_review_service.Draft.id == draft_id
    ).first()
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")
    if draft.status == "published":
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Cannot revert a published post")
    draft.status = "pending_review"
    db.commit()
    return {"id": draft.id, "status": "pending_review"}


@router.post("/{draft_id}/archive")
def archive_draft(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Archive a draft to hide from history."""
    draft = db.query(draft_review_service.Draft).filter(
        draft_review_service.Draft.id == draft_id
    ).first()
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.status = "archived"
    db.commit()
    return {"id": draft.id, "status": "archived"}


@router.delete("/{draft_id}")
def delete_draft(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Permanently delete a draft."""
    draft = db.query(draft_review_service.Draft).filter(
        draft_review_service.Draft.id == draft_id
    ).first()
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")
    db.delete(draft)
    db.commit()
    return None


@router.put("/{draft_id}/text")
def update_draft_text(
    draft_id: int,
    data: DraftEditRequest,
    db: Session = Depends(get_db),
):
    """Save manual edits to a draft's text."""
    return draft_review_service.update_draft_text(db, draft_id, data.primary_text)


@router.post("/{draft_id}/polish")
def polish_draft(
    draft_id: int,
    data: DraftPolishRequest,
    db: Session = Depends(get_db),
):
    """Use Claude to polish/rewrite a draft."""
    return draft_review_service.polish_draft(db, draft_id, data.instructions, current_text=data.current_text)


@router.get("/{draft_id}/alternates")
def get_alternates(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Get alternate candidate ideas from the same run."""
    return draft_review_service.get_alternate_ideas(db, draft_id)


@router.post("/generate-from-candidate/{candidate_id}")
def generate_from_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
):
    """Generate a new draft from an alternate candidate idea."""
    return draft_review_service.generate_draft_for_candidate(db, candidate_id)


@router.get("/{draft_id}/media")
def get_media_suggestions(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Get or generate media suggestions (images + links) for a draft."""
    return suggest_media_for_draft(db, draft_id)


class SelectedMediaRequest(BaseModel):
    selected_media: list[str]


@router.put("/{draft_id}/media")
def save_selected_media(
    draft_id: int,
    data: SelectedMediaRequest,
    db: Session = Depends(get_db),
):
    """Save user's media selection for a draft."""
    import json
    draft = db.query(draft_review_service.Draft).filter(
        draft_review_service.Draft.id == draft_id
    ).first()
    if not draft:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Draft not found")
    draft.selected_media_json = json.dumps(data.selected_media)
    db.commit()
    return {"id": draft.id, "selected_count": len(data.selected_media)}


@router.post("/{draft_id}/publish")
def publish_to_linkedin(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Queue an approved draft for publishing within the campaign's time slot."""
    return queue_for_publish(db, draft_id)




class FeedbackRequest(BaseModel):
    campaign_id: int
    impressions: int | None = None
    reactions: int | None = None
    comments: int | None = None
    reposts: int | None = None
    clicks: int | None = None
    performance_rating: str | None = None
    what_worked: str | None = None
    what_didnt_work: str | None = None
    audience_reaction_notes: str | None = None
    improvement_notes: str | None = None
    effective_elements: list[str] | None = None


@router.get("/{draft_id}/feedback")
def get_draft_feedback(
    draft_id: int,
    db: Session = Depends(get_db),
):
    """Get feedback for a specific draft."""
    return get_feedback(db, draft_id)


@router.put("/{draft_id}/feedback")
def save_draft_feedback(
    draft_id: int,
    data: FeedbackRequest,
    db: Session = Depends(get_db),
):
    """Save or update feedback for a published draft."""
    from app.backend.services.feedback_service import _serialize
    fb = save_feedback(db, draft_id, data.campaign_id, data.model_dump(exclude={"campaign_id"}))
    return _serialize(fb)
