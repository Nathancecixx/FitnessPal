"""multi_user_ownership

Revision ID: 4d3b8a7f9c12
Revises: 850c045c6a5e
Create Date: 2026-03-06 17:35:00.000000

"""
from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.models import new_ulid, utcnow


# revision identifiers, used by Alembic.
revision: str = "4d3b8a7f9c12"
down_revision: Union[str, Sequence[str], None] = "850c045c6a5e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OWNED_TABLES = [
    "job_records",
    "goals",
    "export_records",
    "food_items",
    "recipes",
    "recipe_items",
    "meal_templates",
    "meal_template_items",
    "photo_analysis_drafts",
    "meal_entries",
    "meal_entry_items",
    "exercises",
    "routines",
    "routine_exercises",
    "workout_templates",
    "workout_template_exercises",
    "workout_sessions",
    "set_entries",
    "weight_entries",
    "insight_snapshots",
]

NULLABLE_USER_TABLES = [
    "audit_logs",
    "idempotency_records",
]


def _admin_username() -> str:
    return os.getenv("FITNESSPAL_ADMIN_USERNAME", os.getenv("FITNESSPAL_BOOTSTRAP_USERNAME", "owner"))


def _ensure_admin_user_id(bind: sa.engine.Connection) -> str:
    admin_username = _admin_username()
    existing_admin_id = bind.execute(
        sa.text("SELECT id FROM app_users WHERE username = :username LIMIT 1"),
        {"username": admin_username},
    ).scalar()
    if existing_admin_id:
        bind.execute(
            sa.text("UPDATE app_users SET is_admin = true WHERE id = :user_id"),
            {"user_id": existing_admin_id},
        )
        return str(existing_admin_id)

    user_id = new_ulid()
    now = utcnow()
    bind.execute(
        sa.text(
            """
            INSERT INTO app_users (id, username, password_hash, is_admin, is_active, password_set_at, created_at, updated_at)
            VALUES (:id, :username, :password_hash, :is_admin, :is_active, :password_set_at, :created_at, :updated_at)
            """
        ),
        {
            "id": user_id,
            "username": admin_username,
            "password_hash": None,
            "is_admin": True,
            "is_active": True,
            "password_set_at": None,
            "created_at": now,
            "updated_at": now,
        },
    )
    return user_id


def _add_user_id_column(table_name: str, *, nullable: bool) -> None:
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.add_column(sa.Column("user_id", sa.String(length=26), nullable=nullable))
        batch_op.create_index(f"ix_{table_name}_user_id", ["user_id"], unique=False)
        batch_op.create_foreign_key(f"fk_{table_name}_user_id_app_users", "app_users", ["user_id"], ["id"])


def _drop_user_id_column(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.drop_constraint(f"fk_{table_name}_user_id_app_users", type_="foreignkey")
        batch_op.drop_index(f"ix_{table_name}_user_id")
        batch_op.drop_column("user_id")


def upgrade() -> None:
    with op.batch_alter_table("app_users") as batch_op:
        batch_op.add_column(sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("password_set_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index("ix_app_users_is_admin", ["is_admin"], unique=False)
        batch_op.alter_column("password_hash", existing_type=sa.String(length=256), nullable=True)

    op.create_table(
        "password_setup_tokens",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=26), nullable=True),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["app_users.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_password_setup_tokens_created_by_user_id"), "password_setup_tokens", ["created_by_user_id"], unique=False)
    op.create_index(op.f("ix_password_setup_tokens_expires_at"), "password_setup_tokens", ["expires_at"], unique=False)
    op.create_index(op.f("ix_password_setup_tokens_token_hash"), "password_setup_tokens", ["token_hash"], unique=True)
    op.create_index(op.f("ix_password_setup_tokens_user_id"), "password_setup_tokens", ["user_id"], unique=False)

    for table_name in OWNED_TABLES:
        _add_user_id_column(table_name, nullable=True)
    for table_name in NULLABLE_USER_TABLES:
        _add_user_id_column(table_name, nullable=True)

    bind = op.get_bind()
    owner_user_id = _ensure_admin_user_id(bind)

    bind.execute(sa.text("UPDATE api_keys SET user_id = :user_id"), {"user_id": owner_user_id})
    bind.execute(sa.text("UPDATE session_tokens SET user_id = :user_id"), {"user_id": owner_user_id})

    for table_name in OWNED_TABLES + NULLABLE_USER_TABLES:
        bind.execute(sa.text(f"UPDATE {table_name} SET user_id = :user_id WHERE user_id IS NULL"), {"user_id": owner_user_id})

    for table_name in OWNED_TABLES:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.alter_column("user_id", existing_type=sa.String(length=26), nullable=False)

    with op.batch_alter_table("app_users") as batch_op:
        batch_op.alter_column("is_admin", server_default=None)


def downgrade() -> None:
    for table_name in reversed(NULLABLE_USER_TABLES):
        _drop_user_id_column(table_name)

    for table_name in reversed(OWNED_TABLES):
        _drop_user_id_column(table_name)

    op.drop_index(op.f("ix_password_setup_tokens_user_id"), table_name="password_setup_tokens")
    op.drop_index(op.f("ix_password_setup_tokens_token_hash"), table_name="password_setup_tokens")
    op.drop_index(op.f("ix_password_setup_tokens_expires_at"), table_name="password_setup_tokens")
    op.drop_index(op.f("ix_password_setup_tokens_created_by_user_id"), table_name="password_setup_tokens")
    op.drop_table("password_setup_tokens")

    with op.batch_alter_table("app_users") as batch_op:
        batch_op.alter_column("password_hash", existing_type=sa.String(length=256), nullable=False)
        batch_op.drop_index("ix_app_users_is_admin")
        batch_op.drop_column("password_set_at")
        batch_op.drop_column("is_admin")
