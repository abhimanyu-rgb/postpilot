from datetime import datetime

from pydantic import BaseModel, Field


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    topics_json: list[str] = Field(min_length=1)
    persona: str = Field(min_length=1)
    tone: str = Field(min_length=1)
    frequency: str = Field(min_length=1)
    posting_window_start: str | None = None
    posting_window_end: str | None = None
    duration_rule_json: dict | None = None
    significance_threshold: float = Field(ge=0.0, le=1.0, default=0.5)
    source_preferences_json: list[str] = Field(min_length=1)
    novelty_cooldown_days: int = Field(ge=1, le=30, default=3)
    profile_adherence_override: str | None = None
    custom_rss_feeds_json: list[str] | None = None
    prompt_avoid: str | None = None
    prompt_prioritize: str | None = None
    prompt_archetypes: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    topics_json: list[str] | None = Field(default=None, min_length=1)
    persona: str | None = Field(default=None, min_length=1)
    tone: str | None = Field(default=None, min_length=1)
    frequency: str | None = Field(default=None, min_length=1)
    posting_window_start: str | None = None
    posting_window_end: str | None = None
    duration_rule_json: dict | None = None
    significance_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    source_preferences_json: list[str] | None = Field(default=None, min_length=1)
    novelty_cooldown_days: int | None = Field(default=None, ge=1, le=30)
    profile_adherence_override: str | None = None
    custom_rss_feeds_json: list[str] | None = None
    prompt_avoid: str | None = None
    prompt_prioritize: str | None = None
    prompt_archetypes: str | None = None


class CampaignResponse(BaseModel):
    id: int
    name: str
    status: str
    topics_json: str
    persona: str
    tone: str
    frequency: str
    posting_window_start: str | None
    posting_window_end: str | None
    duration_rule_json: str | None
    significance_threshold: float
    source_preferences_json: str
    novelty_cooldown_days: int
    profile_adherence_override: str | None
    custom_rss_feeds_json: str | None
    prompt_avoid: str | None
    prompt_prioritize: str | None
    prompt_archetypes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CampaignListResponse(BaseModel):
    campaigns: list[CampaignResponse]
    active_count: int
    max_active: int = 3


class ActiveCountResponse(BaseModel):
    active_count: int
    max_active: int = 3
