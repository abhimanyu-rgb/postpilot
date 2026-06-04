from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class DraftEdit(Base, IdMixin, TimestampMixin):
    __tablename__ = "draft_edit"

    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("draft.id"), nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    edited_text: Mapped[str] = mapped_column(Text, nullable=False)
    edit_type: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    before_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_draft_edit_type", "edit_type"),
        Index("idx_draft_edit_draft", "draft_id"),
    )
