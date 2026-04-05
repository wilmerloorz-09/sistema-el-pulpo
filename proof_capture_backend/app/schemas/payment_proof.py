from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.payment_proof import CaptureRequestStatus, ProofValidationStatus


class AssignCaptureUserRequest(BaseModel):
  capture_user_id: UUID | None
  capture_device_label: str | None = Field(default=None, max_length=120)


class RejectProofRequest(BaseModel):
  reason: str = Field(min_length=3, max_length=500)


class PaymentSummary(BaseModel):
  payment_id: UUID
  order_id: UUID
  branch_id: UUID
  amount: Decimal
  currency: str | None = None
  payment_method_name: str
  status: str


class CaptureRequestSummary(BaseModel):
  model_config = ConfigDict(from_attributes=True)

  id: UUID
  cash_session_id: UUID
  payment_id: UUID
  branch_id: UUID
  requested_by_user_id: UUID
  assigned_capture_user_id: UUID
  status: CaptureRequestStatus
  secure_token: str
  token_expires_at: datetime
  opened_at: datetime | None = None
  uploaded_at: datetime | None = None
  approved_at: datetime | None = None
  rejected_at: datetime | None = None
  canceled_at: datetime | None = None
  created_at: datetime
  updated_at: datetime


class MobileCaptureRequestView(BaseModel):
  capture_request: CaptureRequestSummary
  payment: PaymentSummary
  capture_user_name: str | None = None
  cash_session_status: str


class PaymentProofSummary(BaseModel):
  model_config = ConfigDict(from_attributes=True)

  id: UUID
  payment_id: UUID
  capture_request_id: UUID
  bucket_name: str
  object_path: str
  file_name_stored: str
  original_file_name: str | None = None
  mime_type: str
  file_size: int
  sha256_hash: str
  image_width: int | None = None
  image_height: int | None = None
  uploaded_by_user_id: UUID
  uploaded_at: datetime
  validation_status: ProofValidationStatus
  validated_by_user_id: UUID | None = None
  validated_at: datetime | None = None
  rejection_reason: str | None = None
  created_at: datetime
  updated_at: datetime


class PaymentProofWithRequest(BaseModel):
  proof: PaymentProofSummary | None
  capture_request: CaptureRequestSummary | None


class SignedProofUrlResponse(BaseModel):
  url: str
  expires_in_seconds: int


class PendingCaptureRequestItem(BaseModel):
  capture_request_id: UUID
  secure_token: str
  payment_id: UUID
  amount: Decimal
  payment_method_name: str
  status: CaptureRequestStatus
  requested_at: datetime
