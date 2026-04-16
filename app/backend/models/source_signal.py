from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class SourceSignal(Base, IdMixin, TimestampMixin):
    __tablename__ = "source_signal"

    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("daily_run.id"), nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    title_or_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    url_or_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    normalized_payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("idx_source_signal_run_id", "run_id"),
        Index("idx_source_signal_source_hash", "source_hash"),
    )
