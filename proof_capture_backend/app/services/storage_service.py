from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import Settings


class StorageServiceError(RuntimeError):
  pass


@dataclass(slots=True)
class SignedUrlResult:
  url: str
  expires_in_seconds: int


class StorageService:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings
    self.bucket_name = settings.supabase_storage_bucket_payment_proofs

  @property
  def _headers(self) -> dict[str, str]:
    return {
      "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
      "apikey": self.settings.supabase_service_role_key,
    }

  def upload_bytes(self, *, object_path: str, payload: bytes, content_type: str) -> None:
    url = f"{self.settings.supabase_url}/storage/v1/object/{self.bucket_name}/{object_path}"
    headers = {**self._headers, "Content-Type": content_type, "x-upsert": "false"}
    with httpx.Client(timeout=30.0) as client:
      response = client.post(url, headers=headers, content=payload)
      if response.status_code >= 400:
        raise StorageServiceError("No fue posible almacenar el comprobante.")

  def delete_object(self, object_path: str) -> None:
    url = f"{self.settings.supabase_url}/storage/v1/object/{self.bucket_name}/{object_path}"
    with httpx.Client(timeout=20.0) as client:
      response = client.delete(url, headers=self._headers)
      if response.status_code >= 400:
        raise StorageServiceError("No fue posible limpiar el comprobante subido.")

  def create_signed_url(self, object_path: str) -> SignedUrlResult:
    expires = self.settings.payment_proof_signed_url_ttl_seconds
    url = f"{self.settings.supabase_url}/storage/v1/object/sign/{self.bucket_name}/{object_path}"
    with httpx.Client(timeout=15.0) as client:
      response = client.post(url, headers=self._headers, json={"expiresIn": expires})
      if response.status_code >= 400:
        raise StorageServiceError("No fue posible generar la URL temporal del comprobante.")

    data = response.json()
    signed_path = data.get("signedURL")
    if not signed_path:
      raise StorageServiceError("Respuesta invalida al solicitar la URL temporal.")

    return SignedUrlResult(
      url=f"{self.settings.supabase_url}/storage/v1{signed_path}",
      expires_in_seconds=expires,
    )
