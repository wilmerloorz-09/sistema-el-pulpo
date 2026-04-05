import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

  database_url: str | None = None
  supabase_url: str
  supabase_service_role_key: str
  supabase_pooler_url: str | None = None
  supabase_db_password: str | None = None
  backend_cors_origins: list[str] = []
  backend_cors_origin_regex: str | None = r"https?://.*"
  supabase_storage_bucket_payment_proofs: str = "payment-proofs"
  payment_proof_max_file_size_mb: int = 5
  payment_capture_token_ttl_minutes: int = 20
  payment_proof_signed_url_ttl_seconds: int = 120
  payment_capture_max_attempts_per_window: int = 8
  payment_capture_attempt_window_minutes: int = 10
  payment_proof_ocr_command: str | None = "tesseract"

  @field_validator("backend_cors_origins", mode="before")
  @classmethod
  def parse_backend_cors_origins(cls, value: object) -> object:
    if value is None or value == "":
      return []
    if isinstance(value, list):
      return value
    if isinstance(value, str):
      raw = value.strip()
      if not raw:
        return []
      if raw.startswith("["):
        try:
          parsed = json.loads(raw)
          if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        except json.JSONDecodeError:
          pass
      return [item.strip() for item in raw.split(",") if item.strip()]
    return value

  @model_validator(mode="after")
  def resolve_database_url(self) -> "Settings":
    direct_url = self.database_url
    pooler_url = self.supabase_pooler_url or _read_local_pooler_url()

    if pooler_url and direct_url and _is_direct_supabase_host(direct_url):
      self.database_url = _merge_database_urls(pooler_url, direct_url, self.supabase_db_password)
      return self

    if pooler_url and not direct_url:
      merged_url = _merge_database_urls(pooler_url, None, self.supabase_db_password)
      if merged_url:
        self.database_url = merged_url
        return self

    if not self.database_url:
      raise ValueError("database_url is required")

    return self


def _read_local_pooler_url() -> str | None:
  pooler_files = (
    Path("supabase/.temp/pooler-url"),
    Path("../supabase/.temp/pooler-url"),
  )

  for pooler_file in pooler_files:
    try:
      if pooler_file.exists():
        value = pooler_file.read_text(encoding="utf-8").strip()
        if value:
          return value
    except OSError:
      continue

  return None


def _is_direct_supabase_host(database_url: str) -> bool:
  host = urlsplit(database_url).hostname or ""
  return host.startswith("db.") and host.endswith(".supabase.co")


def _merge_database_urls(pooler_url: str, direct_url: str | None, password: str | None) -> str | None:
  parsed_pooler = urlsplit(pooler_url)
  if not parsed_pooler.hostname:
    return None

  scheme = parsed_pooler.scheme or "postgresql"
  username = parsed_pooler.username or ""
  resolved_password = password

  if direct_url:
    parsed_direct = urlsplit(direct_url)
    if parsed_direct.scheme:
      scheme = parsed_direct.scheme
    if parsed_direct.username:
      username = parsed_direct.username
    if parsed_direct.password:
      resolved_password = parsed_direct.password

  if not username or not resolved_password:
    return None

  auth = f"{username}:{resolved_password}"
  if parsed_pooler.port:
    auth = f"{auth}@{parsed_pooler.hostname}:{parsed_pooler.port}"
  else:
    auth = f"{auth}@{parsed_pooler.hostname}"

  path = parsed_pooler.path or "/postgres"
  return urlunsplit((scheme, auth, path, parsed_pooler.query, parsed_pooler.fragment))


@lru_cache
def get_settings() -> Settings:
  return Settings()
