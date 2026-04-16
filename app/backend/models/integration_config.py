from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import FullTimestampMixin, IdMixin


class IntegrationConfig(Base, IdMixin, FullTimestampMixin):
    __tablename__ = "integration_config"

    linkedin_status: Mapped[str] = mapped_column(String, nullable=False, default="not_configured")
    slack_status: Mapped[str] = mapped_column(String, nullable=False, default="not_configured")
    llm_status: Mapped[str] = mapped_column(String, nullable=False, default="not_configured")
    email_status: Mapped[str] = mapped_column(
        String, nullable=False, default="not_configured"
    )
    setup_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    timezone: Mapped[str | None] = mapped_column(Text, nullable=True)
    daily_post_budget: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    min_gap_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=180)

    # User-editable personality profile
    author_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    personality_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_guardrails: Mapped[str | None] = mapped_column(Text, nullable=True)
