"""add organizations, members, invites for collaboration"""

from alembic import op
import sqlalchemy as sa

revision = "0004_organizations"
down_revision = "0003_scope_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("tenant_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("owner_user_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_organizations_tenant_slug"),
    )
    op.create_index("ix_organizations_tenant_id", "organizations", ["tenant_id"])

    op.create_table(
        "organization_members",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("joined_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("org_id", "user_id", name="uq_org_members_org_user"),
    )
    op.create_index("ix_organization_members_user_id", "organization_members", ["user_id"])
    op.create_index("ix_organization_members_org_id", "organization_members", ["org_id"])

    op.create_table(
        "organization_invites",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("created_at", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.Text(), nullable=False),
        sa.UniqueConstraint("token", name="uq_org_invites_token"),
    )
    op.create_index("ix_organization_invites_org_id", "organization_invites", ["org_id"])
    op.create_index("ix_organization_invites_username", "organization_invites", ["username"])


def downgrade() -> None:
    op.drop_index("ix_organization_invites_username", table_name="organization_invites")
    op.drop_index("ix_organization_invites_org_id", table_name="organization_invites")
    op.drop_table("organization_invites")
    op.drop_index("ix_organization_members_org_id", table_name="organization_members")
    op.drop_index("ix_organization_members_user_id", table_name="organization_members")
    op.drop_table("organization_members")
    op.drop_index("ix_organizations_tenant_id", table_name="organizations")
    op.drop_table("organizations")
