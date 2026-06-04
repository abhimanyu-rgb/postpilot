"""add draft_edit table for capturing user edits on approve

Revision ID: a8c9d0e1f2b3
Revises: f7b8c9d0e1f2
Create Date: 2026-06-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8c9d0e1f2b3'
down_revision: Union[str, None] = 'f7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'draft',
        sa.Column('original_generated_text', sa.Text(), nullable=True),
    )
    op.execute("UPDATE draft SET original_generated_text = primary_text WHERE original_generated_text IS NULL")

    op.create_table(
        'draft_edit',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('draft_id', sa.Integer(), sa.ForeignKey('draft.id'), nullable=False),
        sa.Column('original_text', sa.Text(), nullable=False),
        sa.Column('edited_text', sa.Text(), nullable=False),
        sa.Column('edit_type', sa.String(length=64), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('before_snippet', sa.Text(), nullable=True),
        sa.Column('after_snippet', sa.Text(), nullable=True),
        sa.Column('promoted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('idx_draft_edit_type', 'draft_edit', ['edit_type'])
    op.create_index('idx_draft_edit_draft', 'draft_edit', ['draft_id'])


def downgrade() -> None:
    op.drop_index('idx_draft_edit_draft', table_name='draft_edit')
    op.drop_index('idx_draft_edit_type', table_name='draft_edit')
    op.drop_table('draft_edit')
    op.drop_column('draft', 'original_generated_text')
