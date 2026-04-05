from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

  database_url: str
  supabase_url: str
  supabase_service_role_key: str
  backend_cors_origins: list[str] = []
  supabase_storage_bucket_payment_proofs: str = "payment-proofs"
  payment_proof_max_file_size_mb: int = 5
  payment_capture_token_ttl_minutes: int = 20
  payment_proof_signed_url_ttl_seconds: int = 120
  payment_capture_max_attempts_per_window: int = 8
  payment_capture_attempt_window_minutes: int = 10


@lru_cache
def get_settings() -> Settings:
  return Settings()
