from sqlalchemy import Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import FullTimestampMixin, IdMixin


class Campaign(Base, IdMixin, FullTimestampMixin):
    __tablename__ = "campaign"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")
    topics_json: Mapped[str] = mapped_column(Text, nullable=False)
    persona: Mapped[str] = mapped_column(Text, nullable=False)
    tone: Mapped[str] = mapped_column(Text, nullable=False)
    frequency: Mapped[str] = mapped_column(Text, nullable=False)
    posting_window_start: Mapped[str | None] = mapped_column(Text, nullable=True)
    posting_window_end: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_rule_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    significance_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    source_preferences_json: Mapped[str] = mapped_column(Text, nullable=False)
    novelty_cooldown_days: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    profile_adherence_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    custom_rss_feeds_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("idx_campaign_status", "status"),)
