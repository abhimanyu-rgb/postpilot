"""add rejection_reason tag to approval_action

Revision ID: b9d0e1f2c3a4
Revises: a8c9d0e1f2b3
Create Date: 2026-06-05 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b9d0e1f2c3a4'
down_revision: Union[str, None] = 'a8c9d0e1f2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'approval_action',
        sa.Column('rejection_reason', sa.String(length=32), nullable=True),
    )
    op.create_index('idx_approval_rejection_reason', 'approval_action', ['rejection_reason'])


def downgrade() -> None:
    op.drop_index('idx_approval_rejection_reason', table_name='approval_action')
    op.drop_column('approval_action', 'rejection_reason')
