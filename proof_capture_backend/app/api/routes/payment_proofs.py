from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_request_audit_context
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.common import ApiResponse
from app.schemas.payment_proof import AssignCaptureUserRequest, CaptureRequestSummary, PaymentProofSummary, PaymentProofWithRequest, RejectProofRequest
from app.services.audit_service import AuditService, RequestAuditContext
from app.services.auth_service import AuthenticatedUser
from app.services.image_validation_service import ImageValidationService
from app.services.payment_capture_service import PaymentCaptureService
from app.services.payment_proof_analysis_service import PaymentProofAnalysisService
from app.services.payment_proof_service import PaymentProofService
from app.services.permission_service import PermissionService
from app.services.storage_service import StorageService

router = APIRouter()


def get_capture_service(settings: Settings = Depends(get_settings)) -> PaymentCaptureService:
  return PaymentCaptureService(settings=settings, audit_service=AuditService(), permission_service=PermissionService())


def get_proof_service(
  settings: Settings = Depends(get_settings),
  capture_service: PaymentCaptureService = Depends(get_capture_service),
) -> PaymentProofService:
  return PaymentProofService(
    settings=settings,
    storage_service=StorageService(settings),
    image_validation_service=ImageValidationService(settings),
    payment_proof_analysis_service=PaymentProofAnalysisService(settings),
    audit_service=AuditService(),
    permission_service=PermissionService(),
    capture_service=capture_service,
  )


@router.post("/cash-sessions/{cash_session_id}/capture-user", response_model=ApiResponse[dict])
def assign_capture_user(
  cash_session_id: UUID,
  payload: AssignCaptureUserRequest,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  context: RequestAuditContext = Depends(get_request_audit_context),
  service: PaymentCaptureService = Depends(get_capture_service),
):
  cash_shift = service.assign_capture_user(db, cash_session_id=cash_session_id, capture_user_id=payload.capture_user_id, capture_device_label=payload.capture_device_label, actor=actor, context=context)
  return ApiResponse(message="Usuario capturador actualizado correctamente.", data={"cash_session_id": str(cash_shift.id), "capture_user_id": str(cash_shift.capture_user_id) if cash_shift.capture_user_id else None, "capture_device_label": cash_shift.capture_device_label})


@router.post("/payments/{payment_id}/capture-request", response_model=ApiResponse[CaptureRequestSummary])
def create_capture_request(
  payment_id: UUID,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  context: RequestAuditContext = Depends(get_request_audit_context),
  service: PaymentCaptureService = Depends(get_capture_service),
):
  capture_request = service.create_capture_request(db, payment_id=payment_id, actor=actor, context=context)
  return ApiResponse(message="Solicitud de captura creada.", data=CaptureRequestSummary.model_validate(capture_request))


@router.get("/capture-requests/{token}")
def get_capture_request(
  token: str,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  service: PaymentCaptureService = Depends(get_capture_service),
):
  data = service.get_capture_request_for_mobile(db, token=token, actor=actor)
  return ApiResponse(message="Solicitud obtenida correctamente.", data=data)


@router.post("/capture-requests/{token}/open", response_model=ApiResponse[CaptureRequestSummary])
def open_capture_request(
  token: str,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  context: RequestAuditContext = Depends(get_request_audit_context),
  service: PaymentCaptureService = Depends(get_capture_service),
):
  capture_request = service.open_capture_request(db, token=token, actor=actor, context=context)
  return ApiResponse(message="Solicitud abierta correctamente.", data=CaptureRequestSummary.model_validate(capture_request))


@router.post("/capture-requests/{token}/upload", response_model=ApiResponse[PaymentProofWithRequest])
async def upload_capture_request(
  token: str,
  file: UploadFile = File(...),
  db: Session = Depends(get_db),
  context: RequestAuditContext = Depends(get_request_audit_context),
  service: PaymentProofService = Depends(get_proof_service),
):
  capture_request, proof = await service.upload_capture_proof(db, token=token, upload_file=file, actor=None, context=context)
  return ApiResponse(message="Comprobante cargado correctamente.", data=PaymentProofWithRequest(proof=PaymentProofSummary.model_validate(proof), capture_request=CaptureRequestSummary.model_validate(capture_request)))


@router.post("/payments/{payment_id}/proof/approve", response_model=ApiResponse[PaymentProofSummary])
def approve_payment_proof(
  payment_id: UUID,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  context: RequestAuditContext = Depends(get_request_audit_context),
  service: PaymentProofService = Depends(get_proof_service),
):
  proof = service.approve_proof(db, payment_id=payment_id, actor=actor, context=context)
  return ApiResponse(message="Comprobante aprobado correctamente.", data=PaymentProofSummary.model_validate(proof))


@router.post("/payments/{payment_id}/proof/reject", response_model=ApiResponse[PaymentProofWithRequest])
def reject_payment_proof(
  payment_id: UUID,
  payload: RejectProofRequest,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  context: RequestAuditContext = Depends(get_request_audit_context),
  service: PaymentProofService = Depends(get_proof_service),
):
  proof, replacement = service.reject_proof(db, payment_id=payment_id, reason=payload.reason, actor=actor, context=context)
  return ApiResponse(message="Comprobante rechazado y recaptura preparada.", data=PaymentProofWithRequest(proof=PaymentProofSummary.model_validate(proof), capture_request=CaptureRequestSummary.model_validate(replacement) if replacement else None))


@router.get("/payments/{payment_id}/proof", response_model=ApiResponse[PaymentProofWithRequest])
def get_payment_proof(
  payment_id: UUID,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  service: PaymentProofService = Depends(get_proof_service),
):
  proof, capture_request = service.get_payment_proof(db, payment_id=payment_id, actor=actor)
  return ApiResponse(message="Estado del comprobante obtenido correctamente.", data=PaymentProofWithRequest(proof=PaymentProofSummary.model_validate(proof) if proof else None, capture_request=CaptureRequestSummary.model_validate(capture_request) if capture_request else None))


@router.get("/payments/{payment_id}/proof/view-url")
def get_payment_proof_view_url(
  payment_id: UUID,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  service: PaymentProofService = Depends(get_proof_service),
):
  signed = service.get_signed_view_url(db, payment_id=payment_id, actor=actor)
  return ApiResponse(message="URL temporal generada correctamente.", data=signed)


@router.get("/cash-sessions/{cash_session_id}/capture-requests/pending")
def list_pending_capture_requests(
  cash_session_id: UUID,
  db: Session = Depends(get_db),
  actor: AuthenticatedUser = Depends(get_current_user),
  service: PaymentCaptureService = Depends(get_capture_service),
):
  items = service.list_pending_requests(db, cash_session_id=cash_session_id, actor=actor)
  return ApiResponse(message="Solicitudes pendientes obtenidas correctamente.", data=items)
