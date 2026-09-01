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

/** Móvil: no usar overlay in-app; abrir pestaña o compartir. */
export function printCashReportMobile(
  html: string,
  iframe: HTMLIFrameElement | null,
): CashReportPrintResult {
  if (openCashReportInNewTab(html)) {
    return "opened-tab";
  }

  if (printFromIframe(iframe)) {
    return "print-dialog";
  }

  return "failed";
}

export function printCashReportDesktop(iframe: HTMLIFrameElement | null, html: string): CashReportPrintResult {
  if (printFromIframe(iframe)) {
    return "print-dialog";
  }
  return printCashReportInPlace(html) ? "print-dialog" : "failed";
}
