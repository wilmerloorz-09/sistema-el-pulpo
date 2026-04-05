from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import httpx
from fastapi import HTTPException, status

from app.core.config import Settings


@dataclass(slots=True)
class AuthenticatedUser:
  id: UUID
  email: str | None
  full_name: str | None
  username: str | None
  access_token: str


class AuthService:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings

  async def get_current_user(self, access_token: str) -> AuthenticatedUser:
    url = f"{self.settings.supabase_url}/auth/v1/user"
    headers = {
      "Authorization": f"Bearer {access_token}",
      "apikey": self.settings.supabase_service_role_key,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
      response = await client.get(url, headers=headers)

    if response.status_code != 200:
      raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"success": False, "message": "Tu sesion no es valida o ya expiro.", "error_code": "invalid_session", "data": None},
      )

    payload = response.json()
    metadata = payload.get("user_metadata") or {}
    return AuthenticatedUser(
      id=UUID(payload["id"]),
      email=payload.get("email"),
      full_name=metadata.get("full_name"),
      username=metadata.get("username"),
      access_token=access_token,
    )
