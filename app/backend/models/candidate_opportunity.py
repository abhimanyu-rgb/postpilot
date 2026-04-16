from sqlalchemy import ForeignKey, Integer, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class CandidateOpportunity(Base, IdMixin, TimestampMixin):
    __tablename__ = "candidate_opportunity"

    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("daily_run.id"), nullable=False)
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("campaign.id"), nullable=False)
    headline: Mapped[str] = mapped_column(Text, nullable=False)
    narrative_type: Mapped[str] = mapped_column(String, nullable=False)
    source_refs_json: Mapped[str] = mapped_column(Text, nullable=False)
    relevance_score: Mapped[float] = mapped_column(Float, nullable=False)
    novelty_score: Mapped[float] = mapped_column(Float, nullable=False)
    global_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    similarity_group_id: Mapped[str | None] = mapped_column(String, nullable=True)
    suppression_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
