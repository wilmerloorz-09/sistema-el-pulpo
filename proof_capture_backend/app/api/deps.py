from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.services.audit_service import RequestAuditContext
from app.services.auth_service import AuthService, AuthenticatedUser


def get_request_audit_context(request: Request) -> RequestAuditContext:
  forwarded_for = request.headers.get("x-forwarded-for")
  client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (request.client.host if request.client else None)
  return RequestAuditContext(ip_address=client_ip, user_agent=request.headers.get("user-agent"))


async def get_current_user(
  authorization: Annotated[str | None, Header(alias="Authorization")] = None,
  settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
  if not authorization or not authorization.lower().startswith("bearer "):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail={"success": False, "message": "Falta el token de autenticacion.", "data": None, "error_code": "missing_bearer_token"},
    )
  token = authorization.split(" ", 1)[1].strip()
  return await AuthService(settings).get_current_user(token)
