"""payment proofs module

Revision ID: 20260404_000001
Revises:
Create Date: 2026-04-04 17:30:00
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260404_000001"
down_revision = None
branch_labels = None
depends_on = None


capture_status_enum = postgresql.ENUM(
  "pending",
  "opened",
  "uploaded",
  "approved",
  "rejected",
  "expired",
  "canceled",
  name="payment_capture_request_status",
  schema="public",
)

proof_validation_enum = postgresql.ENUM(
  "pending",
  "approved",
  "rejected",
  name="payment_proof_validation_status",
  schema="public",
)


def upgrade() -> None:
  bind = op.get_bind()
  capture_status_enum.create(bind, checkfirst=True)
  proof_validation_enum.create(bind, checkfirst=True)

  op.add_column("cash_shifts", sa.Column("capture_user_id", postgresql.UUID(as_uuid=True), nullable=True), schema="public")
  op.add_column("cash_shifts", sa.Column("capture_device_label", sa.Text(), nullable=True), schema="public")
  op.create_foreign_key("fk_cash_shifts_capture_user_id_profiles", "cash_shifts", "profiles", ["capture_user_id"], ["id"], source_schema="public", referent_schema="public")

  op.add_column("payments", sa.Column("currency", sa.String(length=8), nullable=True), schema="public")
  op.add_column("payments", sa.Column("status", sa.String(length=24), server_default="completed", nullable=False), schema="public")
  op.add_column("payments", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False), schema="public")

  op.create_table(
    "payment_capture_requests",
    sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("cash_session_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("branch_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("requested_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("assigned_capture_user_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("status", capture_status_enum, nullable=False, server_default="pending"),
    sa.Column("secure_token", sa.String(length=64), nullable=False),
    sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.ForeignKeyConstraint(["assigned_capture_user_id"], ["public.profiles.id"], ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["branch_id"], ["public.branches.id"], ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["cash_session_id"], ["public.cash_shifts.id"], ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["payment_id"], ["public.payments.id"], ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["requested_by_user_id"], ["public.profiles.id"], ondelete="RESTRICT"),
    sa.PrimaryKeyConstraint("id"),
    schema="public",
  )

  op.create_index("ix_payment_capture_requests_secure_token", "payment_capture_requests", ["secure_token"], unique=True, schema="public")
  op.create_index("ix_payment_capture_requests_branch_status", "payment_capture_requests", ["branch_id", "status"], unique=False, schema="public")
  op.create_index(
    "uq_payment_capture_requests_active_payment",
    "payment_capture_requests",
    ["payment_id"],
    unique=True,
    schema="public",
    postgresql_where=sa.text("status in ('pending','opened','uploaded')"),
  )

  op.create_table(
    "payment_proofs",
    sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("capture_request_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("bucket_name", sa.String(length=255), nullable=False),
    sa.Column("object_path", sa.Text(), nullable=False),
    sa.Column("file_name_stored", sa.String(length=255), nullable=False),
    sa.Column("original_file_name", sa.String(length=255), nullable=True),
    sa.Column("mime_type", sa.String(length=64), nullable=False),
    sa.Column("file_size", sa.Integer(), nullable=False),
    sa.Column("sha256_hash", sa.String(length=64), nullable=False),
    sa.Column("image_width", sa.Integer(), nullable=True),
    sa.Column("image_height", sa.Integer(), nullable=True),
    sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("validation_status", proof_validation_enum, nullable=False, server_default="pending"),
    sa.Column("validated_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
    sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("rejection_reason", sa.Text(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    sa.ForeignKeyConstraint(["capture_request_id"], ["public.payment_capture_requests.id"], ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["payment_id"], ["public.payments.id"], ondelete="CASCADE"),
    sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["public.profiles.id"], ondelete="RESTRICT"),
    sa.ForeignKeyConstraint(["validated_by_user_id"], ["public.profiles.id"], ondelete="RESTRICT"),
    sa.PrimaryKeyConstraint("id"),
    sa.UniqueConstraint("object_path", name="uq_payment_proofs_object_path"),
    schema="public",
  )

  op.create_index("ix_payment_proofs_payment_id", "payment_proofs", ["payment_id"], unique=False, schema="public")
  op.create_index("ix_payment_proofs_capture_request_id", "payment_proofs", ["capture_request_id"], unique=False, schema="public")

  op.execute(
    """
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_proc
        WHERE proname = 'update_updated_at_column'
          AND pg_function_is_visible(oid)
      ) THEN
        DROP TRIGGER IF EXISTS trg_payment_capture_requests_updated_at ON public.payment_capture_requests;
        CREATE TRIGGER trg_payment_capture_requests_updated_at
        BEFORE UPDATE ON public.payment_capture_requests
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

        DROP TRIGGER IF EXISTS trg_payment_proofs_updated_at ON public.payment_proofs;
        CREATE TRIGGER trg_payment_proofs_updated_at
        BEFORE UPDATE ON public.payment_proofs
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

        DROP TRIGGER IF EXISTS trg_payments_updated_at_payment_proofs ON public.payments;
        CREATE TRIGGER trg_payments_updated_at_payment_proofs
        BEFORE UPDATE ON public.payments
        FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
      END IF;
    END $$;
    """
  )


def downgrade() -> None:
  op.execute("DROP TRIGGER IF EXISTS trg_payments_updated_at_payment_proofs ON public.payments;")
  op.execute("DROP TRIGGER IF EXISTS trg_payment_proofs_updated_at ON public.payment_proofs;")
  op.execute("DROP TRIGGER IF EXISTS trg_payment_capture_requests_updated_at ON public.payment_capture_requests;")

  op.drop_index("ix_payment_proofs_capture_request_id", table_name="payment_proofs", schema="public")
  op.drop_index("ix_payment_proofs_payment_id", table_name="payment_proofs", schema="public")
  op.drop_table("payment_proofs", schema="public")

  op.drop_index("uq_payment_capture_requests_active_payment", table_name="payment_capture_requests", schema="public")
  op.drop_index("ix_payment_capture_requests_branch_status", table_name="payment_capture_requests", schema="public")
  op.drop_index("ix_payment_capture_requests_secure_token", table_name="payment_capture_requests", schema="public")
  op.drop_table("payment_capture_requests", schema="public")

  op.drop_column("payments", "updated_at", schema="public")
  op.drop_column("payments", "status", schema="public")
  op.drop_column("payments", "currency", schema="public")

  op.drop_constraint("fk_cash_shifts_capture_user_id_profiles", "cash_shifts", schema="public", type_="foreignkey")
  op.drop_column("cash_shifts", "capture_device_label", schema="public")
  op.drop_column("cash_shifts", "capture_user_id", schema="public")

  proof_validation_enum.drop(op.get_bind(), checkfirst=True)
  capture_status_enum.drop(op.get_bind(), checkfirst=True)
