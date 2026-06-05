from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class ApprovalAction(Base, IdMixin, TimestampMixin):
    __tablename__ = "approval_action"

    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("draft.id"), nullable=False)
    action_type: Mapped[str] = mapped_column(String, nullable=False)
    source_surface: Mapped[str] = mapped_column(String, nullable=False)
    action_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # One of: 'repetitive', 'drift', 'off_topic', 'poor_hook', 'other'. Only set when action_type='rejected'.
    rejection_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
