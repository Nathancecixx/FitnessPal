"""coach_feed_and_timezone

Revision ID: d2a4f1b8c9e7
Revises: c6f6a1c2e8d4
Create Date: 2026-03-12 20:35:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2a4f1b8c9e7"
down_revision: Union[str, Sequence[str], None] = "c6f6a1c2e8d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user_preferences") as batch_op:
        batch_op.add_column(sa.Column("timezone", sa.String(length=64), nullable=True))

    op.create_table(
        "coach_check_ins",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("check_in_date", sa.Date(), nullable=False),
        sa.Column("sleep_hours", sa.Float(), nullable=True),
        sa.Column("readiness_1_5", sa.Integer(), nullable=True),
        sa.Column("soreness_1_5", sa.Integer(), nullable=True),
        sa.Column("hunger_1_5", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "check_in_date", name="uq_coach_check_ins_user_date"),
    )
    op.create_index(op.f("ix_coach_check_ins_check_in_date"), "coach_check_ins", ["check_in_date"], unique=False)
    op.create_index(op.f("ix_coach_check_ins_user_id"), "coach_check_ins", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_coach_check_ins_user_id"), table_name="coach_check_ins")
    op.drop_index(op.f("ix_coach_check_ins_check_in_date"), table_name="coach_check_ins")
    op.drop_table("coach_check_ins")

    with op.batch_alter_table("user_preferences") as batch_op:
        batch_op.drop_column("timezone")
