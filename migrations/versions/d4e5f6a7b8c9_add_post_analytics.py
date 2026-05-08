"""add post_analytics and staged_insights tables; add activity_urn to published_post

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-05-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Engagement snapshots: one row per scrape per post. Append-only so we can
    # see growth over time without losing prior values.
    op.create_table(
        'post_analytics',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('draft_id', sa.Integer(), nullable=False),
        sa.Column('scraped_at', sa.DateTime(), nullable=False),
        sa.Column('reactions', sa.Integer(), nullable=True),
        sa.Column('comments', sa.Integer(), nullable=True),
        sa.Column('engagement_score', sa.Float(), nullable=True),
        sa.Column('activity_urn', sa.Text(), nullable=True),
        sa.Column('posted_at_relative', sa.Text(), nullable=True),
        sa.Column('raw_snapshot_json', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['draft_id'], ['draft.id']),
    )
    op.create_index('idx_post_analytics_draft_id', 'post_analytics', ['draft_id'])
    op.create_index('idx_post_analytics_scraped_at', 'post_analytics', ['scraped_at'])

    # Staged insights from Claude analyzing high-engagement posts. Human-gated
    # before promotion to learned_context.
    op.create_table(
        'staged_insight',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('analytics_id', sa.Integer(), nullable=True),  # which scrape ran prompted this insight
        sa.Column('draft_id', sa.Integer(), nullable=True),
        sa.Column('insight_text', sa.Text(), nullable=False),
        sa.Column('reasoning', sa.Text(), nullable=True),
        sa.Column('source_summary', sa.Text(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),  # pending | promoted | rejected
        sa.Column('promoted_at', sa.DateTime(), nullable=True),
        sa.Column('rejected_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['analytics_id'], ['post_analytics.id']),
        sa.ForeignKeyConstraint(['draft_id'], ['draft.id']),
    )
    op.create_index('idx_staged_insight_status', 'staged_insight', ['status'])

    # Persist activity URN at publish time (LinkedIn returns it in UGC create response).
    # Lets us skip the matching heuristic for new posts.
    op.add_column('published_post', sa.Column('activity_urn', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('published_post', 'activity_urn')
    op.drop_index('idx_staged_insight_status', table_name='staged_insight')
    op.drop_table('staged_insight')
    op.drop_index('idx_post_analytics_scraped_at', table_name='post_analytics')
    op.drop_index('idx_post_analytics_draft_id', table_name='post_analytics')
    op.drop_table('post_analytics')
