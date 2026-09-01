import { Capacitor } from "@capacitor/core";

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

function getPrintRoot(): HTMLElement {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = PRINT_ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    root.style.display = "none";
    document.body.appendChild(root);
  }
  return root;
}

/**
 * Imprime reporte HTML desde el documento principal (sin window.open).
 * En iOS/Android abre la hoja Compartir / Imprimir del navegador.
 */
export function printCashReportInPlace(html: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const { styles, bodyHtml } = parseReportHtml(html);
  const root = getPrintRoot();
  root.innerHTML = `<style>${styles}</style><div class="cash-report-print-document">${bodyHtml}</div>`;

  const cleanup = () => {
    document.body.classList.remove(PRINT_BODY_CLASS);
    root.innerHTML = "";
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

/** @deprecated Usar printCashReportInPlace en móvil. */
export function printHtmlDocumentSync(html: string): "printed" | "failed" {
  return printCashReportInPlace(html) ? "printed" : "failed";
}
