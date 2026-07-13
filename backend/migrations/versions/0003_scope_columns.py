"""add scope columns and indexes for relational query"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa

revision = "0003_scope_columns"
down_revision = "0002_users"
branch_labels = None
depends_on = None


def _backfill_payload_scope(connection, table: str) -> None:
    rows = connection.execute(sa.text(f"SELECT id, payload FROM {table}")).fetchall()
    for row in rows:
        row_id = row[0]
        raw_payload = row[1] or "{}"
        try:
            payload = json.loads(raw_payload)
        except (TypeError, ValueError):
            payload = {}
        tenant_id = str(payload.get("tenantId") or "local-tenant")
        owner_id = payload.get("ownerId")
        if not owner_id:
            owner_id = "__system__"
        connection.execute(
            sa.text(f"UPDATE {table} SET tenant_id = :tenant_id, owner_id = :owner_id WHERE id = :id"),
            {"tenant_id": tenant_id, "owner_id": str(owner_id), "id": row_id},
        )


def _backfill_audit_scope(connection) -> None:
    rows = connection.execute(sa.text("SELECT id, payload FROM audit_events")).fetchall()
    for row in rows:
        row_id = row[0]
        raw_payload = row[1] or "{}"
        try:
            payload = json.loads(raw_payload)
        except (TypeError, ValueError):
            payload = {}
        tenant_id = str(payload.get("tenantId") or "local-tenant")
        owner_id = str(payload.get("ownerId") or "local-user")
        connection.execute(
            sa.text("UPDATE audit_events SET tenant_id = :tenant_id, owner_id = :owner_id WHERE id = :id"),
            {"tenant_id": tenant_id, "owner_id": owner_id, "id": row_id},
        )


def upgrade() -> None:
    op.add_column("history_tasks", sa.Column("tenant_id", sa.Text(), nullable=True))
    op.add_column("history_tasks", sa.Column("owner_id", sa.Text(), nullable=True))
    op.add_column("templates", sa.Column("tenant_id", sa.Text(), nullable=True))
    op.add_column("templates", sa.Column("owner_id", sa.Text(), nullable=True))
    op.add_column("audit_events", sa.Column("tenant_id", sa.Text(), nullable=True))
    op.add_column("audit_events", sa.Column("owner_id", sa.Text(), nullable=True))

    connection = op.get_bind()
    _backfill_payload_scope(connection, "history_tasks")
    _backfill_payload_scope(connection, "templates")
    _backfill_audit_scope(connection)

    # Keep nullable=False semantics for new rows; existing rows are already filled.
    with op.batch_alter_table("history_tasks") as batch:
        batch.alter_column("tenant_id", existing_type=sa.Text(), nullable=False)
        batch.alter_column("owner_id", existing_type=sa.Text(), nullable=False)
    with op.batch_alter_table("templates") as batch:
        batch.alter_column("tenant_id", existing_type=sa.Text(), nullable=False)
        batch.alter_column("owner_id", existing_type=sa.Text(), nullable=False)
    with op.batch_alter_table("audit_events") as batch:
        batch.alter_column("tenant_id", existing_type=sa.Text(), nullable=False)
        batch.alter_column("owner_id", existing_type=sa.Text(), nullable=False)

    op.create_index("ix_history_tasks_scope", "history_tasks", ["tenant_id", "owner_id"])
    op.create_index("ix_templates_scope", "templates", ["tenant_id", "owner_id"])
    op.create_index("ix_audit_events_scope_created", "audit_events", ["tenant_id", "owner_id", "created_at"])
    op.create_index("ix_audit_events_action", "audit_events", ["action"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_action", table_name="audit_events")
    op.drop_index("ix_audit_events_scope_created", table_name="audit_events")
    op.drop_index("ix_templates_scope", table_name="templates")
    op.drop_index("ix_history_tasks_scope", table_name="history_tasks")
    op.drop_column("audit_events", "owner_id")
    op.drop_column("audit_events", "tenant_id")
    op.drop_column("templates", "owner_id")
    op.drop_column("templates", "tenant_id")
    op.drop_column("history_tasks", "owner_id")
    op.drop_column("history_tasks", "tenant_id")
