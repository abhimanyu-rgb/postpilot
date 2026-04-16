from sqlalchemy import Boolean, ForeignKey, Index, Integer, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class Draft(Base, IdMixin, TimestampMixin):
    __tablename__ = "draft"

    selected_opportunity_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("selected_opportunity.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    primary_text: Mapped[str] = mapped_column(Text, nullable=False)
    alternate_hooks_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    grounding_summary: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    profile_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    profile_version_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prompt_version: Mapped[str] = mapped_column(String, nullable=False)
    critic_version: Mapped[str] = mapped_column(String, nullable=False)
    media_suggestions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_media_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_draft_selected_version", "selected_opportunity_id", "version"),
        Index("idx_draft_status", "status"),
    )
