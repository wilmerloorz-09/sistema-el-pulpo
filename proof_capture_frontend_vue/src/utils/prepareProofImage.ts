const TARGET_MIME_TYPE = "image/jpeg";
const TARGET_MAX_DIMENSION = 1600;
const TARGET_QUALITY = 0.72;
const MAX_DIRECT_UPLOAD_BYTES = 900 * 1024;

function buildOutputName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") + ".jpg";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    image.onload = () => {
      cleanup();
      resolve(image);
    };

    image.onerror = () => {
      cleanup();
      reject(new Error("No se pudo procesar la imagen seleccionada."));
    };

    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo preparar la imagen para subir."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

export async function prepareProofImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const image = await loadImage(file);
  const maxDimension = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = maxDimension > TARGET_MAX_DIMENSION ? TARGET_MAX_DIMENSION / maxDimension : 1;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));

  const shouldTransform =
    file.type !== TARGET_MIME_TYPE || scale < 0.999 || file.size > MAX_DIRECT_UPLOAD_BYTES;

  if (!shouldTransform) return file;

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("No se pudo preparar la imagen para subir.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToBlob(canvas, TARGET_MIME_TYPE, TARGET_QUALITY);
  return new File([blob], buildOutputName(file.name), {
    type: TARGET_MIME_TYPE,
    lastModified: Date.now(),
  });
}
