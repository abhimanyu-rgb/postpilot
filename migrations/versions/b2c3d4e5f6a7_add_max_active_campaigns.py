"""add max_active_campaigns to integration_config

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'integration_config',
        sa.Column('max_active_campaigns', sa.Integer(), nullable=False, server_default='3'),
    )


def downgrade() -> None:
    op.drop_column('integration_config', 'max_active_campaigns')
