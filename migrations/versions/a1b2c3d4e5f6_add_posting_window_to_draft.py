"""add posting_window to draft (for user-drafted posts)

Revision ID: a1b2c3d4e5f6
Revises: 88b1c96d662e
Create Date: 2026-04-23 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '88b1c96d662e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('draft', sa.Column('posting_window_start', sa.String(length=5), nullable=True))
    op.add_column('draft', sa.Column('posting_window_end', sa.String(length=5), nullable=True))


def downgrade() -> None:
    op.drop_column('draft', 'posting_window_end')
    op.drop_column('draft', 'posting_window_start')
