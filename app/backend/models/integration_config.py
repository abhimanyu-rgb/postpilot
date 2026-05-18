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
    max_active_campaigns: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    linkedin_profile_handle: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Thresholds for personality-evolution / voice-snapshot learning. Editable
    # from Settings. Both gate the analyze_personality_evolution job — it
    # fires when EITHER signal source has accumulated enough rows.
    evolution_min_feedbacks: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    evolution_min_snapshots: Mapped[int] = mapped_column(Integer, nullable=False, default=4)

    # User-editable personality profile
    author_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    personality_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_guardrails: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Learned context: system-generated insights from feedback, user-editable
    learned_context: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Voice memory: rolling summary of published positions (updated after each publish)
    voice_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    voice_snapshot_post_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Personality evolution: suggested updates from feedback patterns
    personality_evolution_log: Mapped[str | None] = mapped_column(Text, nullable=True)
