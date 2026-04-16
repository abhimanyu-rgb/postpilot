from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.backend.models.campaign import Campaign
from app.backend.models.candidate_opportunity import CandidateOpportunity
from app.backend.models.selected_opportunity import SelectedOpportunity

logger = logging.getLogger("orchestrator")


def select_opportunities(
    db: Session,
    campaign: Campaign,
    candidates: list[CandidateOpportunity],
    daily_post_budget: int,
    run_logger: logging.Logger,
) -> list[SelectedOpportunity]:
    """Select top N non-suppressed candidates by global_score.

    Deduplicates by similarity_group_id (keeps best per group).
    """
    viable = [c for c in candidates if c.suppression_reason is None]
    viable.sort(key=lambda c: c.global_score or 0, reverse=True)

    seen_groups: set[str] = set()
    deduped: list[CandidateOpportunity] = []
    for c in viable:
        if c.similarity_group_id and c.similarity_group_id in seen_groups:
            continue
        if c.similarity_group_id:
            seen_groups.add(c.similarity_group_id)
        deduped.append(c)

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
    run_logger.info("Selected %d opportunities from %d viable candidates", len(selected), len(viable))
    return selected
