"""structured resource tables and org shares"""

from alembic import op
import sqlalchemy as sa

revision = "0005_structured_resources"
down_revision = "0004_organizations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_tasks",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("tenant_id", sa.Text(), nullable=False),
        sa.Column("owner_id", sa.Text(), nullable=False),
        sa.Column("org_id", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False, server_default="live"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("request", sa.Text(), nullable=False, server_default=""),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("ix_resource_tasks_scope", "resource_tasks", ["tenant_id", "owner_id"])
    op.create_index("ix_resource_tasks_org", "resource_tasks", ["org_id"])

    op.create_table(
        "resource_datasets",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("tenant_id", sa.Text(), nullable=False),
        sa.Column("owner_id", sa.Text(), nullable=False),
        sa.Column("org_id", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False, server_default="table"),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("column_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.Text(), nullable=False),
    )
    op.create_index("ix_resource_datasets_scope", "resource_datasets", ["tenant_id", "owner_id"])
    op.create_index("ix_resource_datasets_org", "resource_datasets", ["org_id"])

    op.create_table(
        "resource_artifacts",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("tenant_id", sa.Text(), nullable=False),
        sa.Column("owner_id", sa.Text(), nullable=False),
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("artifact_type", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
    )
    op.create_index("ix_resource_artifacts_scope", "resource_artifacts", ["tenant_id", "owner_id"])
    op.create_index("ix_resource_artifacts_task", "resource_artifacts", ["task_id"])

    op.create_table(
        "org_shares",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("tenant_id", sa.Text(), nullable=False),
        sa.Column("resource_type", sa.Text(), nullable=False),
        sa.Column("resource_id", sa.Text(), nullable=False),
        sa.Column("shared_by", sa.Text(), nullable=False),
        sa.Column("permission", sa.Text(), nullable=False, server_default="read"),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("org_id", "resource_type", "resource_id", name="uq_org_shares_resource"),
    )
    op.create_index("ix_org_shares_org", "org_shares", ["org_id", "resource_type"])

    op.create_table(
        "oidc_identities",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("issuer", "subject", name="uq_oidc_issuer_subject"),
    )
    op.create_index("ix_oidc_identities_user_id", "oidc_identities", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_oidc_identities_user_id", table_name="oidc_identities")
    op.drop_table("oidc_identities")
    op.drop_index("ix_org_shares_org", table_name="org_shares")
    op.drop_table("org_shares")
    op.drop_index("ix_resource_artifacts_task", table_name="resource_artifacts")
    op.drop_index("ix_resource_artifacts_scope", table_name="resource_artifacts")
    op.drop_table("resource_artifacts")
    op.drop_index("ix_resource_datasets_org", table_name="resource_datasets")
    op.drop_index("ix_resource_datasets_scope", table_name="resource_datasets")
    op.drop_table("resource_datasets")
    op.drop_index("ix_resource_tasks_org", table_name="resource_tasks")
    op.drop_index("ix_resource_tasks_scope", table_name="resource_tasks")
    op.drop_table("resource_tasks")
