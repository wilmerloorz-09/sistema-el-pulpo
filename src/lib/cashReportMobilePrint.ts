import { Capacitor } from "@capacitor/core";
import type { CashClosureReportParams } from "@/lib/cashReportUtils";
import { formatDateTime, formatMoney } from "@/lib/cashReportUtils";
import {
  buildCashReportPrintPageUrl,
  openCashReportInAppPrintPage,
  textToBase64,
} from "@/lib/cashReportPrintSession";
import { openHtmlInEpsonIPrint } from "@/lib/pulpoNativePrint";

export type MobilePrintStage = {
  ready: boolean;
  shareUri: string | null;
  error: string | null;
  native: boolean;
  sharePlugin: boolean;
  filesystemPlugin: boolean;
  browserPlugin: boolean;
  platform: string;
  needsApkUpdate: boolean;
};

function normalizeReportHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
}

export function buildCashReportTextSummary(params: CashClosureReportParams): string {
  const title = params.reportMode === "opening" ? "Reporte apertura caja" : "Reporte cierre caja";
  const opening = params.shift.openingHistory[0];
  const lines = [
    title,
    params.branchName,
    `Generado: ${formatDateTime(new Date().toISOString())}`,
    opening ? `Apertura: ${formatDateTime(opening.opened_at)}` : "",
    opening?.closed_at ? `Cierre: ${formatDateTime(opening.closed_at)}` : "",
    "",
    "Cobro por metodo:",
    ...params.methodSummary.map(
      (row) => `- ${row.methodName}: ${formatMoney(row.amount)} (${row.paymentCount} cobros)`,
    ),
    "",
    `Pagos registrados: ${params.completedPayments.length}`,
    params.closureNotes ? `Notas: ${params.closureNotes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function getMobilePrintStage(): Omit<MobilePrintStage, "ready" | "shareUri" | "error" | "needsApkUpdate"> {
  return {
    native: Capacitor.isNativePlatform(),
    sharePlugin: Capacitor.isPluginAvailable("Share"),
    filesystemPlugin: Capacitor.isPluginAvailable("Filesystem"),
    browserPlugin: Capacitor.isPluginAvailable("Browser"),
    platform: Capacitor.getPlatform(),
  };
}

/** Prepara el archivo mientras el usuario ve el reporte. */
export async function stageCashReportForShare(html: string): Promise<MobilePrintStage> {
  const base = getMobilePrintStage();
  const needsApkUpdate = base.native && !base.sharePlugin;

  if (needsApkUpdate) {
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: null,
      needsApkUpdate: true,
    };
  }

  if (!base.native) {
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: null,
      needsApkUpdate: false,
    };
  }

  if (!base.filesystemPlugin) {
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: "Falta el plugin de archivos en la app. Reinstale la app de la tablet.",
      needsApkUpdate: true,
    };
  }

  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    const filename = `reporte-caja-${Date.now()}.html`;

    await Filesystem.writeFile({
      path: filename,
      data: textToBase64(normalizeReportHtml(html)),
      directory: Directory.Cache,
      recursive: true,
    });

    const { uri } = await Filesystem.getUri({
      directory: Directory.Cache,
      path: filename,
    });

    return {
      ...base,
      ready: true,
      shareUri: uri,
      error: null,
      needsApkUpdate: false,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "No se pudo preparar el reporte";
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: message,
      needsApkUpdate: false,
    };
  }
}

/** Abre el HTML en Epson iPrint; si no esta instalada, muestra apps compatibles. */
export async function openCashReportShareMenu(stage: MobilePrintStage): Promise<{ ok: true; usedChooser?: boolean } | { ok: false; message: string }> {
  if (stage.needsApkUpdate || !stage.filesystemPlugin) {
    return {
      ok: false,
      message: "Actualice la app de la tablet (reinstale el APK nuevo).",
    };
  }

  if (!stage.shareUri) {
    return { ok: false, message: "El reporte no esta listo. Espere un momento e intente de nuevo." };
  }

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    const outcome = await openHtmlInEpsonIPrint(stage.shareUri);
    if (outcome.ok) {
      return { ok: true, usedChooser: outcome.usedChooser };
    }
    return { ok: false, message: outcome.error ?? "No se pudo abrir Epson iPrint" };
  }

  if (!stage.sharePlugin) {
    return {
      ok: false,
      message: "Compartir no esta disponible en este dispositivo.",
    };
  }

  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({
      title: "Reporte de caja",
      text: "Reporte de caja",
      url: stage.shareUri,
      dialogTitle: "Abrir reporte con",
    });
    return { ok: true, usedChooser: true };
  } catch (error: unknown) {
    if (error instanceof Error && /cancel|abort/i.test(error.message)) {
      return { ok: true };
    }
    const message = error instanceof Error ? error.message : "No se pudo abrir el menu";
    return { ok: false, message };
  }
}

export async function copyCashReportSummary(printParams: CashClosureReportParams): Promise<boolean> {
  const text = buildCashReportTextSummary(printParams);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export function openCashReportByEmail(printParams: CashClosureReportParams): boolean {
  const subject = encodeURIComponent("Reporte de caja");
  const body = encodeURIComponent(buildCashReportTextSummary(printParams));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
  return true;
}

/**
 * Abre la vista de impresion dentro de la app (misma WebView).
 * En tablet evita intents de Chrome con URL demasiado larga (reporte no disponible).
 */
export async function openCashReportPrintView(html: string): Promise<{ ok: boolean; message?: string }> {
  if (openCashReportInAppPrintPage(html, true)) {
    return { ok: true };
  }

  const url = buildCashReportPrintPageUrl(html, { autoPrint: true, preferStash: true });
  if (!url) {
    return {
      ok: false,
      message: "El reporte es muy largo. Use Impresora de red o Copiar resumen.",
    };
  }

  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Browser")) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return { ok: true };
    } catch {
      /* fallback */
    }
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    return { ok: true };
  }

  window.location.assign(url);
  return { ok: true };
}

/** @deprecated Use openCashReportPrintView */
export const openCashReportInExternalBrowser = openCashReportPrintView;
