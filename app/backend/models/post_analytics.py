from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.backend.core.database import Base
from app.backend.models.base import IdMixin, TimestampMixin


class PostAnalytics(Base, IdMixin, TimestampMixin):
    """Append-only engagement snapshot for a published post.

    Multiple rows per draft over time give us growth trajectory; we never
    overwrite. Engagement_score is computed at scrape time using a simple
    weighting (reactions + 3*comments) — kept simple per product decision.
    """

    __tablename__ = "post_analytics"

    draft_id: Mapped[int] = mapped_column(Integer, ForeignKey("draft.id"), nullable=False)
    scraped_at: Mapped["DateTime"] = mapped_column(DateTime, nullable=False)
    reactions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    engagement_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    activity_urn: Mapped[str | None] = mapped_column(Text, nullable=True)
    posted_at_relative: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("idx_post_analytics_draft_id", "draft_id"),
        Index("idx_post_analytics_scraped_at", "scraped_at"),
    )


class StagedInsight(Base, IdMixin, TimestampMixin):
    """Insights extracted by Claude from high-engagement posts.

    Status: pending (awaiting user gate), promoted (appended to learned_context),
    rejected (user dismissed). Pending insights show in the Analytics tab for
    review.
    """

    __tablename__ = "staged_insight"

    analytics_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("post_analytics.id"), nullable=True
    )
    draft_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("draft.id"), nullable=True
    )
    insight_text: Mapped[str] = mapped_column(Text, nullable=False)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    promoted_at: Mapped["DateTime | None"] = mapped_column(DateTime, nullable=True)
    rejected_at: Mapped["DateTime | None"] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("idx_staged_insight_status", "status"),)
