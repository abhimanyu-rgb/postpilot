"""Monthly diagnostic insights from rejection patterns.

Strategy: aggregate the last 30 days of rejections deterministically in Python
(counts by tag, per-campaign rejection rates, learned_context lines that show
up in repetition warnings). Send the small structured aggregate to Claude for
diagnosis + 1–3 concrete recommended actions. Cache the result so it doesn't
re-run on every page view."""
from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

import anthropic
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.models.approval_action import ApprovalAction
from app.backend.models.campaign import Campaign
from app.backend.models.draft import Draft
from app.backend.models.selected_opportunity import SelectedOpportunity
from app.backend.services.personality_service import get_learned_context
from app.backend.services.token_tracker import track_usage

logger = logging.getLogger("orchestrator")

LOOKBACK_DAYS = 30
MIN_REJECTIONS_FOR_INSIGHTS = 5
HIGH_REJECTION_RATE_THRESHOLD = 0.6


def _draft_campaign_id(db: Session, draft_id: int) -> int | None:
    draft = db.query(Draft).filter(Draft.id == draft_id).first()
    if not draft or draft.selected_opportunity_id == 0:
        return None
    sel = (
        db.query(SelectedOpportunity)
        .filter(SelectedOpportunity.id == draft.selected_opportunity_id)
        .first()
    )
    return sel.campaign_id if sel else None


def build_rejection_aggregate(db: Session) -> dict:
    """Aggregate 30d rejection data — pure Python, no LLM. This is the input to
    the diagnosis call AND can be rendered standalone if Claude is unavailable."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=LOOKBACK_DAYS)

    actions = (
        db.query(ApprovalAction)
        .filter(ApprovalAction.created_at >= cutoff)
        .all()
    )
    rejected = [a for a in actions if a.action_type == "rejected"]
    approved = [a for a in actions if a.action_type == "approved"]

    by_reason = Counter(a.rejection_reason or "untagged" for a in rejected)

    # Per-campaign rejection rate
    campaign_stats: dict[int, dict] = {}
    for a in rejected:
        cid = _draft_campaign_id(db, a.draft_id)
        if cid is None:
            continue
        s = campaign_stats.setdefault(cid, {"rejected": 0, "approved": 0, "reasons": Counter()})
        s["rejected"] += 1
        s["reasons"][a.rejection_reason or "untagged"] += 1
    for a in approved:
        cid = _draft_campaign_id(db, a.draft_id)
        if cid is None:
            continue
        s = campaign_stats.setdefault(cid, {"rejected": 0, "approved": 0, "reasons": Counter()})
        s["approved"] += 1

    campaign_breakdown = []
    for cid, s in campaign_stats.items():
        campaign = db.query(Campaign).filter(Campaign.id == cid).first()
        total = s["rejected"] + s["approved"]
        rate = (s["rejected"] / total) if total else 0.0
        campaign_breakdown.append({
            "campaign_id": cid,
            "campaign_name": campaign.name if campaign else f"Campaign #{cid}",
            "campaign_status": campaign.status if campaign else "unknown",
            "rejected": s["rejected"],
            "approved": s["approved"],
            "total": total,
            "rejection_rate": round(rate, 3),
            "top_reasons": dict(s["reasons"].most_common(3)),
            "is_high_rejection": rate >= HIGH_REJECTION_RATE_THRESHOLD and total >= 3,
        })
    campaign_breakdown.sort(key=lambda c: c["rejection_rate"], reverse=True)

    return {
        "window_days": LOOKBACK_DAYS,
        "window_start": cutoff.date().isoformat(),
        "window_end": now.date().isoformat(),
        "total_rejected": len(rejected),
        "total_approved": len(approved),
        "rejection_rate_overall": round(len(rejected) / max(1, len(rejected) + len(approved)), 3),
        "reasons": dict(by_reason),
        "tagged_share": round(
            sum(c for r, c in by_reason.items() if r != "untagged") / max(1, len(rejected)),
            3,
        ),
        "campaigns": campaign_breakdown,
    }


def _diagnose_with_claude(aggregate: dict, learned_context: str) -> dict | None:
    """One Claude call: structured aggregate in, diagnosis + recommendations out.

    Input is tiny (a JSON blob of counts), so this is cheap. Haiku is sufficient
    — we're reasoning over numbers, not interpreting subtle text."""
    if aggregate["total_rejected"] < MIN_REJECTIONS_FOR_INSIGHTS:
        return None

    learned_block = learned_context.strip() or "(empty)"
    aggregate_json = json.dumps(aggregate, indent=2)

    prompt = f"""You are a diagnostic assistant for a LinkedIn content orchestrator. Given a 30-day rejection-pattern aggregate, identify what's driving rejections and recommend 1–3 concrete actions.

REJECTION AGGREGATE (30 days):
{aggregate_json}

CURRENT LEARNED CONTEXT (lines auto-promoted from feedback + edit corrections; user-editable):
{learned_block}

Your job:
1. Read the aggregate. What's the dominant story? (Examples: "repetition fatigue concentrated in one campaign", "memory drift after the personality update", "one over-guardrailed campaign exhausted its topic space")
2. Identify which campaigns are problematic (high rejection rate AND meaningful volume).
3. Identify whether the learned_context is contributing — does any line look like it's forcing repetition (e.g., a hook pattern over-used)?
4. Recommend 1–3 actions. Be specific. Examples of good recommendations:
   - "Pause campaign 'Agentic AI' — 78% rejection rate (9/12 due to repetition). Topic space looks exhausted."
   - "Refine learned line '[hooks] Use system-level challenges' — likely driving repetition fatigue across campaigns."
   - "Drift rejections cluster in last 7d — voice may have shifted. Manually refresh voice_snapshot or review recent published posts."

Return ONLY a JSON object:
{{
  "headline": "<one sentence summarizing the dominant pattern>",
  "diagnosis": "<2-3 sentence explanation of what's happening, citing specific counts>",
  "problem_campaigns": [{{"campaign_id": <id>, "campaign_name": "<name>", "issue": "<one phrase>"}}],
  "problem_memory": [{{"line": "<the problematic learned_context line, verbatim>", "why": "<one phrase>"}}],
  "recommendations": [{{"action": "pause_campaign|edit_memory|refresh_voice|review_personality|other", "detail": "<concrete action with specifics>"}}]
}}

If the aggregate is genuinely healthy (rejection rate low or evenly distributed), return:
{{"headline": "Healthy — no concerning patterns this month", "diagnosis": "...", "problem_campaigns": [], "problem_memory": [], "recommendations": []}}"""

    try:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        track_usage(response, service="insights_diagnosis")

        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = "\n".join(text.split("\n")[1:])
            if text.endswith("```"):
                text = text[:-3]
        return json.loads(text)
    except Exception as e:
        logger.warning("Insights diagnosis failed: %s", e)
        return None


def generate_insights(db: Session) -> dict:
    """Top-level: aggregate + diagnose. Returns a payload ready for the UI."""
    aggregate = build_rejection_aggregate(db)
    diagnosis = None
    if aggregate["total_rejected"] >= MIN_REJECTIONS_FOR_INSIGHTS:
        learned = get_learned_context() or ""
        diagnosis = _diagnose_with_claude(aggregate, learned)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aggregate": aggregate,
        "diagnosis": diagnosis,
        "min_rejections_required": MIN_REJECTIONS_FOR_INSIGHTS,
    }
