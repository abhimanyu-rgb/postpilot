from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.backend.models.campaign import Campaign
from app.backend.models.candidate_opportunity import CandidateOpportunity
from app.backend.models.draft import Draft
from app.backend.models.selected_opportunity import SelectedOpportunity
from app.backend.models.source_signal import SourceSignal

logger = logging.getLogger("orchestrator")

CROSS_CAMPAIGN_DEDUP_DAYS = 14


def _recently_used_source_hashes(db: Session, days: int) -> set[str]:
    """source_hash values referenced by any non-rejected draft created in the last `days`.

    A draft "uses" a hash if it points to a SelectedOpportunity → CandidateOpportunity
    whose source_refs include a SourceSignal with that hash. Rejected drafts don't
    burn the topic — only drafts the user kept (pending_review/approved/queued/published).
    """
    cutoff = datetime.utcnow() - timedelta(days=days)
    drafts = (
        db.query(Draft)
        .filter(Draft.created_at >= cutoff)
        .filter(Draft.status != "rejected")
        .filter(Draft.selected_opportunity_id > 0)
        .all()
    )
    if not drafts:
        return set()

    sel_ids = {d.selected_opportunity_id for d in drafts}
    sels = db.query(SelectedOpportunity).filter(SelectedOpportunity.id.in_(sel_ids)).all()
    candidate_ids = {s.candidate_id for s in sels}
    if not candidate_ids:
        return set()

    candidates = (
        db.query(CandidateOpportunity)
        .filter(CandidateOpportunity.id.in_(candidate_ids))
        .all()
    )
    signal_ids: set[int] = set()
    for c in candidates:
        try:
            refs = json.loads(c.source_refs_json or "[]")
            signal_ids.update(int(r) for r in refs)
        except (ValueError, TypeError):
            continue
    if not signal_ids:
        return set()

    signals = db.query(SourceSignal).filter(SourceSignal.id.in_(signal_ids)).all()
    return {s.source_hash for s in signals if s.source_hash}


def select_opportunities(
    db: Session,
    campaign: Campaign,
    candidates: list[CandidateOpportunity],
    daily_post_budget: int,
    run_logger: logging.Logger,
) -> list[SelectedOpportunity]:
    """Select top N non-suppressed candidates by global_score.

    Deduplicates by similarity_group_id (keeps best per group) and skips
    candidates whose source signals were already used by a non-rejected
    draft in the last CROSS_CAMPAIGN_DEDUP_DAYS days, regardless of campaign.
    """
    viable = [c for c in candidates if c.suppression_reason is None]
    viable.sort(key=lambda c: c.global_score or 0, reverse=True)

    seen_groups: set[str] = set()
    used_hashes = _recently_used_source_hashes(db, CROSS_CAMPAIGN_DEDUP_DAYS)

    # Map signal ids -> source_hash for the candidates we're considering
    candidate_signal_ids: set[int] = set()
    for c in viable:
        try:
            refs = json.loads(c.source_refs_json or "[]")
            candidate_signal_ids.update(int(r) for r in refs)
        except (ValueError, TypeError):
            continue
    signal_hash_map: dict[int, str] = {}
    if candidate_signal_ids:
        for s in db.query(SourceSignal).filter(SourceSignal.id.in_(candidate_signal_ids)).all():
            if s.source_hash:
                signal_hash_map[s.id] = s.source_hash

    deduped: list[CandidateOpportunity] = []
    cross_skipped = 0
    for c in viable:
        if c.similarity_group_id and c.similarity_group_id in seen_groups:
            continue

        try:
            refs = json.loads(c.source_refs_json or "[]")
            ref_hashes = {signal_hash_map.get(int(r)) for r in refs}
            ref_hashes.discard(None)
        except (ValueError, TypeError):
            ref_hashes = set()

        if ref_hashes and ref_hashes & used_hashes:
            cross_skipped += 1
            c.suppression_reason = "cross_campaign_dedup"
            run_logger.info(
                "Cross-campaign dedup: candidate %d (%s) skipped — source already used recently",
                c.id,
                (c.headline or "")[:60],
            )
            continue

        if c.similarity_group_id:
            seen_groups.add(c.similarity_group_id)
        deduped.append(c)

    if cross_skipped:
        db.commit()

    today = str(datetime.now().date())
    selected: list[SelectedOpportunity] = []

    for rank, candidate in enumerate(deduped[:daily_post_budget], start=1):
        sel = SelectedOpportunity(
            candidate_id=candidate.id,
            campaign_id=campaign.id,
            selection_rank=rank,
            selection_date=today,
            selection_reason=f"Top-ranked (global_score={candidate.global_score:.2f})",
        )
        db.add(sel)
        selected.append(sel)

    db.commit()
    run_logger.info(
        "Selected %d opportunities from %d viable candidates (cross-campaign dedup skipped %d)",
        len(selected),
        len(viable),
        cross_skipped,
    )
    return selected
