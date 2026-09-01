import { Capacitor } from "@capacitor/core";
import type { CashClosureReportParams } from "@/lib/cashReportUtils";
import { formatDateTime, formatMoney } from "@/lib/cashReportUtils";

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

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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

function normalizeReportHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
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

/** Abre menu nativo de Android (requiere app actualizada). */
export async function openCashReportShareMenu(stage: MobilePrintStage): Promise<{ ok: true } | { ok: false; message: string }> {
  if (stage.needsApkUpdate || !stage.sharePlugin) {
    return {
      ok: false,
      message: "Actualice la app de la tablet (reinstale el APK nuevo).",
    };
  }

  if (!stage.shareUri) {
    return { ok: false, message: "El reporte no esta listo. Espere un momento e intente de nuevo." };
  }

  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({
      title: "Reporte de caja",
      text: "Reporte de caja",
      url: stage.shareUri,
      dialogTitle: "Imprimir reporte",
    });
    return { ok: true };
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

export async function openCashReportInExternalBrowser(html: string): Promise<boolean> {
  const encoded = encodeURIComponent(textToBase64(normalizeReportHtml(html)));
  const url = `${window.location.origin}/imprimir-reporte-caja?d=${encoded}`;

  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Browser")) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return true;
    } catch {
      /* fallback below */
    }
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  return Boolean(popup);
}
