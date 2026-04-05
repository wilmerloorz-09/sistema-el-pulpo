from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.payment_proof import CaptureRequestStatus, CashShift, Order, Payment, PaymentCaptureRequest, PaymentMethod, Profile
from app.schemas.payment_proof import MobileCaptureRequestView, PaymentSummary, PendingCaptureRequestItem
from app.services.audit_service import AuditService, RequestAuditContext
from app.services.auth_service import AuthenticatedUser
from app.services.permission_service import PermissionService


def _utcnow() -> datetime:
  return datetime.now(timezone.utc)


def _normalize_payment_method(name: str) -> str:
  return " ".join(name.strip().lower().split())


@dataclass(slots=True)
class PaymentContext:
  payment: Payment
  order: Order
  payment_method: PaymentMethod
  cash_shift: CashShift


class PaymentCaptureService:
  def __init__(self, *, settings: Settings, audit_service: AuditService, permission_service: PermissionService) -> None:
    self.settings = settings
    self.audit_service = audit_service
    self.permission_service = permission_service

  def assign_capture_user(
    self,
    db: Session,
    *,
    cash_session_id: UUID,
    capture_user_id: UUID | None,
    capture_device_label: str | None,
    actor: AuthenticatedUser,
    context: RequestAuditContext,
  ) -> CashShift:
    cash_shift = db.get(CashShift, cash_session_id)
    if not cash_shift:
      raise self._not_found("Caja no encontrada.", "cash_session_not_found")
    if cash_shift.status != "OPEN":
      raise self._conflict("No se puede cambiar el capturador con la caja cerrada.", "cash_session_closed")
    if not self.permission_service.can_manage_cash_session(db, user=actor, cash_session=cash_shift):
      raise self._forbidden("No tienes permisos para configurar el capturador de comprobantes.", "forbidden_capture_assignment")

    if capture_user_id:
      capture_user = db.get(Profile, capture_user_id)
      if not capture_user or not capture_user.is_active:
        raise self._bad_request("El usuario capturador no existe o esta inactivo.", "invalid_capture_user")

    before_data = {
      "capture_user_id": str(cash_shift.capture_user_id) if cash_shift.capture_user_id else None,
      "capture_device_label": cash_shift.capture_device_label,
    }
    cash_shift.capture_user_id = capture_user_id
    cash_shift.capture_device_label = capture_device_label

    self.audit_service.log_event(
      db,
      actor_user_id=actor.id,
      action="caja_abierta_con_capture_user",
      entity="cash_shifts",
      entity_id=str(cash_shift.id),
      before_data=before_data,
      after_data={"capture_user_id": str(capture_user_id) if capture_user_id else None, "capture_device_label": capture_device_label},
      context=context,
    )
    db.commit()
    db.refresh(cash_shift)
    return cash_shift

  def create_capture_request(self, db: Session, *, payment_id: UUID, actor: AuthenticatedUser, context: RequestAuditContext) -> PaymentCaptureRequest:
    payment_context = self._load_payment_context(db, payment_id)
    self._assert_transfer_payment(payment_context.payment_method.name)

    if payment_context.payment.status.lower() in {"canceled", "cancelled", "voided"}:
      raise self._conflict("El pago fue anulado y no admite comprobante.", "payment_canceled")

    cash_shift = payment_context.cash_shift
    if cash_shift.status != "OPEN":
      raise self._conflict("La caja vinculada al pago ya no esta abierta.", "cash_session_closed")
    if not cash_shift.capture_user_id:
      raise self._conflict("La caja no tiene usuario movil asignado para capturas.", "capture_user_not_assigned")
    if not self.permission_service.can_validate_payment_proof(db, user=actor, branch_id=payment_context.order.branch_id, cash_session_id=cash_shift.id):
      raise self._forbidden("No tienes permisos para solicitar un comprobante.", "forbidden_create_capture_request")

    active_request = db.scalar(
      select(PaymentCaptureRequest).where(
        PaymentCaptureRequest.payment_id == payment_id,
        PaymentCaptureRequest.status.in_([CaptureRequestStatus.PENDING, CaptureRequestStatus.OPENED, CaptureRequestStatus.UPLOADED]),
      ),
    )
    if active_request:
      return active_request

    capture_request = PaymentCaptureRequest(
      cash_session_id=cash_shift.id,
      payment_id=payment_context.payment.id,
      branch_id=payment_context.order.branch_id,
      requested_by_user_id=actor.id,
      assigned_capture_user_id=cash_shift.capture_user_id,
      status=CaptureRequestStatus.PENDING,
      secure_token=uuid4().hex,
      token_expires_at=_utcnow() + timedelta(minutes=self.settings.payment_capture_token_ttl_minutes),
    )
    db.add(capture_request)
    self.audit_service.log_event(
      db,
      actor_user_id=actor.id,
      action="capture_request_created",
      entity="payment_capture_requests",
      entity_id=str(capture_request.id),
      after_data={"payment_id": str(payment_context.payment.id), "cash_session_id": str(cash_shift.id), "assigned_capture_user_id": str(cash_shift.capture_user_id)},
      context=context,
    )
    db.commit()
    db.refresh(capture_request)
    return capture_request

  def get_capture_request_for_mobile(self, db: Session, *, token: str, actor: AuthenticatedUser) -> MobileCaptureRequestView:
    capture_request = self._get_capture_request_by_token(db, token)
    self.permission_service.assert_capture_request_access(db, user=actor, capture_request=capture_request)
    payment_context = self._load_payment_context(db, capture_request.payment_id)
    capture_user = db.get(Profile, capture_request.assigned_capture_user_id)
    return MobileCaptureRequestView(
      capture_request=capture_request,
      payment=PaymentSummary(
        payment_id=payment_context.payment.id,
        order_id=payment_context.order.id,
        branch_id=payment_context.order.branch_id,
        amount=Decimal(payment_context.payment.amount),
        currency=payment_context.payment.currency,
        payment_method_name=payment_context.payment_method.name,
        status=payment_context.payment.status,
      ),
      capture_user_name=capture_user.full_name if capture_user else None,
      cash_session_status=payment_context.cash_shift.status,
    )

  def open_capture_request(self, db: Session, *, token: str, actor: AuthenticatedUser, context: RequestAuditContext) -> PaymentCaptureRequest:
    capture_request = self._get_capture_request_by_token(db, token)
    self.permission_service.assert_capture_request_access(db, user=actor, capture_request=capture_request)
    self._assert_request_can_receive_upload(capture_request)

    if capture_request.status == CaptureRequestStatus.PENDING:
      capture_request.status = CaptureRequestStatus.OPENED
      capture_request.opened_at = _utcnow()
      self.audit_service.log_event(
        db,
        actor_user_id=actor.id,
        action="capture_request_opened",
        entity="payment_capture_requests",
        entity_id=str(capture_request.id),
        after_data={"status": capture_request.status.value},
        context=context,
      )
      db.commit()
      db.refresh(capture_request)

    return capture_request

  def list_pending_requests(self, db: Session, *, cash_session_id: UUID, actor: AuthenticatedUser) -> list[PendingCaptureRequestItem]:
    cash_shift = db.get(CashShift, cash_session_id)
    if not cash_shift:
      raise self._not_found("Caja no encontrada.", "cash_session_not_found")
    if cash_shift.capture_user_id != actor.id:
      raise self._forbidden("No puedes ver solicitudes de otra caja.", "forbidden_pending_requests")

    rows = db.execute(
      select(
        PaymentCaptureRequest.id,
        PaymentCaptureRequest.secure_token,
        PaymentCaptureRequest.payment_id,
        Payment.amount,
        PaymentMethod.name,
        PaymentCaptureRequest.status,
        PaymentCaptureRequest.created_at,
      )
      .join(Payment, Payment.id == PaymentCaptureRequest.payment_id)
      .join(PaymentMethod, PaymentMethod.id == Payment.payment_method_id)
      .where(
        PaymentCaptureRequest.cash_session_id == cash_session_id,
        PaymentCaptureRequest.assigned_capture_user_id == actor.id,
        PaymentCaptureRequest.status.in_([CaptureRequestStatus.PENDING, CaptureRequestStatus.OPENED]),
      )
      .order_by(PaymentCaptureRequest.created_at.asc()),
    ).all()

    return [
      PendingCaptureRequestItem(capture_request_id=row[0], secure_token=row[1], payment_id=row[2], amount=Decimal(row[3]), payment_method_name=row[4], status=row[5], requested_at=row[6])
      for row in rows
    ]

  def _load_payment_context(self, db: Session, payment_id: UUID) -> PaymentContext:
    row = db.execute(
      select(Payment, Order, PaymentMethod, CashShift)
      .join(Order, Order.id == Payment.order_id)
      .join(PaymentMethod, PaymentMethod.id == Payment.payment_method_id)
      .join(CashShift, (CashShift.branch_id == Order.branch_id) & (CashShift.status == "OPEN"))
      .where(Payment.id == payment_id)
      .limit(1),
    ).first()
    if not row:
      raise self._not_found("No se encontro el pago o su caja activa.", "payment_or_cash_session_not_found")
    payment, order, payment_method, cash_shift = row
    return PaymentContext(payment=payment, order=order, payment_method=payment_method, cash_shift=cash_shift)

  def _assert_transfer_payment(self, payment_method_name: str) -> None:
    if _normalize_payment_method(payment_method_name) != "transferencia":
      raise self._bad_request("Solo los pagos por transferencia generan comprobante.", "payment_method_not_supported")

  def _get_capture_request_by_token(self, db: Session, token: str) -> PaymentCaptureRequest:
    capture_request = db.scalar(select(PaymentCaptureRequest).where(PaymentCaptureRequest.secure_token == token))
    if not capture_request:
      raise self._not_found("No se encontro la solicitud de captura.", "capture_request_not_found")
    return capture_request

  def _assert_request_can_receive_upload(self, capture_request: PaymentCaptureRequest) -> None:
    if capture_request.status in {CaptureRequestStatus.CANCELED, CaptureRequestStatus.EXPIRED, CaptureRequestStatus.REJECTED, CaptureRequestStatus.APPROVED}:
      raise self._conflict("La solicitud ya no acepta nuevas fotos.", "capture_request_closed")
    if capture_request.token_expires_at < _utcnow():
      raise self._conflict("La solicitud ya expiro.", "capture_request_expired")

  @staticmethod
  def _bad_request(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"success": False, "message": message, "data": None, "error_code": error_code})

  @staticmethod
  def _not_found(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"success": False, "message": message, "data": None, "error_code": error_code})

  @staticmethod
  def _conflict(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"success": False, "message": message, "data": None, "error_code": error_code})

  @staticmethod
  def _forbidden(message: str, error_code: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"success": False, "message": message, "data": None, "error_code": error_code})
