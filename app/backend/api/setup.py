from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.backend.core.database import get_db
from app.backend.schemas.setup import (
    AccountSettingsRequest,
    LinkedInSetupRequest,
    LLMSetupRequest,
    SetupStatusResponse,
    SetupValidationResponse,
    SlackSetupRequest,
)
from app.backend.services import setup_service

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status", response_model=SetupStatusResponse)
def setup_status(db: Session = Depends(get_db)):
    return setup_service.get_setup_status(db)


@router.post("/linkedin", response_model=SetupValidationResponse)
async def setup_linkedin(request: LinkedInSetupRequest, db: Session = Depends(get_db)):
    success, message = await setup_service.save_linkedin_config(db, request)
    return SetupValidationResponse(success=success, message=message)


@router.post("/slack", response_model=SetupValidationResponse)
async def setup_slack(request: SlackSetupRequest, db: Session = Depends(get_db)):
    success, message = await setup_service.save_slack_config(db, request)
    return SetupValidationResponse(success=success, message=message)


@router.post("/llm", response_model=SetupValidationResponse)
async def setup_llm(request: LLMSetupRequest, db: Session = Depends(get_db)):
    success, message = await setup_service.save_llm_config(db, request)
    return SetupValidationResponse(success=success, message=message)


@router.put("/settings", response_model=SetupValidationResponse)
def update_settings(request: AccountSettingsRequest, db: Session = Depends(get_db)):
    setup_service.save_account_settings(db, request)
    return SetupValidationResponse(success=True, message="Account settings saved")


@router.post("/validate-env")
async def validate_from_env(db: Session = Depends(get_db)):
    """Validate all integrations using keys from .env — no secrets via frontend."""
    results = await setup_service.validate_and_connect_from_env(db)
    return results


@router.get("/personality")
def get_personality(db: Session = Depends(get_db)):
    """Get the current personality profile with evolution suggestions."""
    from app.backend.services.personality_service import get_saved_profile
    from app.backend.services.voice_memory import get_evolution_log
    profile = get_saved_profile()
    profile["evolution_suggestions"] = get_evolution_log(db)
    return profile


@router.put("/personality")
def save_personality(data: dict):
    """Save the personality profile from the settings editor."""
    from app.backend.services.personality_service import save_personality_profile
    save_personality_profile(
        author_name=data.get("author_name", ""),
        personality_prompt=data.get("personality_prompt", ""),
        content_guardrails=data.get("content_guardrails", ""),
    )
    return {"success": True, "message": "Personality profile saved"}


@router.get("/publish-queue")
def get_publish_queue():
    """Get publish queue status: posts today, budget remaining, approved waiting."""
    from app.backend.core.scheduler import get_publish_queue_status, is_publishing_paused
    status = get_publish_queue_status()
    status["paused"] = is_publishing_paused()
    return status


@router.post("/publish-queue/pause")
def pause_publishing():
    """Emergency stop: pause all scheduled publishing."""
    from app.backend.core.scheduler import set_publishing_paused
    set_publishing_paused(True)
    return {"paused": True}


@router.post("/publish-queue/resume")
def resume_publishing():
    """Resume scheduled publishing."""
    from app.backend.core.scheduler import set_publishing_paused
    set_publishing_paused(False)
    return {"paused": False}


@router.get("/token-usage")
def get_token_usage(db: Session = Depends(get_db)):
    """Get token usage stats for the dashboard."""
    from app.backend.services.token_tracker import get_usage_stats
    return get_usage_stats(db)


@router.put("/personality/learned")
def save_learned(data: dict):
    """Save the learned context from the settings editor."""
    from app.backend.services.personality_service import save_learned_context
    save_learned_context(data.get("learned_context", ""))
    return {"success": True}


@router.get("/personality/evolution")
def get_personality_evolution(db: Session = Depends(get_db)):
    """Get personality evolution log from feedback analysis."""
    from app.backend.services.voice_memory import get_evolution_log
    return get_evolution_log(db)


@router.get("/env-config")
def get_env_config():
    """Return which .env keys are configured (masked values, never raw secrets).

    Used by the Settings page so any user can see what's set up and what's missing.
    """
    from app.backend.core.config import settings
    from app.backend.services.secret_service import redact

    def _status(val: str) -> dict:
        if not val:
            return {"set": False, "preview": ""}
        return {"set": True, "preview": redact(val)}

    return {
        "linkedin": {
            "client_id": _status(settings.linkedin_client_id),
            "client_secret": _status(settings.linkedin_client_secret),
            "access_token": _status(settings.linkedin_access_token),
            "person_urn": _status(settings.linkedin_person_urn),
            "redirect_uri": settings.linkedin_redirect_uri,
        },
        "anthropic": {
            "api_key": _status(settings.anthropic_api_key),
        },
        "slack": {
            "webhook_url": _status(settings.slack_webhook_url),
        },
        "news": {
            "api_key": _status(settings.news_api_key),
        },
        "app": {
            "database_url": settings.database_url.split("@")[0][:30] + "..." if "@" in settings.database_url else settings.database_url[:40],
            "timezone": settings.timezone,
            "daily_post_budget": settings.daily_post_budget,
            "min_gap_minutes": settings.min_gap_minutes,
        },
    }
