from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class AuditEvent(Base, IdMixin, TimestampMixin):
    __tablename__ = "audit_event"

    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("idx_audit_entity", "entity_type", "entity_id"),)
