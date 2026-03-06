"""ai_profiles_and_coach_briefs

Revision ID: b91b4a9b0c4e
Revises: 4d3b8a7f9c12
Create Date: 2026-03-06 18:25:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b91b4a9b0c4e"
down_revision: Union[str, Sequence[str], None] = "4d3b8a7f9c12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_profiles",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("base_url", sa.String(length=512), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("default_model", sa.String(length=256), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False),
        sa.Column("is_read_only", sa.Boolean(), nullable=False),
        sa.Column("default_headers_json", sa.JSON(), nullable=False),
        sa.Column("advanced_settings_json", sa.JSON(), nullable=False),
        sa.Column("models_json", sa.JSON(), nullable=False),
        sa.Column("last_reachable", sa.Boolean(), nullable=False),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_profiles_is_enabled"), "ai_profiles", ["is_enabled"], unique=False)
    op.create_index(op.f("ix_ai_profiles_name"), "ai_profiles", ["name"], unique=True)
    op.create_index(op.f("ix_ai_profiles_provider"), "ai_profiles", ["provider"], unique=False)

    op.create_table(
        "ai_feature_bindings",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("feature_key", sa.String(length=64), nullable=False),
        sa.Column("profile_id", sa.String(length=26), nullable=True),
        sa.Column("model", sa.String(length=256), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("top_p", sa.Float(), nullable=True),
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
        sa.Column("system_prompt", sa.Text(), nullable=True),
        sa.Column("request_overrides_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["ai_profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_feature_bindings_feature_key"), "ai_feature_bindings", ["feature_key"], unique=True)
    op.create_index(op.f("ix_ai_feature_bindings_profile_id"), "ai_feature_bindings", ["profile_id"], unique=False)

    op.create_table(
        "ai_persona_configs",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("config_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("tagline", sa.String(length=255), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("voice_guidelines_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_persona_configs_config_key"), "ai_persona_configs", ["config_key"], unique=True)

    op.create_table(
        "coach_briefs",
        sa.Column("id", sa.String(length=26), nullable=False),
        sa.Column("user_id", sa.String(length=26), nullable=False),
        sa.Column("insight_snapshot_id", sa.String(length=26), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=True),
        sa.Column("model_name", sa.String(length=256), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("body_markdown", sa.Text(), nullable=True),
        sa.Column("actions_json", sa.JSON(), nullable=False),
        sa.Column("stats_json", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["insight_snapshot_id"], ["insight_snapshots.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["app_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_coach_briefs_insight_snapshot_id"), "coach_briefs", ["insight_snapshot_id"], unique=False)
    op.create_index(op.f("ix_coach_briefs_status"), "coach_briefs", ["status"], unique=False)
    op.create_index(op.f("ix_coach_briefs_user_id"), "coach_briefs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_coach_briefs_user_id"), table_name="coach_briefs")
    op.drop_index(op.f("ix_coach_briefs_status"), table_name="coach_briefs")
    op.drop_index(op.f("ix_coach_briefs_insight_snapshot_id"), table_name="coach_briefs")
    op.drop_table("coach_briefs")

    op.drop_index(op.f("ix_ai_persona_configs_config_key"), table_name="ai_persona_configs")
    op.drop_table("ai_persona_configs")

    op.drop_index(op.f("ix_ai_feature_bindings_profile_id"), table_name="ai_feature_bindings")
    op.drop_index(op.f("ix_ai_feature_bindings_feature_key"), table_name="ai_feature_bindings")
    op.drop_table("ai_feature_bindings")

    op.drop_index(op.f("ix_ai_profiles_provider"), table_name="ai_profiles")
    op.drop_index(op.f("ix_ai_profiles_name"), table_name="ai_profiles")
    op.drop_index(op.f("ix_ai_profiles_is_enabled"), table_name="ai_profiles")
    op.drop_table("ai_profiles")
