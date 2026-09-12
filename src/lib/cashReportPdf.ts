import { Capacitor } from "@capacitor/core";

export type CashReportPdfResult =
  | { ok: true; filename: string; mode: "download" | "share" | "open" }
  | { ok: false; message: string };

function defaultFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `reporte-caja-${stamp}.pdf`;
}

function normalizeFullHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function renderHtmlToElement(html: string): Promise<{
  host: HTMLDivElement;
  cleanup: () => void;
}> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "width:794px",
    "background:#fff",
    "pointer-events:none",
    "opacity:0",
    "z-index:-1",
  ].join(";");

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:794px;border:0;background:#fff;";
  host.appendChild(iframe);
  document.body.appendChild(host);

  const doc = iframe.contentDocument;
  if (!doc) {
    host.remove();
    throw new Error("No se pudo preparar el documento para PDF");
  }

  doc.open();
  doc.write(normalizeFullHtml(html));
  doc.close();

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    if (iframe.contentWindow?.document.readyState === "complete") {
      window.setTimeout(done, 80);
      return;
    }
    iframe.addEventListener("load", () => window.setTimeout(done, 80), { once: true });
  });

  const body = doc.body;
  const height = Math.max(body.scrollHeight, body.offsetHeight, 400);
  iframe.style.height = `${height}px`;

  return {
    host,
    cleanup: () => {
      host.remove();
    },
  };
}

async function buildPdfFromHtml(html: string): Promise<{ blob: Blob; bytes: Uint8Array; filename: string }> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const { host, cleanup } = await renderHtmlToElement(html);
  try {
    const iframe = host.querySelector("iframe");
    const source = iframe?.contentDocument?.body;
    if (!source) throw new Error("No se pudo leer el reporte para PDF");

    const canvas = await html2canvas(source, {
      scale: 1.5,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 794,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imgWidth = usableWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const pageCanvasHeight = Math.floor((usableHeight * canvas.width) / imgWidth);

    let renderedY = 0;
    let pageIndex = 0;
    while (renderedY < canvas.height) {
      const sliceHeight = Math.min(pageCanvasHeight, canvas.height - renderedY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const ctx = pageCanvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo generar la página del PDF");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, renderedY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (pageIndex > 0) pdf.addPage();
      const sliceImgHeight = (sliceHeight * imgWidth) / canvas.width;
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgWidth, sliceImgHeight);

      renderedY += sliceHeight;
      pageIndex += 1;
    }

    const arrayBuffer = pdf.output("arraybuffer");
    const bytes = new Uint8Array(arrayBuffer);
    const filename = defaultFilename();
    return {
      blob: new Blob([bytes], { type: "application/pdf" }),
      bytes,
      filename,
    };
  } finally {
    cleanup();
  }
}

async function sharePdfNative(bytes: Uint8Array, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (!Capacitor.isPluginAvailable("Filesystem") || !Capacitor.isPluginAvailable("Share")) {
    return false;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  await Filesystem.writeFile({
    path: filename,
    data: uint8ToBase64(bytes),
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    directory: Directory.Cache,
    path: filename,
  });

  await Share.share({
    title: "Reporte de caja",
    text: "Reporte de cierre de caja",
    url: uri,
    dialogTitle: "Guardar PDF",
  });
  return true;
}

function isShareAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return /abort/i.test(name) || /cancel/i.test(message);
}

/** Menú del sistema (Guardar / Drive / Archivos). Más fiable que <a download> en móvil. */
async function sharePdfWeb(blob: Blob, filename: string): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;

  const file = new File([blob], filename, { type: "application/pdf" });
  if (typeof navigator.canShare === "function") {
    try {
      if (!navigator.canShare({ files: [file] })) return false;
    } catch {
      return false;
    }
  } else {
    return false;
  }

  try {
    await navigator.share({
      files: [file],
      title: "Reporte de caja",
      text: "Reporte de cierre de caja",
    });
    return true;
  } catch (error: unknown) {
    if (isShareAbort(error)) return true;
    console.error("[cash-report-pdf-web-share]", error);
    return false;
  }
}

/** Abre el PDF en otra pestaña para que el usuario use Guardar / Compartir del visor. */
function openPdfInTab(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function downloadPdfWeb(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1_000);
}

/** En móvil/tablet: genera PDF y lo guarda (Compartir → abrir → descarga). */
export async function saveCashReportPdf(html: string): Promise<CashReportPdfResult> {
  try {
    const { blob, bytes, filename } = await buildPdfFromHtml(html);

    if (Capacitor.isNativePlatform()) {
      try {
        if (await sharePdfNative(bytes, filename)) {
          return { ok: true, filename, mode: "share" };
        }
      } catch (error: unknown) {
        if (isShareAbort(error)) {
          return { ok: true, filename, mode: "share" };
        }
        console.error("[cash-report-pdf-share]", error);
      }
    }

    if (await sharePdfWeb(blob, filename)) {
      return { ok: true, filename, mode: "share" };
    }

    if (openPdfInTab(blob)) {
      return { ok: true, filename, mode: "open" };
    }

    downloadPdfWeb(blob, filename);
    return { ok: true, filename, mode: "download" };
  } catch (error: unknown) {
    console.error("[cash-report-pdf]", error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo generar el PDF",
    };
  }
}
