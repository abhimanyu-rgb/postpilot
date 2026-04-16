from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class SelectedOpportunity(Base, IdMixin, TimestampMixin):
    __tablename__ = "selected_opportunity"

    candidate_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("candidate_opportunity.id"), nullable=False
    )
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("campaign.id"), nullable=False)
    selection_rank: Mapped[int] = mapped_column(Integer, nullable=False)
    selection_date: Mapped[str] = mapped_column(Text, nullable=False)
    selection_reason: Mapped[str] = mapped_column(Text, nullable=False)
