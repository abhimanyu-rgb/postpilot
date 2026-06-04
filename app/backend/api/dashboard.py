"""Dashboard KPI aggregator.

Pulls reactions from post_analytics (latest snapshot per draft), joins with
PublishedPost for the publish timestamp, computes 7d/30d windows + deltas,
8-week sparkline, top post, approval rate, and learned-signal count."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.backend.core.database import get_db
from app.backend.models.approval_action import ApprovalAction
from app.backend.models.draft import Draft
from app.backend.models.draft_edit import DraftEdit
from app.backend.models.post_analytics import PostAnalytics, StagedInsight
from app.backend.models.published_post import PublishedPost
from app.backend.services.personality_service import get_learned_context

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _latest_reactions_by_draft(db: Session) -> dict[int, tuple[int, datetime | None]]:
    """Return {draft_id: (reactions, published_at)} using latest snapshot per draft."""
    sub = (
        db.query(
            PostAnalytics.draft_id.label("draft_id"),
            func.max(PostAnalytics.scraped_at).label("latest"),
        )
        .group_by(PostAnalytics.draft_id)
        .subquery()
    )
    rows = (
        db.query(PostAnalytics, PublishedPost)
        .join(sub, (sub.c.draft_id == PostAnalytics.draft_id) & (sub.c.latest == PostAnalytics.scraped_at))
        .outerjoin(PublishedPost, PublishedPost.draft_id == PostAnalytics.draft_id)
        .all()
    )
    out: dict[int, tuple[int, datetime | None]] = {}
    for pa, pp in rows:
        reactions = pa.reactions or 0
        pub_at = pp.published_at if pp else None
        if pub_at is not None and pub_at.tzinfo is None:
            pub_at = pub_at.replace(tzinfo=timezone.utc)
        out[pa.draft_id] = (reactions, pub_at)
    return out


def _window_stats(data: dict[int, tuple[int, datetime | None]], start: datetime, end: datetime) -> dict:
    """Aggregate reactions/posts across drafts whose published_at falls in [start, end)."""
    total = 0
    count = 0
    for _, (reactions, pub_at) in data.items():
        if pub_at and start <= pub_at < end:
            total += reactions
            count += 1
    return {"total_reactions": total, "posts": count, "avg": (total / count) if count else 0.0}


def _delta_pct(current: float, prior: float) -> float | None:
    if prior == 0:
        return None
    return round(((current - prior) / prior) * 100, 1)


@router.get("/kpis")
def get_kpis(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    d7 = now - timedelta(days=7)
    d14 = now - timedelta(days=14)
    d30 = now - timedelta(days=30)
    d60 = now - timedelta(days=60)

    reactions_by_draft = _latest_reactions_by_draft(db)

    # --- Reach windows ---
    last7 = _window_stats(reactions_by_draft, d7, now)
    prior7 = _window_stats(reactions_by_draft, d14, d7)
    last30 = _window_stats(reactions_by_draft, d30, now)
    prior30 = _window_stats(reactions_by_draft, d60, d30)

    # --- Top post this week ---
    top_post = None
    top_reactions = -1
    for draft_id, (reactions, pub_at) in reactions_by_draft.items():
        if pub_at and d7 <= pub_at < now and reactions > top_reactions:
            top_reactions = reactions
            top_post = (draft_id, reactions, pub_at)
    top_post_payload = None
    if top_post:
        draft = db.query(Draft).filter(Draft.id == top_post[0]).first()
        if draft:
            first_line = (draft.primary_text or "").split("\n")[0][:140]
            top_post_payload = {
                "draft_id": draft.id,
                "reactions": top_post[1],
                "published_at": top_post[2].isoformat() if top_post[2] else None,
                "first_line": first_line,
            }

    # --- 8-week sparkline of weekly avg reactions ---
    sparkline: list[dict] = []
    for w in range(8, 0, -1):
        ws = now - timedelta(days=7 * w)
        we = now - timedelta(days=7 * (w - 1))
        stats = _window_stats(reactions_by_draft, ws, we)
        sparkline.append({
            "week_start": ws.date().isoformat(),
            "avg_reactions": round(stats["avg"], 1),
            "posts": stats["posts"],
        })

    # --- % of posts above own median (last 30d) ---
    last30_reactions = [r for _, (r, p) in reactions_by_draft.items() if p and d30 <= p < now]
    pct_above_median = None
    if len(last30_reactions) >= 4:
        sorted_r = sorted(last30_reactions)
        mid = len(sorted_r) // 2
        median = sorted_r[mid] if len(sorted_r) % 2 else (sorted_r[mid - 1] + sorted_r[mid]) / 2
        above = sum(1 for r in last30_reactions if r > median)
        pct_above_median = round((above / len(last30_reactions)) * 100, 1)

    # --- Approval rate (last 30d) ---
    approval_actions = (
        db.query(ApprovalAction.action_type, func.count(ApprovalAction.id))
        .filter(ApprovalAction.created_at >= d30)
        .filter(ApprovalAction.action_type.in_(["approved", "rejected"]))
        .group_by(ApprovalAction.action_type)
        .all()
    )
    counts = {t: int(c) for t, c in approval_actions}
    approved_n = counts.get("approved", 0)
    rejected_n = counts.get("rejected", 0)
    total_actions = approved_n + rejected_n
    approval_rate = round((approved_n / total_actions) * 100, 1) if total_actions else None

    # --- Pipeline counts ---
    published_7d = sum(1 for _, (_, p) in reactions_by_draft.items() if p and d7 <= p < now)
    published_30d = sum(1 for _, (_, p) in reactions_by_draft.items() if p and d30 <= p < now)
    # Fallback for posts not in analytics yet — count from PublishedPost directly
    published_7d_pp = db.query(PublishedPost).filter(PublishedPost.published_at >= d7).count()
    published_30d_pp = db.query(PublishedPost).filter(PublishedPost.published_at >= d30).count()
    published_7d = max(published_7d, published_7d_pp)
    published_30d = max(published_30d, published_30d_pp)

    pending_review = db.query(Draft).filter(Draft.status == "pending_review").count()

    # --- Learned signals active ---
    promoted_insights = db.query(StagedInsight).filter(StagedInsight.status == "promoted").count()
    promoted_edits = (
        db.query(DraftEdit.edit_type)
        .filter(DraftEdit.promoted_at.isnot(None))
        .distinct()
        .count()
    )
    learned_ctx = (get_learned_context() or "").strip()
    learned_lines = sum(1 for ln in learned_ctx.split("\n") if ln.strip().startswith("-"))

    return {
        "reach": {
            "last_7d": {
                "total_reactions": last7["total_reactions"],
                "posts": last7["posts"],
                "delta_pct_vs_prior_7d": _delta_pct(last7["total_reactions"], prior7["total_reactions"]),
            },
            "last_30d": {
                "avg_reactions_per_post": round(last30["avg"], 1),
                "posts": last30["posts"],
                "delta_pct_vs_prior_30d": _delta_pct(last30["avg"], prior30["avg"]),
            },
            "top_post_this_week": top_post_payload,
        },
        "engagement_quality": {
            "weekly_sparkline": sparkline,
            "pct_above_own_median_30d": pct_above_median,
            "learned_signals_active": {
                "promoted_insights": promoted_insights,
                "promoted_edit_types": promoted_edits,
                "learned_context_lines": learned_lines,
                "total": promoted_insights + promoted_edits,
            },
        },
        "pipeline": {
            "published_7d": published_7d,
            "published_30d": published_30d,
            "approval_rate_30d_pct": approval_rate,
            "approved_30d": approved_n,
            "rejected_30d": rejected_n,
            "pending_review": pending_review,
        },
    }
