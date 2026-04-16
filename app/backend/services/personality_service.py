"""Load the personality profile and build prompt blocks for Claude.

Reads from the database (user-editable via Settings page).
Falls back to hardcoded defaults if no profile is saved yet.
"""
from __future__ import annotations

from app.backend.core.database import SessionLocal
from app.backend.models.integration_config import IntegrationConfig

# Default personality prompt for new users (before they customize)
DEFAULT_PERSONALITY_PROMPT = """## Author Personality Profile

Voice:
- Clear and direct
- Professional but human
- Grounded in real experience

Preferred hooks:
- Bold claim or observation
- Contrarian take
- Strong insight from the field

Preferred structure:
- Short paragraphs
- Front-load the insight
- End with a clear takeaway

Avoid:
- Soft or generic openings
- Hype language without substance
- Long context before the main point"""

# Default guardrails for all users
DEFAULT_CONTENT_GUARDRAILS = """## Content Guardrails (STRICT)
These rules override all other style guidance:

NEVER use:
- Em dashes (the long dash character) or en dashes. Use commas, periods, or colons instead.
- "In today's rapidly evolving..." or similar generic AI openings
- "Let's dive in" / "Here's the thing" / "Let me explain"
- "Game-changer" / "Revolutionary" / "Transformative" without specifics
- "Excited to share" / "Thrilled to announce"
- "It's not about X, it's about Y" as a formula
- Excessive exclamation marks
- More than 2 hashtags
- Emoji in every paragraph

ALWAYS:
- Use commas or periods where you would reach for a dash
- Start with the insight, not the context
- Sound like a human who operates, not a content creator who performs
- Keep sentences short and direct
- Break long sentences into two shorter ones"""


def _load_from_db() -> tuple[str | None, str | None, str | None]:
    """Load personality fields from the DB. Returns (author_name, prompt, guardrails)."""
    db = SessionLocal()
    try:
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        if config:
            return config.author_name, config.personality_prompt, config.content_guardrails
        return None, None, None
    finally:
        db.close()


def get_personality_prompt() -> str:
    """Return the personality prompt block. DB first, then default."""
    _, prompt, _ = _load_from_db()
    return prompt or DEFAULT_PERSONALITY_PROMPT


def get_content_guardrails() -> str:
    """Return the content guardrails block. DB first, then default."""
    _, _, guardrails = _load_from_db()
    return guardrails or DEFAULT_CONTENT_GUARDRAILS


def get_full_personality_context() -> str:
    """Return guardrails + personality prompt combined.

    Priority order (highest first):
    1. Guardrails (strict rules, override everything)
    2. Personality profile (voice and style)
    Feedback learnings and source content are injected separately in the prompt.
    """
    return f"{get_content_guardrails()}\n\n{get_personality_prompt()}"


def save_personality_profile(
    author_name: str,
    personality_prompt: str,
    content_guardrails: str,
) -> None:
    """Save the personality profile to the DB."""
    db = SessionLocal()
    try:
        config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
        if config:
            config.author_name = author_name
            config.personality_prompt = personality_prompt
            config.content_guardrails = content_guardrails
            db.commit()
    finally:
        db.close()


def get_saved_profile() -> dict:
    """Return the saved profile for the settings UI."""
    name, prompt, guardrails = _load_from_db()
    return {
        "author_name": name or "",
        "personality_prompt": prompt or DEFAULT_PERSONALITY_PROMPT,
        "content_guardrails": guardrails or DEFAULT_CONTENT_GUARDRAILS,
        "is_default": prompt is None,
    }
