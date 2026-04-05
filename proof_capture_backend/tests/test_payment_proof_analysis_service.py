from decimal import Decimal
from unittest.mock import patch

from app.services.payment_proof_analysis_service import PaymentProofAnalysisService


def test_marks_analysis_unavailable_when_command_missing(settings):
  service = PaymentProofAnalysisService(settings.model_copy(update={"payment_proof_ocr_command": "missing-ocr"}))

  with patch("app.services.payment_proof_analysis_service.shutil.which", return_value=None):
    result = service.analyze_payment_proof(image_bytes=b"jpg", expected_amount=Decimal("5.25"))

  assert result.status == "unavailable"
  assert result.error_code == "ocr_command_not_found"
  assert result.detected_amount is None


def test_detects_matching_amount_from_ocr_text(settings):
  service = PaymentProofAnalysisService(settings)

  with patch("app.services.payment_proof_analysis_service.shutil.which", return_value="tesseract"):
    with patch.object(service, "_extract_text_with_tesseract", return_value="Transferencia exitosa valor 5,25 referencia 999"):
      result = service.analyze_payment_proof(image_bytes=b"jpg", expected_amount=Decimal("5.25"))

  assert result.status == "match"
  assert result.detected_amount == Decimal("5.25")
  assert result.amount_matches_expected is True


def test_detects_mismatched_amount_from_ocr_text(settings):
  service = PaymentProofAnalysisService(settings)

  with patch("app.services.payment_proof_analysis_service.shutil.which", return_value="tesseract"):
    with patch.object(service, "_extract_text_with_tesseract", return_value="Total pagado 8.00"):
      result = service.analyze_payment_proof(image_bytes=b"jpg", expected_amount=Decimal("5.25"))

  assert result.status == "mismatch"
  assert result.detected_amount == Decimal("8.00")
  assert result.amount_matches_expected is False
  assert result.error_code == "amount_mismatch"


def test_marks_for_manual_review_when_no_amount_detected(settings):
  service = PaymentProofAnalysisService(settings)

  with patch("app.services.payment_proof_analysis_service.shutil.which", return_value="tesseract"):
    with patch.object(service, "_extract_text_with_tesseract", return_value="Comprobante transferencia aprobado"):
      result = service.analyze_payment_proof(image_bytes=b"jpg", expected_amount=Decimal("5.25"))

  assert result.status == "needs_review"
  assert result.error_code == "amount_not_detected"
