"""add campaign-level prompt injection fields

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-05-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('campaign', sa.Column('prompt_avoid', sa.Text(), nullable=True))
    op.add_column('campaign', sa.Column('prompt_prioritize', sa.Text(), nullable=True))
    op.add_column('campaign', sa.Column('prompt_archetypes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('campaign', 'prompt_archetypes')
    op.drop_column('campaign', 'prompt_prioritize')
    op.drop_column('campaign', 'prompt_avoid')
