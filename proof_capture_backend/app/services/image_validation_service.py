from __future__ import annotations

from dataclasses import dataclass
import hashlib
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings

ALLOWED_PIL_FORMATS = {
  "JPEG": "image/jpeg",
  "PNG": "image/png",
  "WEBP": "image/webp",
}


class InvalidImageError(ValueError):
  def __init__(self, message: str, error_code: str = "invalid_image") -> None:
    super().__init__(message)
    self.error_code = error_code


@dataclass(slots=True)
class ValidatedImage:
  file_bytes: bytes
  file_size: int
  mime_type: str
  image_width: int
  image_height: int
  sha256_hash: str
  original_file_name: str | None


class ImageValidationService:
  def __init__(self, settings: Settings) -> None:
    self.settings = settings

  async def validate_and_rewrite(self, upload_file: UploadFile) -> ValidatedImage:
    max_size_bytes = self.settings.payment_proof_max_file_size_mb * 1024 * 1024
    raw_bytes = await upload_file.read(max_size_bytes + 1)

    if not raw_bytes:
      raise InvalidImageError("No se recibio ninguna imagen.", "empty_file")

    if len(raw_bytes) > max_size_bytes:
      raise InvalidImageError("La imagen excede el tamano maximo permitido.", "file_too_large")

    try:
      with Image.open(BytesIO(raw_bytes)) as image:
        detected_format = image.format
      with Image.open(BytesIO(raw_bytes)) as image:
        image = ImageOps.exif_transpose(image)
        if detected_format not in ALLOWED_PIL_FORMATS:
          raise InvalidImageError("Formato de imagen no permitido.", "unsupported_media_type")

        if image.mode not in ("RGB", "L"):
          image = image.convert("RGB")
        elif image.mode == "L":
          image = image.convert("RGB")

        width, height = image.size
        output = BytesIO()
        image.save(output, format="JPEG", quality=88, optimize=True, progressive=True)
    except InvalidImageError:
      raise
    except UnidentifiedImageError as exc:
      raise InvalidImageError("El archivo no es una imagen valida.", "not_an_image") from exc
    except OSError as exc:
      raise InvalidImageError("La imagen esta corrupta o no puede procesarse.", "image_processing_error") from exc

    cleaned_bytes = output.getvalue()
    sha256_hash = hashlib.sha256(cleaned_bytes).hexdigest()

    return ValidatedImage(
      file_bytes=cleaned_bytes,
      file_size=len(cleaned_bytes),
      mime_type="image/jpeg",
      image_width=width,
      image_height=height,
      sha256_hash=sha256_hash,
      original_file_name=upload_file.filename,
    )
