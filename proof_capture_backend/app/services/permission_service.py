from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.payment_proof import AccessLevel, CashShift, CashShiftUser, Module, PaymentCaptureRequest, Role, RolePermission, UserBranchRole, UserGlobalRole
from app.services.auth_service import AuthenticatedUser

ACCESS_ORDER = {
  AccessLevel.NONE: 0,
  AccessLevel.VIEW: 1,
  AccessLevel.OPERATE: 2,
  AccessLevel.MANAGE: 3,
}


class PermissionService:
  def has_branch_module_access(
    self,
    db: Session,
    *,
    user_id: UUID,
    branch_id: UUID,
    module_code: str,
    minimum_level: AccessLevel,
  ) -> bool:
    branch_stmt = (
      select(RolePermission.access_level)
      .join(Role, Role.id == RolePermission.role_id)
      .join(UserBranchRole, UserBranchRole.role_id == Role.id)
      .join(Module, Module.id == RolePermission.module_id)
      .where(UserBranchRole.user_id == user_id, UserBranchRole.branch_id == branch_id, UserBranchRole.is_active.is_(True), Module.code == module_code)
    )
    global_stmt = (
      select(RolePermission.access_level)
      .join(Role, Role.id == RolePermission.role_id)
      .join(UserGlobalRole, UserGlobalRole.role_id == Role.id)
      .join(Module, Module.id == RolePermission.module_id)
      .where(UserGlobalRole.user_id == user_id, UserGlobalRole.is_active.is_(True), Module.code == module_code)
    )
    levels = [row[0] for row in db.execute(branch_stmt.union_all(global_stmt)).all()]
    return any(ACCESS_ORDER[level] >= ACCESS_ORDER[minimum_level] for level in levels)

  def can_manage_cash_session(self, db: Session, *, user: AuthenticatedUser, cash_session: CashShift) -> bool:
    if cash_session.cashier_id == user.id:
      return True
    if self.has_branch_module_access(db, user_id=user.id, branch_id=cash_session.branch_id, module_code="admin_sucursal", minimum_level=AccessLevel.MANAGE):
      return True
    if self.has_branch_module_access(db, user_id=user.id, branch_id=cash_session.branch_id, module_code="admin_global", minimum_level=AccessLevel.MANAGE):
      return True
    shift_user = db.scalar(select(CashShiftUser).where(CashShiftUser.shift_id == cash_session.id, CashShiftUser.user_id == user.id, CashShiftUser.is_enabled.is_(True), CashShiftUser.is_supervisor.is_(True)))
    return shift_user is not None

  def can_validate_payment_proof(self, db: Session, *, user: AuthenticatedUser, branch_id: UUID, cash_session_id: UUID) -> bool:
    if self.has_branch_module_access(db, user_id=user.id, branch_id=branch_id, module_code="caja", minimum_level=AccessLevel.OPERATE):
      return True
    if self.has_branch_module_access(db, user_id=user.id, branch_id=branch_id, module_code="admin_sucursal", minimum_level=AccessLevel.MANAGE):
      return True
    if self.has_branch_module_access(db, user_id=user.id, branch_id=branch_id, module_code="admin_global", minimum_level=AccessLevel.MANAGE):
      return True
    shift_user = db.scalar(select(CashShiftUser).where(CashShiftUser.shift_id == cash_session_id, CashShiftUser.user_id == user.id, CashShiftUser.is_enabled.is_(True), or_(CashShiftUser.is_supervisor.is_(True), CashShiftUser.can_use_caja.is_(True))))
    return shift_user is not None

  def assert_capture_request_access(self, db: Session, *, user: AuthenticatedUser, capture_request: PaymentCaptureRequest) -> None:
    if capture_request.assigned_capture_user_id != user.id:
      raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"success": False, "message": "Esta solicitud no pertenece al usuario autenticado.", "data": None, "error_code": "forbidden_capture_request"},
      )

  def can_view_payment_proof(
    self,
    db: Session,
    *,
    user: AuthenticatedUser,
    branch_id: UUID,
    cash_session_id: UUID,
    capture_request: PaymentCaptureRequest | None = None,
  ) -> bool:
    if capture_request and capture_request.assigned_capture_user_id == user.id:
      return True
    return self.can_validate_payment_proof(db, user=user, branch_id=branch_id, cash_session_id=cash_session_id)
