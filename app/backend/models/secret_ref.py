from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import FullTimestampMixin, IdMixin


class SecretRef(Base, IdMixin, FullTimestampMixin):
    __tablename__ = "secret_ref"

    secret_name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    storage_type: Mapped[str] = mapped_column(String, nullable=False)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
