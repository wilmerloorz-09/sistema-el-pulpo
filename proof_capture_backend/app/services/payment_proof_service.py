from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.payment_proof import CaptureRequestStatus, CashShift, Payment, PaymentCaptureRequest, PaymentProof, ProofValidationStatus
from app.schemas.payment_proof import SignedProofUrlResponse
from app.services.audit_service import AuditService, RequestAuditContext
from app.services.auth_service import AuthenticatedUser
from app.services.image_validation_service import ImageValidationService, InvalidImageError
from app.services.payment_capture_service import PaymentCaptureService
from app.services.payment_proof_analysis_service import PaymentProofAnalysisService
from app.services.permission_service import PermissionService
from app.services.storage_service import StorageService, StorageServiceError


def _utcnow() -> datetime:
  return datetime.now(timezone.utc)


class PaymentProofService:
  def __init__(
    self,
    *,
    settings: Settings,
    storage_service: StorageService,
    image_validation_service: ImageValidationService,
    payment_proof_analysis_service: PaymentProofAnalysisService,
    audit_service: AuditService,
    permission_service: PermissionService,
    capture_service: PaymentCaptureService,
  ) -> None:
    self.settings = settings
    self.storage_service = storage_service
    self.image_validation_service = image_validation_service
    self.payment_proof_analysis_service = payment_proof_analysis_service
    self.audit_service = audit_service
    self.permission_service = permission_service
    self.capture_service = capture_service

  async def upload_capture_proof(self, db: Session, *, token: str, upload_file: UploadFile, actor: AuthenticatedUser, context: RequestAuditContext) -> tuple[PaymentCaptureRequest, PaymentProof]:
    capture_request = db.scalar(select(PaymentCaptureRequest).where(PaymentCaptureRequest.secure_token == token).with_for_update())
    if not capture_request:
      raise self._not_found("No se encontro la solicitud de captura.", "capture_request_not_found")

    self.permission_service.assert_capture_request_access(db, user=actor, capture_request=capture_request)
    self._assert_request_upload_allowed(db, capture_request)

    if self._has_abusive_attempts(db, actor.id):
      raise self._too_many_requests("Demasiados intentos fallidos. Espera unos minutos antes de reintentar.", "too_many_attempts")

    self.audit_service.log_event(
      db,
      actor_user_id=actor.id,
      action="capture_upload_started",
      entity="payment_capture_requests",
      entity_id=str(capture_request.id),
      after_data={"payment_id": str(capture_request.payment_id)},
      context=context,
    )

    try:
      validated = await self.image_validation_service.validate_and_rewrite(upload_file)
    except InvalidImageError as exc:
      self.audit_service.log_event(
        db,
        actor_user_id=actor.id,
        action="suspicious_upload_attempt",
        entity="payment_capture_requests",
        entity_id=str(capture_request.id),
        after_data={"reason": exc.error_code},
        context=context,
      )
      db.commit()
      raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": str(exc), "data": None, "error_code": exc.error_code}) from exc

    proof_id = uuid4()
    object_path = f"branches/{capture_request.branch_id}/cash-sessions/{capture_request.cash_session_id}/payments/{capture_request.payment_id}/{proof_id}.jpg"
    try:
      self.storage_service.upload_bytes(object_path=object_path, payload=validated.file_bytes, content_type=validated.mime_type)
    except StorageServiceError as exc:
      raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail={"success": False, "message": str(exc), "data": None, "error_code": "storage_upload_failed"}) from exc

    proof = PaymentProof(
      id=proof_id,
      payment_id=capture_request.payment_id,
      capture_request_id=capture_request.id,
      bucket_name=self.storage_service.bucket_name,
      object_path=object_path,
      file_name_stored=f"{proof_id}.jpg",
      original_file_name=validated.original_file_name,
      mime_type=validated.mime_type,
      file_size=validated.file_size,
      sha256_hash=validated.sha256_hash,
      image_width=validated.image_width,
      image_height=validated.image_height,
      uploaded_by_user_id=actor.id,
      analysis_status="pending",
      validation_status=ProofValidationStatus.PENDING,
    )

    payment = db.get(Payment, capture_request.payment_id)
    try:
      analysis = self.payment_proof_analysis_service.analyze_payment_proof(
        image_bytes=validated.file_bytes,
        expected_amount=payment.amount if payment else 0,
      )
      proof.ocr_text = analysis.ocr_text
      proof.analysis_status = analysis.status
      proof.detected_amount = analysis.detected_amount
      proof.amount_matches_expected = analysis.amount_matches_expected
      proof.analysis_summary = analysis.summary
      proof.analysis_error_code = analysis.error_code
      proof.analysis_ran_at = analysis.ran_at
    except Exception as exc:
      proof.analysis_status = "error"
      proof.analysis_summary = "No se pudo analizar automaticamente el comprobante. Requiere revision manual."
      proof.analysis_error_code = "analysis_failed"
      proof.analysis_ran_at = _utcnow()
      self.audit_service.log_event(
        db,
        actor_user_id=actor.id,
        action="capture_analysis_failed",
        entity="payment_proofs",
        entity_id=str(proof.id),
        after_data={"capture_request_id": str(capture_request.id), "reason": str(exc)},
        context=context,
      )

    capture_request.status = CaptureRequestStatus.UPLOADED
    capture_request.uploaded_at = _utcnow()
    db.add(proof)

    try:
      self.audit_service.log_event(
        db,
        actor_user_id=actor.id,
        action="capture_uploaded",
        entity="payment_proofs",
        entity_id=str(proof.id),
        after_data={"object_path": object_path, "capture_request_id": str(capture_request.id)},
        context=context,
      )
      db.commit()
    except Exception:
      db.rollback()
      try:
        self.storage_service.delete_object(object_path)
      except StorageServiceError:
        db.begin()
        self.audit_service.log_event(
          db,
          actor_user_id=actor.id,
          action="suspicious_upload_attempt",
          entity="payment_proofs",
          entity_id=str(proof.id),
          after_data={"orphaned_object_path": object_path, "reason": "db_failure_after_upload"},
          context=context,
        )
        db.commit()
      raise

    db.refresh(capture_request)
    db.refresh(proof)
    return capture_request, proof

  def approve_proof(self, db: Session, *, payment_id: UUID, actor: AuthenticatedUser, context: RequestAuditContext) -> PaymentProof:
    proof, capture_request = self._load_latest_proof_for_update(db, payment_id)
    if not self.permission_service.can_validate_payment_proof(db, user=actor, branch_id=capture_request.branch_id, cash_session_id=capture_request.cash_session_id):
      raise self._forbidden("No tienes permisos para aprobar comprobantes.", "forbidden_approve_proof")
    if capture_request.status != CaptureRequestStatus.UPLOADED:
      raise self._conflict("Solo se pueden aprobar comprobantes ya subidos.", "invalid_capture_request_state")

    proof.validation_status = ProofValidationStatus.APPROVED
    proof.validated_by_user_id = actor.id
    proof.validated_at = _utcnow()
    proof.rejection_reason = None
    capture_request.status = CaptureRequestStatus.APPROVED
    capture_request.approved_at = _utcnow()
    self.audit_service.log_event(db, actor_user_id=actor.id, action="capture_approved", entity="payment_proofs", entity_id=str(proof.id), after_data={"payment_id": str(payment_id)}, context=context)
    db.commit()
    db.refresh(proof)
    return proof

  def reject_proof(self, db: Session, *, payment_id: UUID, reason: str, actor: AuthenticatedUser, context: RequestAuditContext) -> tuple[PaymentProof, PaymentCaptureRequest | None]:
    proof, capture_request = self._load_latest_proof_for_update(db, payment_id)
    if not self.permission_service.can_validate_payment_proof(db, user=actor, branch_id=capture_request.branch_id, cash_session_id=capture_request.cash_session_id):
      raise self._forbidden("No tienes permisos para rechazar comprobantes.", "forbidden_reject_proof")
    if capture_request.status != CaptureRequestStatus.UPLOADED:
      raise self._conflict("Solo se pueden rechazar comprobantes ya subidos.", "invalid_capture_request_state")

    proof.validation_status = ProofValidationStatus.REJECTED
    proof.validated_by_user_id = actor.id
    proof.validated_at = _utcnow()
    proof.rejection_reason = reason
    capture_request.status = CaptureRequestStatus.REJECTED
    capture_request.rejected_at = _utcnow()
    self.audit_service.log_event(db, actor_user_id=actor.id, action="capture_rejected", entity="payment_proofs", entity_id=str(proof.id), after_data={"payment_id": str(payment_id), "reason": reason}, context=context)
    db.commit()

    replacement: PaymentCaptureRequest | None = None
    payment = db.get(Payment, payment_id)
    if payment and payment.status.lower() not in {"canceled", "cancelled", "voided"}:
      replacement = self.capture_service.create_capture_request(db, payment_id=payment_id, actor=actor, context=context)

    db.refresh(proof)
    return proof, replacement

  def get_payment_proof(self, db: Session, *, payment_id: UUID, actor: AuthenticatedUser) -> tuple[PaymentProof | None, PaymentCaptureRequest | None]:
    proof, capture_request = self._load_latest_proof_optional(db, payment_id)
    if not capture_request:
      return None, None
    if not self.permission_service.can_view_payment_proof(db, user=actor, branch_id=capture_request.branch_id, cash_session_id=capture_request.cash_session_id, capture_request=capture_request):
      raise self._forbidden("No tienes permisos para ver este comprobante.", "forbidden_view_proof")
    return proof, capture_request

  def get_signed_view_url(self, db: Session, *, payment_id: UUID, actor: AuthenticatedUser) -> SignedProofUrlResponse:
    proof, capture_request = self.get_payment_proof(db, payment_id=payment_id, actor=actor)
    if not proof or not capture_request:
      raise self._not_found("Aun no existe comprobante para este pago.", "payment_proof_not_found")
    signed = self.storage_service.create_signed_url(proof.object_path)
    return SignedProofUrlResponse(url=signed.url, expires_in_seconds=signed.expires_in_seconds)

  def _assert_request_upload_allowed(self, db: Session, capture_request: PaymentCaptureRequest) -> None:
    if capture_request.status not in {CaptureRequestStatus.PENDING, CaptureRequestStatus.OPENED}:
      raise self._conflict("La solicitud ya no acepta nuevas fotos.", "capture_request_closed")
    if capture_request.token_expires_at < _utcnow():
      capture_request.status = CaptureRequestStatus.EXPIRED
      db.commit()
      raise self._conflict("La solicitud ya expiro.", "capture_request_expired")
    payment = db.get(Payment, capture_request.payment_id)
    if not payment or payment.status.lower() in {"canceled", "cancelled", "voided"}:
      capture_request.status = CaptureRequestStatus.CANCELED
      capture_request.canceled_at = _utcnow()
      db.commit()
      raise self._conflict("El pago ya no admite carga de comprobantes.", "payment_canceled")
    cash_shift = db.get(CashShift, capture_request.cash_session_id)
    if not cash_shift or cash_shift.status != "OPEN":
      capture_request.status = CaptureRequestStatus.CANCELED
      capture_request.canceled_at = _utcnow()
      db.commit()
      raise self._conflict("La caja ya fue cerrada.", "cash_session_closed")

  def _has_abusive_attempts(self, db: Session, user_id: UUID) -> bool:
    threshold = _utcnow() - timedelta(minutes=self.settings.payment_capture_attempt_window_minutes)
    attempts = db.execute(
      select(func.count())
      .select_from(PaymentProof)
      .where(PaymentProof.uploaded_by_user_id == user_id, PaymentProof.created_at >= threshold),
    ).scalar_one()
    return attempts >= self.settings.payment_capture_max_attempts_per_window

  def _load_latest_proof_for_update(self, db: Session, payment_id: UUID) -> tuple[PaymentProof, PaymentCaptureRequest]:
    row = db.execute(
      select(PaymentProof, PaymentCaptureRequest)
      .join(PaymentCaptureRequest, PaymentCaptureRequest.id == PaymentProof.capture_request_id)
      .where(PaymentProof.payment_id == payment_id)
      .order_by(desc(PaymentProof.created_at))
      .with_for_update()
      .limit(1),
    ).first()
    if not row:
      raise self._not_found("No existe comprobante para este pago.", "payment_proof_not_found")
    return row

  def _load_latest_proof_optional(self, db: Session, payment_id: UUID) -> tuple[PaymentProof | None, PaymentCaptureRequest | None]:
    row = db.execute(
      select(PaymentProof, PaymentCaptureRequest)
      .join(PaymentCaptureRequest, PaymentCaptureRequest.id == PaymentProof.capture_request_id)
      .where(PaymentProof.payment_id == payment_id)
      .order_by(desc(PaymentProof.created_at))
      .limit(1),
    ).first()
    if row:
      return row
    capture_request = db.scalar(select(PaymentCaptureRequest).where(PaymentCaptureRequest.payment_id == payment_id).order_by(desc(PaymentCaptureRequest.created_at)).limit(1))
    return None, capture_request

  @staticmethod
  def _forbidden(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"success": False, "message": message, "data": None, "error_code": error_code})

  @staticmethod
  def _not_found(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"success": False, "message": message, "data": None, "error_code": error_code})

  @staticmethod
  def _conflict(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"success": False, "message": message, "data": None, "error_code": error_code})

  @staticmethod
  def _too_many_requests(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail={"success": False, "message": message, "data": None, "error_code": error_code})
