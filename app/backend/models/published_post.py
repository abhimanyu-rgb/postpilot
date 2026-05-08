from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import FullTimestampMixin, IdMixin


class PublishedPost(Base, IdMixin, FullTimestampMixin):
    __tablename__ = "published_post"

    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("draft.id"), nullable=False)
    publish_mode: Mapped[str] = mapped_column(String, nullable=False)
    published_text: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    external_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    activity_urn: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    manual_confirmation_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("idx_published_post_status", "status"),)
