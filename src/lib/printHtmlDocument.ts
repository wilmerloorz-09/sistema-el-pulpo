import { Capacitor } from "@capacitor/core";

export type CashReportPrintResult = "print-dialog" | "opened-tab" | "shared" | "failed";

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

function getPrintRoot(): HTMLElement {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = PRINT_ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

function preparePrintRoot(root: HTMLElement, html: string): void {
  const { styles, bodyHtml } = parseReportHtml(html);
  root.innerHTML = `<style>${styles}</style><div class="cash-report-print-document">${bodyHtml}</div>`;
  root.removeAttribute("aria-hidden");
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "background:#fff",
    "overflow:auto",
    "-webkit-overflow-scrolling:touch",
  ].join(";");
}

function resetPrintRoot(root: HTMLElement): void {
  root.innerHTML = "";
  root.style.cssText = "display:none;";
  root.setAttribute("aria-hidden", "true");
}

/**
 * window.print() en el documento principal (Safari/Chrome móvil → diálogo o Compartir > Imprimir).
 */
export function printCashReportInPlace(html: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const root = getPrintRoot();
  preparePrintRoot(root, html);

  const cleanup = () => {
    document.body.classList.remove(PRINT_BODY_CLASS);
    resetPrintRoot(root);
  };

  window.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 120_000);

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

/** Abre el reporte en pestaña nueva (blob). Desde ahí: menú → Imprimir. */
export function openCashReportInNewTab(html: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  try {
    const docHtml = normalizeFullHtml(html);
    const blob = new Blob([docHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return true;
  } catch {
    return false;
  }
}

/** Compartir archivo HTML (iOS: hoja Compartir → Imprimir o Guardar en Archivos). */
export async function shareCashReportHtml(
  html: string,
  title = "Reporte de caja",
): Promise<boolean> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") {
    return false;
  }

  try {
    const docHtml = normalizeFullHtml(html);
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

/**
 * Flujo móvil/tablet: iframe visible → print in-app → pestaña blob.
 * App nativa Capacitor: pestaña blob (window.print no existe en WebView).
 */
export function printCashReportMobile(
  html: string,
  iframe: HTMLIFrameElement | null,
): CashReportPrintResult {
  if (Capacitor.isNativePlatform()) {
    return openCashReportInNewTab(html) ? "opened-tab" : "failed";
  }

  if (printCashReportInPlace(html)) {
    return "print-dialog";
  }

  if (printFromIframe(iframe)) {
    return "print-dialog";
  }

  return openCashReportInNewTab(html) ? "opened-tab" : "failed";
}

export function printCashReportDesktop(iframe: HTMLIFrameElement | null, html: string): CashReportPrintResult {
  if (printFromIframe(iframe)) {
    return "print-dialog";
  }
  return printCashReportInPlace(html) ? "print-dialog" : "failed";
}
