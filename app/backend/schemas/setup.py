from pydantic import BaseModel, Field


class SetupStatusResponse(BaseModel):
    linkedin_status: str
    slack_status: str
    llm_status: str
    email_status: str
    setup_complete: bool
    timezone: str | None = None
    daily_post_budget: int = 1
    min_gap_minutes: int = 180
    max_active_campaigns: int = 3
    linkedin_profile_handle: str | None = None  # Vanity name in linkedin.com/in/<handle>
    evolution_min_feedbacks: int = 5
    evolution_min_snapshots: int = 4
    earliest_campaign_month: str | None = None  # "YYYY-MM" of the earliest campaign created by this user


class LinkedInSetupRequest(BaseModel):
    access_token: str = Field(min_length=1)
    person_urn: str = Field(min_length=1)


class SlackSetupRequest(BaseModel):
    webhook_url: str = Field(min_length=1)


class LLMSetupRequest(BaseModel):
    provider: str = Field(default="anthropic")
    api_key: str = Field(min_length=1)


class AccountSettingsRequest(BaseModel):
    timezone: str = Field(default="Asia/Kolkata")
    daily_post_budget: int = Field(ge=1, le=5, default=1)
    min_gap_minutes: int = Field(ge=30, le=1440, default=180)
    max_active_campaigns: int = Field(ge=1, le=20, default=3)
    linkedin_profile_handle: str | None = Field(default=None, max_length=200)
    evolution_min_feedbacks: int | None = Field(default=None, ge=2, le=50)
    evolution_min_snapshots: int | None = Field(default=None, ge=2, le=50)


class SetupValidationResponse(BaseModel):
    success: bool
    message: str
