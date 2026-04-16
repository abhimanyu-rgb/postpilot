from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.backend.core.database import get_db
from app.backend.schemas.campaign import (
    ActiveCountResponse,
    CampaignCreate,
    CampaignListResponse,
    CampaignResponse,
    CampaignUpdate,
)
from app.backend.services import campaign_service

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


@router.get("/", response_model=CampaignListResponse)
def list_campaigns(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    campaigns = campaign_service.list_campaigns(db, status_filter=status)
    active_count = campaign_service.get_active_count(db)
    return CampaignListResponse(
        campaigns=[CampaignResponse.model_validate(c) for c in campaigns],
        active_count=active_count,
    )


@router.post("/", response_model=CampaignResponse, status_code=201)
def create_campaign(data: CampaignCreate, db: Session = Depends(get_db)):
    campaign = campaign_service.create_campaign(db, data)
    return CampaignResponse.model_validate(campaign)


@router.get("/active-count", response_model=ActiveCountResponse)
def active_count(db: Session = Depends(get_db)):
    count = campaign_service.get_active_count(db)
    return ActiveCountResponse(active_count=count)


@router.get("/{campaign_id}", response_model=CampaignResponse)
def get_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign = campaign_service.get_campaign(db, campaign_id)
    return CampaignResponse.model_validate(campaign)


@router.put("/{campaign_id}", response_model=CampaignResponse)
def update_campaign(campaign_id: int, data: CampaignUpdate, db: Session = Depends(get_db)):
    campaign = campaign_service.update_campaign(db, campaign_id, data)
    return CampaignResponse.model_validate(campaign)


@router.post("/{campaign_id}/activate", response_model=CampaignResponse)
def activate_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign = campaign_service.activate_campaign(db, campaign_id)
    return CampaignResponse.model_validate(campaign)


@router.post("/{campaign_id}/pause", response_model=CampaignResponse)
def pause_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign = campaign_service.pause_campaign(db, campaign_id)
    return CampaignResponse.model_validate(campaign)


@router.post("/{campaign_id}/archive", response_model=CampaignResponse)
def archive_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign = campaign_service.archive_campaign(db, campaign_id)
    return CampaignResponse.model_validate(campaign)


@router.delete("/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: int, db: Session = Depends(get_db)):
    campaign_service.delete_campaign(db, campaign_id)
    return None
