import json
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.backend.core.scheduler import add_campaign_job, remove_campaign_job
from app.backend.models.campaign import Campaign
from app.backend.schemas.campaign import CampaignCreate, CampaignUpdate

logger = logging.getLogger("orchestrator")

MAX_ACTIVE_CAMPAIGNS = 3
VALID_STATUSES = {"draft", "active", "paused", "completed", "archived"}


def get_active_count(db: Session) -> int:
    return db.query(Campaign).filter(Campaign.status == "active").count()


def list_campaigns(db: Session, status_filter: str | None = None) -> list[Campaign]:
    from sqlalchemy import case

    query = db.query(Campaign)
    if status_filter and status_filter in VALID_STATUSES:
        query = query.filter(Campaign.status == status_filter)

    # Active first, then draft, paused, rest. Then alphabetical by name.
    status_order = case(
        (Campaign.status == "active", 0),
        (Campaign.status == "draft", 1),
        (Campaign.status == "paused", 2),
        else_=3,
    )
    return query.order_by(status_order, Campaign.name).all()


def get_campaign(db: Session, campaign_id: int) -> Campaign:
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


def create_campaign(db: Session, data: CampaignCreate) -> Campaign:
    campaign = Campaign(
        name=data.name,
        status="draft",
        topics_json=json.dumps(data.topics_json),
        persona=data.persona,
        tone=data.tone,
        frequency=data.frequency,
        posting_window_start=data.posting_window_start,
        posting_window_end=data.posting_window_end,
        duration_rule_json=json.dumps(data.duration_rule_json) if data.duration_rule_json else None,
        significance_threshold=data.significance_threshold,
        source_preferences_json=json.dumps(data.source_preferences_json),
        novelty_cooldown_days=data.novelty_cooldown_days,
        profile_adherence_override=data.profile_adherence_override,
        custom_rss_feeds_json=json.dumps(data.custom_rss_feeds_json) if data.custom_rss_feeds_json else None,
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    logger.info("Campaign created: %s (id=%d)", campaign.name, campaign.id)
    return campaign


def update_campaign(db: Session, campaign_id: int, data: CampaignUpdate) -> Campaign:
    campaign = get_campaign(db, campaign_id)
    if campaign.status == "archived":
        raise HTTPException(status_code=409, detail="Cannot edit an archived campaign")

    update_fields = data.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        if field == "topics_json" and value is not None:
            setattr(campaign, field, json.dumps(value))
        elif field == "source_preferences_json" and value is not None:
            setattr(campaign, field, json.dumps(value))
        elif field == "duration_rule_json" and value is not None:
            setattr(campaign, field, json.dumps(value))
        elif field == "custom_rss_feeds_json" and value is not None:
            setattr(campaign, field, json.dumps(value))
        elif value is not None:
            setattr(campaign, field, value)

    db.commit()
    db.refresh(campaign)
    logger.info("Campaign updated: %s (id=%d)", campaign.name, campaign.id)
    return campaign


def activate_campaign(db: Session, campaign_id: int) -> Campaign:
    campaign = get_campaign(db, campaign_id)

    if campaign.status == "active":
        raise HTTPException(status_code=409, detail="Campaign is already active")
    if campaign.status == "archived":
        raise HTTPException(status_code=409, detail="Cannot activate an archived campaign")

    active_count = get_active_count(db)
    if active_count >= MAX_ACTIVE_CAMPAIGNS:
        raise HTTPException(
            status_code=409,
            detail=f"Maximum {MAX_ACTIVE_CAMPAIGNS} active campaigns allowed. "
            "Pause or archive an existing campaign first.",
        )

    _validate_for_activation(campaign)

    campaign.status = "active"
    db.commit()
    db.refresh(campaign)
    add_campaign_job(campaign.id)
    logger.info("Campaign activated: %s (id=%d)", campaign.name, campaign.id)
    return campaign


def pause_campaign(db: Session, campaign_id: int) -> Campaign:
    campaign = get_campaign(db, campaign_id)
    if campaign.status != "active":
        raise HTTPException(status_code=409, detail="Only active campaigns can be paused")

    campaign.status = "paused"
    db.commit()
    db.refresh(campaign)
    remove_campaign_job(campaign.id)
    logger.info("Campaign paused: %s (id=%d)", campaign.name, campaign.id)
    return campaign


def archive_campaign(db: Session, campaign_id: int) -> Campaign:
    campaign = get_campaign(db, campaign_id)
    if campaign.status in ("archived", "completed"):
        raise HTTPException(status_code=409, detail=f"Campaign is already {campaign.status}")

    campaign.status = "archived"
    db.commit()
    db.refresh(campaign)
    remove_campaign_job(campaign.id)
    logger.info("Campaign archived: %s (id=%d)", campaign.name, campaign.id)
    return campaign


def delete_campaign(db: Session, campaign_id: int) -> None:
    campaign = get_campaign(db, campaign_id)
    if campaign.status == "active":
        raise HTTPException(
            status_code=409, detail="Cannot delete an active campaign. Pause or archive it first."
        )

    remove_campaign_job(campaign.id)
    db.delete(campaign)
    db.commit()
    logger.info("Campaign deleted: %s (id=%d)", campaign.name, campaign.id)


def _validate_for_activation(campaign: Campaign) -> None:
    errors = []
    if not campaign.name:
        errors.append("Campaign name is required")
    try:
        topics = json.loads(campaign.topics_json)
        if not topics:
            errors.append("At least one topic is required")
    except (json.JSONDecodeError, TypeError):
        errors.append("Invalid topics configuration")
    if not campaign.persona:
        errors.append("Persona is required")
    if not campaign.tone:
        errors.append("Tone is required")
    try:
        sources = json.loads(campaign.source_preferences_json)
        if not sources:
            errors.append("At least one source type must be enabled")
    except (json.JSONDecodeError, TypeError):
        errors.append("Invalid source preferences")

    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))
