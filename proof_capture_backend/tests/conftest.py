from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.services.audit_service import AuditService, RequestAuditContext
from app.services.auth_service import AuthenticatedUser
from app.services.image_validation_service import ImageValidationService
from app.services.payment_capture_service import PaymentCaptureService
from app.services.payment_proof_service import PaymentProofService
from app.services.permission_service import PermissionService
from app.services.storage_service import StorageService


@pytest.fixture
def settings() -> Settings:
  return Settings(
    database_url="postgresql+psycopg://user:pass@localhost/test",
    supabase_url="https://example.supabase.co",
    supabase_service_role_key="service-role",
    supabase_storage_bucket_payment_proofs="payment-proofs",
    payment_proof_max_file_size_mb=5,
    payment_capture_token_ttl_minutes=15,
    payment_proof_signed_url_ttl_seconds=120,
  )


@pytest.fixture
def actor() -> AuthenticatedUser:
  return AuthenticatedUser(
    id=uuid4(),
    email="cajero@example.com",
    full_name="Cajero Principal",
    username="cajero1",
    access_token="token",
  )


@pytest.fixture
def audit_context() -> RequestAuditContext:
  return RequestAuditContext(ip_address="127.0.0.1", user_agent="pytest")
