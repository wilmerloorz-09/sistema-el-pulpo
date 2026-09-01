import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";

export type CashReportPrintResult = "print-dialog" | "opened-tab" | "shared" | "failed";
export type CashReportPdfResult = "opened" | "shared" | "downloaded" | "failed";

/** Móvil, tablet o app nativa. */
export const prefersDedicatedPrintWindow = (): boolean => {
  if (typeof window === "undefined") return false;
  if (Capacitor.isNativePlatform()) return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if (window.matchMedia("(max-width: 1024px)").matches) return true;
  return false;
};

const PRINT_ROOT_ID = "print-cash-report";
const PRINT_BODY_CLASS = "printing-cash-report";

/** Fuera de pantalla: no tapa botones Cerrar/Imprimir. Solo visible al imprimir (@media print). */
const PRINT_ROOT_OFFSCREEN_STYLE = [
  "position:fixed",
  "left:-9999px",
  "top:0",
  "width:1px",
  "height:1px",
  "overflow:hidden",
  "opacity:0",
  "pointer-events:none",
].join(";");

export function parseReportHtml(html: string): { styles: string; bodyHtml: string } {
  if (typeof DOMParser === "undefined") {
    return { styles: "", bodyHtml: html };
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const styles = Array.from(doc.querySelectorAll("style"))
    .map((node) => node.textContent ?? "")
    .join("\n");
  const bodyHtml = doc.body?.innerHTML?.trim() || html;
  return { styles, bodyHtml };
}

function normalizeFullHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
}

/** HTML con barra para volver (pestaña / visor aparte). */
function htmlWithMobileToolbar(html: string): string {
  const docHtml = normalizeFullHtml(html);
  const toolbar = `
<style>@media print{#el-pulpo-report-toolbar{display:none!important;}}</style>
<div id="el-pulpo-report-toolbar" style="position:sticky;top:0;z-index:9999;display:flex;gap:8px;justify-content:flex-end;padding:12px;background:#fff;border-bottom:1px solid #e5e7eb;">
  <button type="button" onclick="window.print()" style="appearance:none;border:0;border-radius:999px;background:#ea580c;color:#fff;font-weight:700;padding:10px 16px;min-height:44px;">Imprimir</button>
  <button type="button" onclick="window.close(); if(!window.closed && window.history.length>1) window.history.back();" style="appearance:none;border:1px solid #fecaca;border-radius:999px;background:#fff;color:#b91c1c;font-weight:700;padding:10px 16px;min-height:44px;">Cerrar</button>
</div>`;

  if (/<body[^>]*>/i.test(docHtml)) {
    return docHtml.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`);
  }
  return `${toolbar}${docHtml}`;
}

function getPrintRoot(): HTMLElement {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = PRINT_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

function resetPrintRoot(root: HTMLElement): void {
  root.innerHTML = "";
  root.style.cssText = "display:none;";
  root.setAttribute("aria-hidden", "true");
}

/**
 * Impresión en el mismo documento (escritorio). No bloquea la UI.
 */
export function printCashReportInPlace(html: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const { styles, bodyHtml } = parseReportHtml(html);
  const root = getPrintRoot();
  root.innerHTML = `<style>${styles}</style><div class="cash-report-print-document">${bodyHtml}</div>`;
  root.removeAttribute("aria-hidden");
  root.style.cssText = PRINT_ROOT_OFFSCREEN_STYLE;

  const cleanup = () => {
    document.body.classList.remove(PRINT_BODY_CLASS);
    resetPrintRoot(root);
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 1500);

  document.body.classList.add(PRINT_BODY_CLASS);

  try {
    window.focus();
    window.print();
    return true;
  } catch {
    cleanup();
    return false;
  }
}

/** Nueva pestaña con el reporte (no reemplaza la app). */
export function openCashReportInNewTab(html: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  try {
    const docHtml = htmlWithMobileToolbar(html);
    const blob = new Blob([docHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const popup = window.open(url, "_blank", "noopener,noreferrer");

    if (!popup) {
      URL.revokeObjectURL(url);
      return false;
    }

    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return true;
  } catch {
    return false;
  }
}

export async function shareCashReportHtml(
  html: string,
  title = "Reporte de caja",
): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }

  try {
    const docHtml = htmlWithMobileToolbar(html);
    const file = new File([docHtml], "reporte-caja.html", { type: "text/html;charset=utf-8" });
    const payload = { files: [file], title, text: title };

    if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) {
      return false;
    }

    await navigator.share(payload);
    return true;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    return false;
  }
}

function printFromIframe(frame: HTMLIFrameElement | null): boolean {
  const win = frame?.contentWindow;
  if (!win) return false;
  try {
    win.focus();
    win.print();
    return true;
  } catch {
    return false;
  }
}

function defaultCashReportFilename(ext: "pdf" | "html" = "pdf"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `reporte-caja-${stamp}.${ext}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("No se pudo leer el PDF."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el PDF."));
    reader.readAsDataURL(blob);
  });
}

function resolvePdfSourceElement(
  html: string,
  iframe?: HTMLIFrameElement | null,
): { element: HTMLElement; cleanup: () => void; html2canvasWindow?: Window } {
  const iframeBody = iframe?.contentDocument?.body;
  if (iframeBody) {
    return {
      element: iframeBody,
      cleanup: () => {},
      html2canvasWindow: iframe.contentWindow ?? undefined,
    };
  }

  const { styles, bodyHtml } = parseReportHtml(html);
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:794px",
    "max-width:100vw",
    "background:#fff",
    "z-index:-1",
    "opacity:0.01",
    "pointer-events:none",
    "overflow:hidden",
  ].join(";");
  wrapper.innerHTML = `<style>${styles}</style><div class="cash-report-print-document">${bodyHtml}</div>`;
  document.body.appendChild(wrapper);

  const element = wrapper.querySelector(".cash-report-print-document") as HTMLElement | null;
  if (!element) {
    wrapper.remove();
    throw new Error("No se pudo preparar el reporte para PDF.");
  }

  return {
    element,
    cleanup: () => wrapper.remove(),
  };
}

/** Genera PDF del reporte usando el iframe ya renderizado cuando exista. */
export async function generateCashReportPdfBlob(
  html: string,
  iframe?: HTMLIFrameElement | null,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  let source: ReturnType<typeof resolvePdfSourceElement> | null = null;

  try {
    source = resolvePdfSourceElement(html, iframe);
    const html2pdf = (await import("html2pdf.js")).default;
    const html2canvasOptions: Record<string, unknown> = {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    };

    if (source.html2canvasWindow) {
      html2canvasOptions.windowWidth = source.html2canvasWindow.document.documentElement.scrollWidth;
      html2canvasOptions.windowHeight = source.html2canvasWindow.document.documentElement.scrollHeight;
    }

    const blob = await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: html2canvasOptions,
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(source.element)
      .outputPdf("blob");

    return blob instanceof Blob ? blob : null;
  } catch (error: unknown) {
    console.error("[cash-report-pdf]", error);
    return null;
  } finally {
    source?.cleanup();
  }
}

async function sharePdfWithCapacitor(blob: Blob, filename: string, title: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);

    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({
      directory: Directory.Cache,
      path: filename,
    });

    await Share.share({
      title,
      text: title,
      url: uri,
      dialogTitle: "Compartir reporte",
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && /cancel/i.test(error.message)) {
      return true;
    }
    console.error("[cash-report-share-native]", error);
    return false;
  }
}

async function openPdfWithCapacitorBrowser(blob: Blob, filename: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    const [{ Filesystem, Directory }, { Browser }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/browser"),
    ]);

    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({
      directory: Directory.Cache,
      path: filename,
    });

    await Browser.open({ url: uri, presentationStyle: "fullscreen" });
    return true;
  } catch (error: unknown) {
    console.error("[cash-report-open-native]", error);
    return false;
  }
}

/** Comparte un PDF ya generado. */
export async function shareCashReportPdfBlob(
  blob: Blob,
  title = "Reporte de caja",
  filename = defaultCashReportFilename("pdf"),
): Promise<CashReportPdfResult> {
  if (await sharePdfWithCapacitor(blob, filename, title)) {
    toast.message("Listo para compartir", {
      description: "Elija WhatsApp, Drive u otra app.",
    });
    return "shared";
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      const payload = { files: [file], title, text: title };
      if (typeof navigator.canShare !== "function" || navigator.canShare(payload)) {
        await navigator.share(payload);
        return "shared";
      }
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "shared";
      }
    }
  }

  toast.error("Compartir no disponible", {
    description: "Use el botón Compartir del visor o abra el PDF en otra app.",
  });
  return "failed";
}

/** Genera y abre el PDF. En móvil devuelve el blob para visor inline. */
export async function openCashReportPdf(
  html: string,
  iframe?: HTMLIFrameElement | null,
): Promise<{ result: CashReportPdfResult; blob: Blob | null }> {
  const blob = await generateCashReportPdfBlob(html, iframe);
  if (!blob) {
    if (openCashReportInNewTab(html)) {
      toast.message("Reporte abierto", {
        description: "No se pudo crear PDF; se abrió el reporte en pantalla.",
      });
      return { result: "opened", blob: null };
    }
    return { result: "failed", blob: null };
  }

  const filename = defaultCashReportFilename("pdf");

  if (await openPdfWithCapacitorBrowser(blob, filename)) {
    return { result: "opened", blob };
  }

  if (!prefersDedicatedPrintWindow()) {
    const url = URL.createObjectURL(blob);
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (popup) {
      window.setTimeout(() => URL.revokeObjectURL(url), 300_000);
      return { result: "opened", blob };
    }
    URL.revokeObjectURL(url);
  }

  return { result: "opened", blob };
}

export function printCashReportDesktop(iframe: HTMLIFrameElement | null, html: string): CashReportPrintResult {
  if (printFromIframe(iframe)) {
    return "print-dialog";
  }
  return printCashReportInPlace(html) ? "print-dialog" : "failed";
}
