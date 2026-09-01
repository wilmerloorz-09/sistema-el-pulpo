import { Capacitor } from "@capacitor/core";

export type PrintHtmlResult = "printed" | "opened-window" | "failed";

/** Móvil, tablet o app nativa: el print() sobre iframe anidado suele no abrir diálogo. */
export const prefersDedicatedPrintWindow = (): boolean => {
  if (typeof window === "undefined") return false;
  if (Capacitor.isNativePlatform()) return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if (window.matchMedia("(max-width: 1024px)").matches) return true;
  return false;
};

function normalizeHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>";
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${trimmed}</body></html>`;
}

function printFromWindow(target: Window): boolean {
  try {
    target.focus();
    target.print();
    return true;
  } catch {
    return false;
  }
}

function printFromIframe(frame: HTMLIFrameElement): boolean {
  const win = frame.contentWindow;
  if (!win) return false;
  return printFromWindow(win);
}

/**
 * Debe llamarse de forma síncrona dentro del onClick (iOS pierde el gesto del usuario con await).
 */
export function printHtmlDocumentSync(html: string): PrintHtmlResult {
  const docHtml = normalizeHtml(html);

  const popup = window.open("", "_blank");
  if (popup) {
    try {
      popup.document.open();
      popup.document.write(docHtml);
      popup.document.close();
      if (printFromWindow(popup)) {
        return "opened-window";
      }
    } catch {
      try {
        popup.close();
      } catch {
        // ignore
      }
    }
  }

  const frame = document.createElement("iframe");
  frame.setAttribute("title", "Impresión");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483646;background:#fff;";
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc) {
    frame.remove();
    return "failed";
  }

  try {
    doc.open();
    doc.write(docHtml);
    doc.close();
    const ok = printFromIframe(frame);
    window.setTimeout(() => frame.remove(), 1000);
    return ok ? "printed" : "failed";
  } catch {
    frame.remove();
    return "failed";
  }
}
