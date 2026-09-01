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
  platform: string;
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

export function getMobilePrintStage(): Omit<MobilePrintStage, "ready" | "shareUri" | "error"> {
  return {
    native: Capacitor.isNativePlatform(),
    sharePlugin: Capacitor.isPluginAvailable("Share"),
    filesystemPlugin: Capacitor.isPluginAvailable("Filesystem"),
    platform: Capacitor.getPlatform(),
  };
}

/** Prepara el archivo mientras el usuario ve el reporte (antes del clic en compartir). */
export async function stageCashReportForShare(html: string): Promise<MobilePrintStage> {
  const base = getMobilePrintStage();

  if (!base.native) {
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: null,
    };
  }

  if (!base.sharePlugin) {
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: "La app instalada no tiene soporte para compartir. Reinstale la app de la tablet.",
    };
  }

  if (!base.filesystemPlugin) {
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: "La app instalada no puede guardar el reporte. Reinstale la app de la tablet.",
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
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "No se pudo preparar el reporte";
    return {
      ...base,
      ready: true,
      shareUri: null,
      error: message,
    };
  }
}

/** Debe llamarse directamente desde un boton (gesto del usuario). */
export async function openCashReportShareMenu(
  stage: MobilePrintStage,
  printParams?: CashClosureReportParams | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (stage.native && stage.shareUri) {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: "Reporte de caja",
        text: "Reporte de caja",
        url: stage.shareUri,
        dialogTitle: "Imprimir reporte",
      });
      return { ok: true };
    }

    if (stage.native && printParams) {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: "Reporte de caja",
        text: buildCashReportTextSummary(printParams),
        dialogTitle: "Enviar reporte",
      });
      return { ok: true };
    }

    if (typeof navigator !== "undefined" && typeof navigator.share === "function" && printParams) {
      await navigator.share({
        title: "Reporte de caja",
        text: buildCashReportTextSummary(printParams),
      });
      return { ok: true };
    }

    return {
      ok: false,
      message:
        stage.error ??
        "En esta tablet no se puede imprimir directo. Use una PC con la Epson L395 conectada.",
    };
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
