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


def _posts_with_reactions(db: Session) -> dict[int, tuple[int | None, datetime | None]]:
    """Return {draft_id: (reactions_or_None, published_at)} for every published post.

    Starts from PublishedPost so posts not yet scraped still appear (reactions=None).
    Reactions come from the latest post_analytics snapshot when available.
    """
    sub = (
        db.query(
            PostAnalytics.draft_id.label("draft_id"),
            func.max(PostAnalytics.scraped_at).label("latest"),
        )
        .group_by(PostAnalytics.draft_id)
        .subquery()
    )
    analytics_rows = (
        db.query(PostAnalytics)
        .join(sub, (sub.c.draft_id == PostAnalytics.draft_id) & (sub.c.latest == PostAnalytics.scraped_at))
        .all()
    )
    latest_by_draft = {pa.draft_id: pa.reactions for pa in analytics_rows}

    out: dict[int, tuple[int | None, datetime | None]] = {}
    for pp in db.query(PublishedPost).all():
        pub_at = pp.published_at
        if pub_at is not None and pub_at.tzinfo is None:
            pub_at = pub_at.replace(tzinfo=timezone.utc)
        out[pp.draft_id] = (latest_by_draft.get(pp.draft_id), pub_at)
    return out


def _window_stats(data: dict[int, tuple[int | None, datetime | None]], start: datetime, end: datetime) -> dict:
    """Aggregate reactions/posts across drafts whose published_at falls in [start, end).

    Posts with no reaction snapshot yet are still counted in 'posts' but excluded from
    reaction totals (so avg stays meaningful)."""
    total = 0
    count = 0
    scored_count = 0
    for _, (reactions, pub_at) in data.items():
        if pub_at and start <= pub_at < end:
            count += 1
            if reactions is not None:
                total += reactions
                scored_count += 1
    return {
        "total_reactions": total,
        "posts": count,
        "scored_posts": scored_count,
        "avg": (total / scored_count) if scored_count else 0.0,
    }


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

    reactions_by_draft = _posts_with_reactions(db)

    # --- Reach windows ---
    last7 = _window_stats(reactions_by_draft, d7, now)
    prior7 = _window_stats(reactions_by_draft, d14, d7)
    last30 = _window_stats(reactions_by_draft, d30, now)
    prior30 = _window_stats(reactions_by_draft, d60, d30)

    # --- Top post this week ---
    # Prefer the highest-reaction post; if none scraped yet, fall back to the most recent
    # publish so the card still shows a post (with reactions=None → "pending scrape" in UI).
    top_with_reactions = None
    top_reactions_val = -1
    most_recent = None
    most_recent_at: datetime | None = None
    for draft_id, (reactions, pub_at) in reactions_by_draft.items():
        if not pub_at or not (d7 <= pub_at < now):
            continue
        if reactions is not None and reactions > top_reactions_val:
            top_reactions_val = reactions
            top_with_reactions = (draft_id, reactions, pub_at)
        if most_recent_at is None or pub_at > most_recent_at:
            most_recent_at = pub_at
            most_recent = (draft_id, reactions, pub_at)
    top_candidate = top_with_reactions or most_recent

    top_post_payload = None
    if top_candidate:
        draft = db.query(Draft).filter(Draft.id == top_candidate[0]).first()
        if draft:
            first_line = (draft.primary_text or "").split("\n")[0][:140]
            top_post_payload = {
                "draft_id": draft.id,
                "reactions": top_candidate[1],
                "published_at": top_candidate[2].isoformat() if top_candidate[2] else None,
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
            "week_end": (we - timedelta(days=1)).date().isoformat(),
            "label": f"{ws.strftime('%b %d')}–{(we - timedelta(days=1)).strftime('%b %d')}",
            "avg_reactions": round(stats["avg"], 1),
            "posts": stats["posts"],
            "scored_posts": stats["scored_posts"],
            "total_reactions": stats["total_reactions"],
        })

    # --- % of posts above own median (last 30d) ---
    last30_reactions = [r for _, (r, p) in reactions_by_draft.items() if p and d30 <= p < now and r is not None]
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
