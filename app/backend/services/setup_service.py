import logging

import httpx
from sqlalchemy.orm import Session

from app.backend.models.integration_config import IntegrationConfig
from app.backend.schemas.setup import (
    AccountSettingsRequest,
    LinkedInSetupRequest,
    LLMSetupRequest,
    SetupStatusResponse,
    SlackSetupRequest,
)
from app.backend.services.secret_service import get_secret, store_secret

logger = logging.getLogger("orchestrator")


def get_or_create_config(db: Session) -> IntegrationConfig:
    config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
    if config is None:
        config = IntegrationConfig(id=1)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


def get_setup_status(db: Session) -> SetupStatusResponse:
    config = get_or_create_config(db)
    return SetupStatusResponse(
        linkedin_status=config.linkedin_status,
        slack_status=config.slack_status,
        llm_status=config.llm_status,
        email_status=config.email_status,
        setup_complete=config.setup_complete,
        timezone=config.timezone,
        daily_post_budget=config.daily_post_budget,
        min_gap_minutes=config.min_gap_minutes,
    )


async def validate_linkedin(token: str, person_urn: str) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient() as client:
            # Try OpenID Connect userinfo endpoint first (used by OAuth flow)
            resp = await client.get(
                "https://api.linkedin.com/v2/userinfo",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if resp.status_code == 200:
                name = resp.json().get("name", "")
                return True, f"LinkedIn connected{' as ' + name if name else ''}"

            # Fallback to legacy /v2/me endpoint
            resp = await client.get(
                "https://api.linkedin.com/v2/me",
                headers={"Authorization": f"Bearer {token}"},
                timeout=10,
            )
            if resp.status_code == 200:
                return True, "LinkedIn connection validated"

            return False, f"LinkedIn API returned {resp.status_code}: {resp.text[:200]}"
    except httpx.RequestError as e:
        return False, f"LinkedIn connection failed: {str(e)}"


async def save_linkedin_config(db: Session, request: LinkedInSetupRequest) -> tuple[bool, str]:
    valid, message = await validate_linkedin(request.access_token, request.person_urn)
    if not valid:
        config = get_or_create_config(db)
        config.linkedin_status = "invalid"
        db.commit()
        return False, message

    store_secret(db, "LINKEDIN_ACCESS_TOKEN", request.access_token)
    store_secret(db, "LINKEDIN_PERSON_URN", request.person_urn)

    config = get_or_create_config(db)
    config.linkedin_status = "connected"
    db.commit()
    _check_and_mark_complete(db)
    logger.info("LinkedIn setup completed")
    return True, message


async def validate_slack(webhook_url: str) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                webhook_url,
                json={"text": "LinkedIn Content Orchestrator: Slack connection test"},
                timeout=10,
            )
            if resp.status_code == 200:
                return True, "Slack webhook validated — test message sent"
            return False, f"Slack webhook returned {resp.status_code}"
    except httpx.RequestError as e:
        return False, f"Slack connection failed: {str(e)}"


async def save_slack_config(db: Session, request: SlackSetupRequest) -> tuple[bool, str]:
    valid, message = await validate_slack(request.webhook_url)
    if not valid:
        config = get_or_create_config(db)
        config.slack_status = "invalid"
        db.commit()
        return False, message

    store_secret(db, "SLACK_WEBHOOK_URL", request.webhook_url)

    config = get_or_create_config(db)
    config.slack_status = "connected"
    db.commit()
    _check_and_mark_complete(db)
    logger.info("Slack setup completed")
    return True, message


async def validate_llm(provider: str, api_key: str) -> tuple[bool, str]:
    if provider != "anthropic":
        return False, f"Unsupported LLM provider: {provider}"
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            messages=[{"role": "user", "content": "Say hi"}],
        )
        return True, "Anthropic API key validated"
    except anthropic.AuthenticationError:
        return False, "Invalid Anthropic API key"
    except Exception as e:
        return False, f"LLM validation failed: {str(e)}"


async def save_llm_config(db: Session, request: LLMSetupRequest) -> tuple[bool, str]:
    valid, message = await validate_llm(request.provider, request.api_key)
    if not valid:
        config = get_or_create_config(db)
        config.llm_status = "invalid"
        db.commit()
        return False, message

    store_secret(db, "ANTHROPIC_API_KEY", request.api_key)
    store_secret(db, "LLM_PROVIDER", request.provider)

    config = get_or_create_config(db)
    config.llm_status = "connected"
    db.commit()
    _check_and_mark_complete(db)
    logger.info("LLM setup completed")
    return True, message


def save_account_settings(db: Session, request: AccountSettingsRequest) -> None:
    config = get_or_create_config(db)
    config.timezone = request.timezone
    config.daily_post_budget = request.daily_post_budget
    config.min_gap_minutes = request.min_gap_minutes
    db.commit()
    logger.info("Account settings updated")


async def validate_and_connect_from_env(db: Session) -> dict[str, dict]:
    """Validate all integrations using keys already in .env / environment.

    Frontend never sends secrets — this reads them server-side and tests connections.
    Returns status per integration.
    """
    from app.backend.core.config import settings

    results: dict[str, dict] = {}

    # LinkedIn
    token = settings.linkedin_access_token
    urn = settings.linkedin_person_urn
    if token and urn:
        valid, message = await validate_linkedin(token, urn)
        config = get_or_create_config(db)
        config.linkedin_status = "connected" if valid else "invalid"
        db.commit()
        results["linkedin"] = {"status": config.linkedin_status, "message": message}
    else:
        results["linkedin"] = {"status": "not_configured", "message": "Set LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN in .env"}

    # Slack (optional)
    webhook = settings.slack_webhook_url
    if webhook:
        valid, message = await validate_slack(webhook)
        config = get_or_create_config(db)
        config.slack_status = "connected" if valid else "invalid"
        db.commit()
        results["slack"] = {"status": config.slack_status, "message": message}
    else:
        results["slack"] = {"status": "skipped", "message": "Optional — set SLACK_WEBHOOK_URL in .env"}

    # LLM
    api_key = settings.anthropic_api_key
    if api_key:
        valid, message = await validate_llm("anthropic", api_key)
        config = get_or_create_config(db)
        config.llm_status = "connected" if valid else "invalid"
        db.commit()
        results["llm"] = {"status": config.llm_status, "message": message}
    else:
        results["llm"] = {"status": "not_configured", "message": "Set ANTHROPIC_API_KEY in .env"}

    _check_and_mark_complete(db)
    return results


def _check_and_mark_complete(db: Session) -> None:
    config = get_or_create_config(db)
    # LLM is required; LinkedIn + Slack are optional (LinkedIn needed later for publishing)
    if config.llm_status == "connected":
        config.setup_complete = True
        db.commit()
