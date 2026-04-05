from __future__ import annotations

from datetime import datetime
import enum
import uuid

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


def enum_values(enum_cls: type[enum.Enum]) -> list[str]:
  return [str(member.value) for member in enum_cls]


class CashShiftStatus(str, enum.Enum):
  OPEN = "OPEN"
  CLOSED = "CLOSED"


class CaptureRequestStatus(str, enum.Enum):
  PENDING = "pending"
  OPENED = "opened"
  UPLOADED = "uploaded"
  APPROVED = "approved"
  REJECTED = "rejected"
  EXPIRED = "expired"
  CANCELED = "canceled"


class ProofValidationStatus(str, enum.Enum):
  PENDING = "pending"
  APPROVED = "approved"
  REJECTED = "rejected"


class AccessLevel(str, enum.Enum):
  NONE = "NONE"
  VIEW = "VIEW"
  OPERATE = "OPERATE"
  MANAGE = "MANAGE"


class Branch(Base):
  __tablename__ = "branches"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  name: Mapped[str] = mapped_column(Text)
  is_active: Mapped[bool] = mapped_column(default=True)


class Profile(Base):
  __tablename__ = "profiles"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  full_name: Mapped[str] = mapped_column(Text)
  username: Mapped[str] = mapped_column(Text)
  is_active: Mapped[bool] = mapped_column(default=True)


class Module(Base):
  __tablename__ = "modules"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  code: Mapped[str] = mapped_column(Text)


class Role(Base):
  __tablename__ = "roles"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  code: Mapped[str] = mapped_column(Text)


class UserBranchRole(Base, TimestampMixin):
  __tablename__ = "user_branch_roles"
  __table_args__ = (UniqueConstraint("user_id", "branch_id", "role_id", name="uq_user_branch_roles_user_branch_role"), {"schema": "public"})

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="CASCADE"), nullable=False)
  branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.branches.id", ondelete="CASCADE"), nullable=False)
  role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.roles.id"), nullable=False)
  is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class UserGlobalRole(Base, TimestampMixin):
  __tablename__ = "user_global_roles"
  __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_global_roles_user_role"), {"schema": "public"})

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="CASCADE"), nullable=False)
  role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.roles.id"), nullable=False)
  is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class RolePermission(Base, TimestampMixin):
  __tablename__ = "role_permissions"
  __table_args__ = {"schema": "public"}

  role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.roles.id", ondelete="CASCADE"), primary_key=True)
  module_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.modules.id", ondelete="CASCADE"), primary_key=True)
  access_level: Mapped[AccessLevel] = mapped_column(
    Enum(AccessLevel, name="access_level", schema="public", values_callable=enum_values),
    nullable=False,
  )


class CashShift(Base):
  __tablename__ = "cash_shifts"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.branches.id"), nullable=False)
  cashier_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"), nullable=False)
  capture_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"), nullable=True)
  capture_device_label: Mapped[str | None] = mapped_column(Text, nullable=True)
  opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  status: Mapped[CashShiftStatus] = mapped_column(
    Enum(CashShiftStatus, name="cash_shift_status", schema="public", values_callable=enum_values),
    nullable=False,
  )
  notes: Mapped[str | None] = mapped_column(Text)


class CashShiftUser(Base):
  __tablename__ = "cash_shift_users"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  shift_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.cash_shifts.id", ondelete="CASCADE"), nullable=False)
  user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="CASCADE"), nullable=False)
  is_enabled: Mapped[bool] = mapped_column(nullable=False, default=True)
  can_use_caja: Mapped[bool] = mapped_column(nullable=False, default=False)
  is_supervisor: Mapped[bool] = mapped_column(nullable=False, default=False)


class Order(Base):
  __tablename__ = "orders"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.branches.id"), nullable=False)
  status: Mapped[str] = mapped_column(Text, nullable=False)
  cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentMethod(Base):
  __tablename__ = "payment_methods"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.branches.id"), nullable=False)
  name: Mapped[str] = mapped_column(Text, nullable=False)


class Payment(Base):
  __tablename__ = "payments"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
  order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.orders.id"), nullable=False)
  amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
  currency: Mapped[str | None] = mapped_column(String(8))
  status: Mapped[str] = mapped_column(String(24), nullable=False, default="completed")
  payment_method_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.payment_methods.id"), nullable=False)
  created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"), nullable=False)
  notes: Mapped[str | None] = mapped_column(Text)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PaymentCaptureRequest(Base, TimestampMixin):
  __tablename__ = "payment_capture_requests"
  __table_args__ = (
    Index("ix_payment_capture_requests_secure_token", "secure_token", unique=True),
    Index("ix_payment_capture_requests_branch_status", "branch_id", "status"),
    {"schema": "public"},
  )

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  cash_session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.cash_shifts.id", ondelete="CASCADE"), nullable=False)
  payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.payments.id", ondelete="CASCADE"), nullable=False)
  branch_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.branches.id"), nullable=False)
  requested_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"), nullable=False)
  assigned_capture_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"), nullable=False)
  status: Mapped[CaptureRequestStatus] = mapped_column(
    Enum(CaptureRequestStatus, name="payment_capture_request_status", schema="public", values_callable=enum_values),
    nullable=False,
    default=CaptureRequestStatus.PENDING,
  )
  secure_token: Mapped[str] = mapped_column(String(64), nullable=False)
  token_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
  opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

  payment: Mapped[Payment] = relationship()
  proofs: Mapped[list["PaymentProof"]] = relationship(back_populates="capture_request")


class PaymentProof(Base, TimestampMixin):
  __tablename__ = "payment_proofs"
  __table_args__ = (
    Index("ix_payment_proofs_payment_id", "payment_id"),
    Index("ix_payment_proofs_capture_request_id", "capture_request_id"),
    {"schema": "public"},
  )

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  payment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.payments.id", ondelete="CASCADE"), nullable=False)
  capture_request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.payment_capture_requests.id", ondelete="CASCADE"), nullable=False)
  bucket_name: Mapped[str] = mapped_column(String(255), nullable=False)
  object_path: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
  file_name_stored: Mapped[str] = mapped_column(String(255), nullable=False)
  original_file_name: Mapped[str | None] = mapped_column(String(255))
  mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
  file_size: Mapped[int] = mapped_column(Integer, nullable=False)
  sha256_hash: Mapped[str] = mapped_column(String(64), nullable=False)
  image_width: Mapped[int | None] = mapped_column(Integer)
  image_height: Mapped[int | None] = mapped_column(Integer)
  uploaded_by_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"), nullable=False)
  uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
  validation_status: Mapped[ProofValidationStatus] = mapped_column(
    Enum(ProofValidationStatus, name="payment_proof_validation_status", schema="public", values_callable=enum_values),
    nullable=False,
    default=ProofValidationStatus.PENDING,
  )
  validated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"))
  validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
  rejection_reason: Mapped[str | None] = mapped_column(Text)

  capture_request: Mapped[PaymentCaptureRequest] = relationship(back_populates="proofs")


class AuditLog(Base):
  __tablename__ = "audit_log"
  __table_args__ = {"schema": "public"}

  id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("public.profiles.id"))
  action: Mapped[str] = mapped_column(Text, nullable=False)
  entity: Mapped[str] = mapped_column(Text, nullable=False)
  entity_id: Mapped[str | None] = mapped_column(Text)
  before_data: Mapped[dict | None] = mapped_column(JSONB)
  after_data: Mapped[dict | None] = mapped_column(JSONB)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
