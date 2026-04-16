from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class HistoricalLinkedInArtifact(Base, IdMixin, TimestampMixin):
    __tablename__ = "historical_linkedin_artifact"

    artifact_type: Mapped[str] = mapped_column(String, nullable=False)
    external_ref: Mapped[str | None] = mapped_column(String, nullable=True)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    normalized_payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    source_hash: Mapped[str | None] = mapped_column(String, nullable=True)

    __table_args__ = (
        Index("idx_historical_artifact_type", "artifact_type"),
        Index("idx_historical_external_ref", "external_ref"),
    )
