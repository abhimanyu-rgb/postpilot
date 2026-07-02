"""Track token usage across all Claude API calls.

Records every LLM call with input/output/cache tokens and estimated cost.
Provides weekly/monthly aggregation for the dashboard.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import anthropic
from sqlalchemy.orm import Session

from app.backend.core.database import SessionLocal
from app.backend.models.token_usage import TokenUsage

logger = logging.getLogger("orchestrator")

# Pricing per million tokens (as of 2025)
PRICING = {
    "claude-sonnet-4-6": {
        "input": 3.0 / 1_000_000,
        "output": 15.0 / 1_000_000,
        "cache_read": 0.30 / 1_000_000,
        "cache_creation": 3.75 / 1_000_000,
    },
    "claude-haiku-4-5": {
        "input": 0.80 / 1_000_000,
        "output": 4.0 / 1_000_000,
        "cache_read": 0.08 / 1_000_000,
        "cache_creation": 1.0 / 1_000_000,
    },
}
DEFAULT_PRICING = {"input": 3.0 / 1_000_000, "output": 15.0 / 1_000_000, "cache_read": 0.30 / 1_000_000, "cache_creation": 3.75 / 1_000_000}


def track_usage(
    response: anthropic.types.Message,
    service: str,
    model: str = "claude-sonnet-4-6",
    campaign_id: int | None = None,
    draft_id: int | None = None,
) -> None:
    """Record token usage from a Claude API response."""
    usage = response.usage
    input_tokens = usage.input_tokens or 0
    output_tokens = usage.output_tokens or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_creation = getattr(usage, "cache_creation_input_tokens", 0) or 0
    total = input_tokens + output_tokens

    prices = PRICING.get(model, DEFAULT_PRICING)
    cost = (
        input_tokens * prices["input"]
        + output_tokens * prices["output"]
        + cache_read * prices["cache_read"]
        + cache_creation * prices["cache_creation"]
    )

    db = SessionLocal()
    try:
        record = TokenUsage(
            service=service,
            campaign_id=campaign_id,
            draft_id=draft_id,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read,
            cache_creation_tokens=cache_creation,
            total_tokens=total,
            estimated_cost_usd=round(cost, 6),
        )
        db.add(record)
        db.commit()
    except Exception as e:
        logger.debug("Token tracking failed: %s", e)
    finally:
        db.close()


def get_usage_stats(db: Session) -> dict:
    """Get token usage aggregated by week, month, year-to-date, and all-time."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    year_start = datetime(now.year, 1, 1, tzinfo=timezone.utc)

    week_records = db.query(TokenUsage).filter(TokenUsage.created_at >= week_ago).all()
    month_records = db.query(TokenUsage).filter(TokenUsage.created_at >= month_ago).all()
    ytd_records = db.query(TokenUsage).filter(TokenUsage.created_at >= year_start).all()
    all_records = db.query(TokenUsage).all()

    def _aggregate(records: list[TokenUsage]) -> dict:
        total_input = sum(r.input_tokens for r in records)
        total_output = sum(r.output_tokens for r in records)
        total_cache_read = sum(r.cache_read_tokens for r in records)
        total_cost = sum(r.estimated_cost_usd for r in records)
        by_service: dict[str, int] = {}
        for r in records:
            by_service[r.service] = by_service.get(r.service, 0) + r.total_tokens
        return {
            "calls": len(records),
            "input_tokens": total_input,
            "output_tokens": total_output,
            "cache_read_tokens": total_cache_read,
            "total_tokens": total_input + total_output,
            "estimated_cost_usd": round(total_cost, 4),
            "by_service": by_service,
        }

    return {
        "week": _aggregate(week_records),
        "month": _aggregate(month_records),
        "ytd": _aggregate(ytd_records),
        "ytd_year": now.year,
        "all_time": _aggregate(all_records),
    }
