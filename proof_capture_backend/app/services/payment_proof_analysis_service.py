from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.core.config import Settings


def _utcnow() -> datetime:
  return datetime.now(timezone.utc)


@dataclass(slots=True)
class ProofAnalysisResult:
  status: str
  summary: str
  error_code: str | None
  ocr_text: str | None
  detected_amount: Decimal | None
  amount_matches_expected: bool | None
  ran_at: datetime


class PaymentProofAnalysisService:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings

  def analyze_payment_proof(self, *, image_bytes: bytes, expected_amount: Decimal | float | int | str) -> ProofAnalysisResult:
    ran_at = _utcnow()
    command = (self.settings.payment_proof_ocr_command or "").strip()
    if not command:
      return ProofAnalysisResult(
        status="unavailable",
        summary="OCR desactivado. El comprobante queda pendiente de revision manual.",
        error_code="ocr_disabled",
        ocr_text=None,
        detected_amount=None,
        amount_matches_expected=None,
        ran_at=ran_at,
      )

    if not shutil.which(command):
      return ProofAnalysisResult(
        status="unavailable",
        summary="OCR no disponible en el servidor. El comprobante queda pendiente de revision manual.",
        error_code="ocr_command_not_found",
        ocr_text=None,
        detected_amount=None,
        amount_matches_expected=None,
        ran_at=ran_at,
      )

    ocr_text = self._extract_text_with_tesseract(command=command, image_bytes=image_bytes)
    normalized_text = self._normalize_text(ocr_text)
    if not normalized_text:
      return ProofAnalysisResult(
        status="needs_review",
        summary="No se pudo leer texto util del comprobante. Requiere revision manual.",
        error_code="ocr_no_text",
        ocr_text=ocr_text,
        detected_amount=None,
        amount_matches_expected=None,
        ran_at=ran_at,
      )

    expected_decimal = self._to_decimal(expected_amount)
    detected_amount = self._extract_best_amount(normalized_text, expected_decimal)
    if detected_amount is None:
      return ProofAnalysisResult(
        status="needs_review",
        summary="Se leyo texto del comprobante, pero no se detecto un monto claro. Requiere revision manual.",
        error_code="amount_not_detected",
        ocr_text=ocr_text,
        detected_amount=None,
        amount_matches_expected=None,
        ran_at=ran_at,
      )

    amount_matches_expected = detected_amount == expected_decimal
    if amount_matches_expected:
      summary = f"Monto detectado {detected_amount} y coincide con el pago esperado."
      status = "match"
      error_code = None
    else:
      summary = f"Monto detectado {detected_amount} y no coincide con el esperado {expected_decimal}."
      status = "mismatch"
      error_code = "amount_mismatch"

    return ProofAnalysisResult(
      status=status,
      summary=summary,
      error_code=error_code,
      ocr_text=ocr_text,
      detected_amount=detected_amount,
      amount_matches_expected=amount_matches_expected,
      ran_at=ran_at,
    )

  @staticmethod
  def _normalize_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()

  @staticmethod
  def _to_decimal(value: Decimal | float | int | str) -> Decimal:
    if isinstance(value, Decimal):
      return value.quantize(Decimal("0.01"))
    return Decimal(str(value)).quantize(Decimal("0.01"))

  def _extract_text_with_tesseract(self, *, command: str, image_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
      temp_file.write(image_bytes)
      temp_path = Path(temp_file.name)

    try:
      completed = subprocess.run(
        [command, str(temp_path), "stdout", "--psm", "6"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        timeout=20,
      )
    finally:
      temp_path.unlink(missing_ok=True)

    if completed.returncode != 0:
      stderr = (completed.stderr or "").strip()
      raise RuntimeError(stderr or "OCR execution failed")

    return completed.stdout or ""

  def _extract_best_amount(self, text: str, expected_amount: Decimal) -> Decimal | None:
    candidates: list[Decimal] = []
    for match in re.findall(r"\d[\d.,]*", text):
      candidate = self._parse_amount_candidate(match)
      if candidate is None:
        continue
      if candidate <= Decimal("0"):
        continue
      candidates.append(candidate)

    if not candidates:
      return None

    return min(
      candidates,
      key=lambda candidate: (
        abs(candidate - expected_amount),
        0 if candidate == expected_amount else 1,
        len(candidate.as_tuple().digits),
      ),
    )

  @staticmethod
  def _parse_amount_candidate(raw: str) -> Decimal | None:
    cleaned = raw.strip()
    if not cleaned:
      return None

    cleaned = re.sub(r"[^\d.,]", "", cleaned)
    if not cleaned:
      return None

    last_dot = cleaned.rfind(".")
    last_comma = cleaned.rfind(",")
    separator_index = max(last_dot, last_comma)

    normalized = cleaned
    if separator_index >= 0:
      integer_part = re.sub(r"[^\d]", "", cleaned[:separator_index])
      fractional_part = re.sub(r"[^\d]", "", cleaned[separator_index + 1 :])
      if not integer_part:
        integer_part = "0"
      if not fractional_part:
        normalized = integer_part
      else:
        normalized = f"{integer_part}.{fractional_part}"
    else:
      normalized = re.sub(r"[^\d]", "", cleaned)

    if not normalized:
      return None

    try:
      value = Decimal(normalized)
    except InvalidOperation:
      return None

    if value >= Decimal("1000") and "." not in normalized and len(normalized) >= 3:
      value = value / Decimal("100")

    return value.quantize(Decimal("0.01"))
