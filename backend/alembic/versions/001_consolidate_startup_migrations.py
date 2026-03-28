"""Consolidate all startup ALTER TABLE migrations into proper Alembic migration.

Previously these ran as raw SQL in main.py lifespan on every startup.
Now they run once via Alembic and are tracked in the migration history.

Revision ID: 001
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Users table additions ──
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255) NOT NULL DEFAULT ''")
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type') THEN
                CREATE TYPE account_type AS ENUM ('user', 'developer');
            END IF;
        END $$
    """)
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type account_type NOT NULL DEFAULT 'user'")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(6)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN NOT NULL DEFAULT false")

    # ── Projects table additions ──
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo VARCHAR(500)")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT")
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63) UNIQUE")
    op.execute("ALTER TABLE projects ALTER COLUMN build_path TYPE TEXT")

    # ── File tables additions ──
    op.execute("ALTER TABLE file_uploads ADD COLUMN IF NOT EXISTS file_data TEXT")
    op.execute("ALTER TABLE app_field_files ADD COLUMN IF NOT EXISTS file_data TEXT")
    op.execute("ALTER TABLE app_record_files ADD COLUMN IF NOT EXISTS file_data TEXT")


def downgrade() -> None:
    # These columns are additive — downgrade is intentionally a no-op
    # to avoid data loss. Drop columns manually if truly needed.
    pass
