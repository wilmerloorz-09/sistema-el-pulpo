from io import BytesIO

from fastapi import UploadFile
from PIL import Image
import pytest

from app.services.image_validation_service import ImageValidationService, InvalidImageError


def make_upload_file(fmt: str = "JPEG", size: tuple[int, int] = (80, 80), color: str = "red") -> UploadFile:
  buffer = BytesIO()
  Image.new("RGB", size, color).save(buffer, format=fmt)
  buffer.seek(0)
  return UploadFile(filename=f"proof.{fmt.lower()}", file=buffer)


@pytest.mark.asyncio
async def test_accepts_jpeg_png_and_webp(settings):
  service = ImageValidationService(settings)
  for image_format in ("JPEG", "PNG", "WEBP"):
    result = await service.validate_and_rewrite(make_upload_file(image_format))
    assert result.mime_type == "image/jpeg"
    assert result.file_size > 0
    assert len(result.sha256_hash) == 64


@pytest.mark.asyncio
async def test_rejects_non_image(settings):
  service = ImageValidationService(settings)
  upload = UploadFile(filename="malicious.pdf", file=BytesIO(b"not-an-image"))
  with pytest.raises(InvalidImageError) as exc:
    await service.validate_and_rewrite(upload)
  assert exc.value.error_code == "not_an_image"


@pytest.mark.asyncio
async def test_rejects_large_file(settings):
  small_limit_settings = settings.model_copy(update={"payment_proof_max_file_size_mb": 0})
  service = ImageValidationService(small_limit_settings)
  with pytest.raises(InvalidImageError) as exc:
    await service.validate_and_rewrite(make_upload_file("JPEG"))
  assert exc.value.error_code == "file_too_large"
