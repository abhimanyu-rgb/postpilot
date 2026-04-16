from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class PersonalityProfile(Base, IdMixin, TimestampMixin):
    __tablename__ = "personality_profile"

    profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_post_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_engagement_sample_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    voice_traits_json: Mapped[str] = mapped_column(Text, nullable=False)
    structure_preferences_json: Mapped[str] = mapped_column(Text, nullable=False)
    topic_affinities_json: Mapped[str] = mapped_column(Text, nullable=False)
    engagement_patterns_json: Mapped[str] = mapped_column(Text, nullable=False)
    adherence_strength: Mapped[str] = mapped_column(String, nullable=False, default="medium")
    profile_summary: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    analysis_version: Mapped[str] = mapped_column(String, nullable=False)
