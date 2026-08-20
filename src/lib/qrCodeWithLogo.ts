import QRCode from "qrcode";

const LOGO_SRC = "/logo.png";

let logoLoadPromise: Promise<HTMLImageElement> | null = null;

function loadLogoImage(): Promise<HTMLImageElement> {
  if (!logoLoadPromise) {
    logoLoadPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("No se pudo cargar el logo del pulpo"));
      img.src = LOGO_SRC;
    });
  }
  return logoLoadPromise;
}

type QrWithLogoOptions = {
  width?: number;
  margin?: number;
};

/** Genera un QR escaneable con el logo de El Pulpo centrado. */
export async function generateQrDataUrlWithLogo(
  text: string,
  options: QrWithLogoOptions = {},
): Promise<string> {
  const width = options.width ?? 280;
  const margin = options.margin ?? 1;

  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, text, {
    width,
    margin,
    errorCorrectionLevel: "H",
  });

  try {
    const logo = await loadLogoImage();
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas.toDataURL("image/png");

    const logoSize = Math.round(canvas.width * 0.22);
    const pad = Math.max(4, Math.round(logoSize * 0.14));
    const badgeRadius = logoSize / 2 + pad;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(centerX, centerY, badgeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      logo,
      centerX - logoSize / 2,
      centerY - logoSize / 2,
      logoSize,
      logoSize,
    );
    ctx.restore();
  } catch {
    // QR plano si el logo no carga (p. ej. entorno sin DOM).
  }

  return canvas.toDataURL("image/png");
}
