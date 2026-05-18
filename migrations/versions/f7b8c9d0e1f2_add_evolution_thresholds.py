"""add user-configurable thresholds for personality evolution

Revision ID: f7b8c9d0e1f2
Revises: e5f6a7b8c9d0
Create Date: 2026-05-18 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7b8c9d0e1f2'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'integration_config',
        sa.Column('evolution_min_feedbacks', sa.Integer(), nullable=False, server_default='5'),
    )
    op.add_column(
        'integration_config',
        sa.Column('evolution_min_snapshots', sa.Integer(), nullable=False, server_default='4'),
    )


def downgrade() -> None:
    op.drop_column('integration_config', 'evolution_min_snapshots')
    op.drop_column('integration_config', 'evolution_min_feedbacks')
