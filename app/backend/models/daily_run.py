from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin


class DailyRun(Base, IdMixin):
    __tablename__ = "daily_run"

    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("campaign.id"), nullable=False)
    run_date_local: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    degraded_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    skip_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("campaign_id", "run_date_local"),)
