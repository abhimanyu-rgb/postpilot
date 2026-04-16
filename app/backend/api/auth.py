"""LinkedIn OAuth 2.0 Authorization Code flow.

Flow:
  1. Frontend calls GET /api/auth/linkedin → redirects to LinkedIn
  2. User authorizes on LinkedIn → LinkedIn redirects to /api/auth/linkedin/callback
  3. Backend exchanges code for tokens, stores them in .env
  4. Redirects user back to frontend setup page
"""
from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.backend.core.config import settings
from app.backend.core.database import get_db
from app.backend.services.secret_service import store_secret
from app.backend.services.setup_service import get_or_create_config

logger = logging.getLogger("orchestrator")

router = APIRouter(prefix="/api/auth", tags=["auth"])

# In-memory CSRF state store (acceptable for local-first single-user app)
_oauth_states: set[str] = set()

LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization"
LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken"
LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo"

SCOPES = "openid profile email w_member_social"

# Fallback scopes if w_member_social isn't approved yet
SCOPES_BASIC = "openid profile email"


@router.get("/linkedin")
def linkedin_auth_start(basic: bool = False):
    """Redirect user to LinkedIn OAuth authorization page.

    Use ?basic=true to request only profile scopes (if w_member_social isn't approved).
    """
    if not settings.linkedin_client_id or not settings.linkedin_client_secret:
        raise HTTPException(
            status_code=400,
            detail="LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set in .env",
        )

    state = secrets.token_urlsafe(32)
    _oauth_states.add(state)

    params = {
        "response_type": "code",
        "client_id": settings.linkedin_client_id,
        "redirect_uri": settings.linkedin_redirect_uri,
        "scope": SCOPES_BASIC if basic else SCOPES,
        "state": state,
    }
    authorize_url = f"{LINKEDIN_AUTHORIZE_URL}?{urlencode(params)}"
    return RedirectResponse(url=authorize_url)


@router.get("/linkedin/callback")
async def linkedin_auth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: Session = Depends(get_db),
):
    """Handle LinkedIn OAuth callback — exchange code for tokens."""
    # Handle errors from LinkedIn
    if error:
        logger.error("LinkedIn OAuth error: %s — %s", error, error_description)
        return RedirectResponse(
            url=f"http://localhost:3001/setup?error={error_description or error}"
        )

    # CSRF check
    if not state or state not in _oauth_states:
        return RedirectResponse(url="http://localhost:3001/setup?error=Invalid+state+parameter")
    _oauth_states.discard(state)

    if not code:
        return RedirectResponse(url="http://localhost:3001/setup?error=No+authorization+code")

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                LINKEDIN_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.linkedin_client_id,
                    "client_secret": settings.linkedin_client_secret,
                    "redirect_uri": settings.linkedin_redirect_uri,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15,
            )

        if resp.status_code != 200:
            logger.error("LinkedIn token exchange failed: %s %s", resp.status_code, resp.text[:300])
            return RedirectResponse(
                url=f"http://localhost:3001/setup?error=Token+exchange+failed+({resp.status_code})"
            )

        token_data = resp.json()
        access_token = token_data["access_token"]
        refresh_token = token_data.get("refresh_token", "")

    except Exception as e:
        logger.error("LinkedIn token exchange error: %s", e)
        return RedirectResponse(url="http://localhost:3001/setup?error=Token+exchange+error")

    # Fetch user profile to get person URN
    try:
        async with httpx.AsyncClient() as client:
            profile_resp = await client.get(
                LINKEDIN_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )

        if profile_resp.status_code != 200:
            logger.error("LinkedIn userinfo failed: %s", profile_resp.status_code)
            return RedirectResponse(url="http://localhost:3001/setup?error=Profile+fetch+failed")

        profile = profile_resp.json()
        # sub field contains the person ID
        person_id = profile.get("sub", "")
        person_urn = f"urn:li:person:{person_id}" if person_id else ""
        user_name = profile.get("name", "LinkedIn User")

    except Exception as e:
        logger.error("LinkedIn profile fetch error: %s", e)
        return RedirectResponse(url="http://localhost:3001/setup?error=Profile+fetch+error")

    # Store tokens securely in .env (server-side only)
    store_secret(db, "LINKEDIN_ACCESS_TOKEN", access_token)
    store_secret(db, "LINKEDIN_PERSON_URN", person_urn)
    if refresh_token:
        store_secret(db, "LINKEDIN_REFRESH_TOKEN", refresh_token)

    # Update integration config
    config = get_or_create_config(db)
    config.linkedin_status = "connected"
    db.commit()

    # Check if setup is now complete
    from app.backend.services.setup_service import _check_and_mark_complete
    _check_and_mark_complete(db)

    logger.info("LinkedIn OAuth completed for %s (%s)", user_name, person_urn)
    return RedirectResponse(url=f"http://localhost:3001/setup?linkedin=connected&name={user_name}")


@router.get("/linkedin/status")
def linkedin_auth_status():
    """Check if LinkedIn OAuth is configured (client ID/secret present)."""
    has_client = bool(settings.linkedin_client_id and settings.linkedin_client_secret)
    has_token = bool(settings.linkedin_access_token)
    return {
        "oauth_configured": has_client,
        "token_present": has_token,
        "client_id_set": bool(settings.linkedin_client_id),
        "client_secret_set": bool(settings.linkedin_client_secret),
    }
