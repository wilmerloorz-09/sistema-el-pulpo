from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile

from app.models.payment_proof import CaptureRequestStatus, PaymentCaptureRequest, PaymentProof, ProofValidationStatus
from app.services.audit_service import AuditService
from app.services.image_validation_service import ValidatedImage
from app.services.payment_capture_service import PaymentCaptureService, PaymentContext
from app.services.payment_proof_service import PaymentProofService


def make_payment_context(actor_id):
  branch_id = uuid4()
  payment_id = uuid4()
  return PaymentContext(
    payment=SimpleNamespace(id=payment_id, status="completed", currency="USD", amount="14.00"),
    order=SimpleNamespace(id=uuid4(), branch_id=branch_id, status="PAID"),
    payment_method=SimpleNamespace(name="Transferencia"),
    cash_shift=SimpleNamespace(id=uuid4(), status="OPEN", capture_user_id=actor_id, branch_id=branch_id, cashier_id=actor_id, capture_device_label="Moto G"),
  )


def test_create_capture_request_for_valid_transfer(settings, actor, audit_context):
  db = Mock()
  db.scalar.return_value = None

  permission_service = Mock()
  permission_service.can_validate_payment_proof.return_value = True
  permission_service.can_manage_cash_session.return_value = True

  service = PaymentCaptureService(settings=settings, audit_service=AuditService(), permission_service=permission_service)
  service._load_payment_context = Mock(return_value=make_payment_context(actor.id))

  result = service.create_capture_request(db, payment_id=uuid4(), actor=actor, context=audit_context)

  assert result.status == CaptureRequestStatus.PENDING
  assert result.assigned_capture_user_id == actor.id
  db.add.assert_called_once()
  db.commit.assert_called_once()


def test_rejects_request_for_non_transfer(settings, actor, audit_context):
  db = Mock()
  permission_service = Mock()
  permission_service.can_validate_payment_proof.return_value = True
  service = PaymentCaptureService(settings=settings, audit_service=AuditService(), permission_service=permission_service)
  context = make_payment_context(actor.id)
  context.payment_method.name = "Efectivo"
  service._load_payment_context = Mock(return_value=context)

  with pytest.raises(HTTPException) as exc:
    service.create_capture_request(db, payment_id=uuid4(), actor=actor, context=audit_context)

  assert exc.value.status_code == 400
  assert exc.value.detail["error_code"] == "payment_method_not_supported"


@pytest.mark.asyncio
async def test_upload_rejects_assigned_request_from_other_user(settings, actor, audit_context):
  db = Mock()
  foreign_request = PaymentCaptureRequest(
    id=uuid4(),
    cash_session_id=uuid4(),
    payment_id=uuid4(),
    branch_id=uuid4(),
    requested_by_user_id=uuid4(),
    assigned_capture_user_id=uuid4(),
    status=CaptureRequestStatus.PENDING,
    secure_token="abc",
    token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
  )
  db.scalar.return_value = foreign_request

  permission_service = Mock()
  permission_service.assert_capture_request_access.side_effect = HTTPException(status_code=403, detail={"error_code": "forbidden_capture_request"})

  capture_service = Mock()
  service = PaymentProofService(
    settings=settings,
    storage_service=Mock(),
    image_validation_service=Mock(),
    audit_service=AuditService(),
    permission_service=permission_service,
    capture_service=capture_service,
  )

  with pytest.raises(HTTPException) as exc:
    await service.upload_capture_proof(db, token="abc", upload_file=UploadFile(filename="x.jpg", file=BytesIO(b"x")), actor=actor, context=audit_context)

  assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_upload_persists_proof_metadata(settings, actor, audit_context):
  capture_request = PaymentCaptureRequest(
    id=uuid4(),
    cash_session_id=uuid4(),
    payment_id=uuid4(),
    branch_id=uuid4(),
    requested_by_user_id=actor.id,
    assigned_capture_user_id=actor.id,
    status=CaptureRequestStatus.PENDING,
    secure_token="abc",
    token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
  )

  db = Mock()
  db.scalar.return_value = capture_request
  db.get.side_effect = [SimpleNamespace(status="completed"), SimpleNamespace(status="OPEN")]

  permission_service = Mock()
  storage_service = Mock()
  image_validation_service = Mock()
  image_validation_service.validate_and_rewrite.return_value = ValidatedImage(
    file_bytes=b"jpeg-bytes",
    file_size=512,
    mime_type="image/jpeg",
    image_width=800,
    image_height=600,
    sha256_hash="a" * 64,
    original_file_name="proof.png",
  )

  service = PaymentProofService(
    settings=settings,
    storage_service=storage_service,
    image_validation_service=image_validation_service,
    audit_service=AuditService(),
    permission_service=permission_service,
    capture_service=Mock(),
  )
  service._has_abusive_attempts = Mock(return_value=False)

  request_after, proof = await service.upload_capture_proof(
      db,
      token="abc",
      upload_file=UploadFile(filename="proof.png", file=BytesIO(b"proof")),
      actor=actor,
      context=audit_context,
    )

  assert request_after.status == CaptureRequestStatus.UPLOADED
  assert proof.validation_status == ProofValidationStatus.PENDING
  assert proof.mime_type == "image/jpeg"
  storage_service.upload_bytes.assert_called_once()
  db.add.assert_called()
  db.commit.assert_called_once()


def test_generates_signed_view_url(settings, actor):
  db = Mock()
  proof = SimpleNamespace(object_path="branches/a/cash-sessions/b/payments/c/d.jpg")
  capture_request = SimpleNamespace(branch_id=uuid4(), cash_session_id=uuid4(), assigned_capture_user_id=actor.id)
  storage_service = Mock()
  storage_service.create_signed_url.return_value = SimpleNamespace(url="https://signed-url", expires_in_seconds=120)
  permission_service = Mock()
  permission_service.can_view_payment_proof.return_value = True

  service = PaymentProofService(
    settings=settings,
    storage_service=storage_service,
    image_validation_service=Mock(),
    audit_service=AuditService(),
    permission_service=permission_service,
    capture_service=Mock(),
  )
  service.get_payment_proof = Mock(return_value=(proof, capture_request))

  signed = service.get_signed_view_url(db, payment_id=uuid4(), actor=actor)

  assert signed.url == "https://signed-url"
  assert signed.expires_in_seconds == 120


def test_rejects_expired_token_on_upload(settings, actor, audit_context):
  db = Mock()
  expired_request = PaymentCaptureRequest(
    id=uuid4(),
    cash_session_id=uuid4(),
    payment_id=uuid4(),
    branch_id=uuid4(),
    requested_by_user_id=actor.id,
    assigned_capture_user_id=actor.id,
    status=CaptureRequestStatus.PENDING,
    secure_token="expired",
    token_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
  )
  permission_service = Mock()
  service = PaymentProofService(
    settings=settings,
    storage_service=Mock(),
    image_validation_service=Mock(),
    audit_service=AuditService(),
    permission_service=permission_service,
    capture_service=Mock(),
  )

  with pytest.raises(HTTPException) as exc:
    service._assert_request_upload_allowed(db, expired_request)

  assert exc.value.status_code == 409
  assert exc.value.detail["error_code"] == "capture_request_expired"


def test_approve_and_reject_flow(settings, actor, audit_context):
  db = Mock()
  capture_request = PaymentCaptureRequest(
    id=uuid4(),
    cash_session_id=uuid4(),
    payment_id=uuid4(),
    branch_id=uuid4(),
    requested_by_user_id=actor.id,
    assigned_capture_user_id=actor.id,
    status=CaptureRequestStatus.UPLOADED,
    secure_token="token",
    token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
  )
  proof = PaymentProof(
    id=uuid4(),
    payment_id=capture_request.payment_id,
    capture_request_id=capture_request.id,
    bucket_name="payment-proofs",
    object_path="path.jpg",
    file_name_stored="path.jpg",
    mime_type="image/jpeg",
    file_size=100,
    sha256_hash="b" * 64,
    uploaded_by_user_id=actor.id,
    validation_status=ProofValidationStatus.PENDING,
  )

  permission_service = Mock()
  permission_service.can_validate_payment_proof.return_value = True

  service = PaymentProofService(
    settings=settings,
    storage_service=Mock(),
    image_validation_service=Mock(),
    audit_service=AuditService(),
    permission_service=permission_service,
    capture_service=Mock(),
  )
  service._load_latest_proof_for_update = Mock(return_value=(proof, capture_request))

  approved = service.approve_proof(db, payment_id=capture_request.payment_id, actor=actor, context=audit_context)
  assert approved.validation_status == ProofValidationStatus.APPROVED

  capture_request.status = CaptureRequestStatus.UPLOADED
  proof.validation_status = ProofValidationStatus.PENDING
  service._load_latest_proof_for_update = Mock(return_value=(proof, capture_request))
  service.capture_service.create_capture_request.return_value = PaymentCaptureRequest(
    id=uuid4(),
    cash_session_id=capture_request.cash_session_id,
    payment_id=capture_request.payment_id,
    branch_id=capture_request.branch_id,
    requested_by_user_id=actor.id,
    assigned_capture_user_id=actor.id,
    status=CaptureRequestStatus.PENDING,
    secure_token="replacement",
    token_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
  )
  db.get.return_value = SimpleNamespace(status="completed")

  rejected, replacement = service.reject_proof(db, payment_id=capture_request.payment_id, reason="Foto borrosa", actor=actor, context=audit_context)
  assert rejected.validation_status == ProofValidationStatus.REJECTED
  assert replacement is not None
