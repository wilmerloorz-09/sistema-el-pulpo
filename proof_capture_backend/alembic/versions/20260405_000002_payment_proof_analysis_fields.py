"""add payment proof analysis fields

Revision ID: 20260405_000002
Revises: 20260404_000001
Create Date: 2026-04-05 13:00:00
"""

from alembic import op
import sqlalchemy as sa


revision = "20260405_000002"
down_revision = "20260404_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.add_column("payment_proofs", sa.Column("ocr_text", sa.Text(), nullable=True), schema="public")
  op.add_column("payment_proofs", sa.Column("analysis_status", sa.String(length=32), server_default="pending", nullable=False), schema="public")
  op.add_column("payment_proofs", sa.Column("detected_amount", sa.Numeric(10, 2), nullable=True), schema="public")
  op.add_column("payment_proofs", sa.Column("amount_matches_expected", sa.Boolean(), nullable=True), schema="public")
  op.add_column("payment_proofs", sa.Column("analysis_summary", sa.Text(), nullable=True), schema="public")
  op.add_column("payment_proofs", sa.Column("analysis_error_code", sa.String(length=64), nullable=True), schema="public")
  op.add_column("payment_proofs", sa.Column("analysis_ran_at", sa.DateTime(timezone=True), nullable=True), schema="public")
  op.alter_column("payment_proofs", "analysis_status", server_default=None, schema="public")


def downgrade() -> None:
  op.drop_column("payment_proofs", "analysis_ran_at", schema="public")
  op.drop_column("payment_proofs", "analysis_error_code", schema="public")
  op.drop_column("payment_proofs", "analysis_summary", schema="public")
  op.drop_column("payment_proofs", "amount_matches_expected", schema="public")
  op.drop_column("payment_proofs", "detected_amount", schema="public")
  op.drop_column("payment_proofs", "analysis_status", schema="public")
  op.drop_column("payment_proofs", "ocr_text", schema="public")
