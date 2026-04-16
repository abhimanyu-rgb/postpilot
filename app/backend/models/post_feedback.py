from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import FullTimestampMixin, IdMixin


class PostFeedback(Base, IdMixin, FullTimestampMixin):
    __tablename__ = "post_feedback"

    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("draft.id"), nullable=False)
    campaign_id: Mapped[int] = mapped_column(Integer, ForeignKey("campaign.id"), nullable=False)

    # Performance metrics (user-entered from LinkedIn analytics)
    impressions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reactions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reposts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Qualitative feedback
    performance_rating: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # "great", "good", "average", "poor"
    what_worked: Mapped[str | None] = mapped_column(Text, nullable=True)
    what_didnt_work: Mapped[str | None] = mapped_column(Text, nullable=True)
    audience_reaction_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    improvement_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Structured tags for pattern learning
    effective_elements_json: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )  # ["strong_hook", "personal_story", "data_driven", ...]

    __table_args__ = (
        Index("idx_post_feedback_campaign", "campaign_id"),
        Index("idx_post_feedback_draft", "draft_id"),
    )
