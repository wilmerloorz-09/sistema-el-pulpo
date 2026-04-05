from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.payment_proof import AuditLog


@dataclass(slots=True)
class RequestAuditContext:
  ip_address: str | None = None
  user_agent: str | None = None


class AuditService:
  def log_event(
    self,
    db: Session,
    *,
    actor_user_id: UUID | None,
    action: str,
    entity: str,
    entity_id: str | None,
    before_data: dict | None = None,
    after_data: dict | None = None,
    context: RequestAuditContext | None = None,
  ) -> None:
    payload = after_data.copy() if after_data else {}
    if context:
      payload.setdefault("ip_address", context.ip_address)
      payload.setdefault("user_agent", context.user_agent)

    db.add(
      AuditLog(
        user_id=actor_user_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        before_data=before_data,
        after_data=payload or None,
      ),
    )
