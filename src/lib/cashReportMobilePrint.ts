import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { CashClosureReportParams } from "@/lib/cashReportUtils";
import { formatDateTime, formatMoney } from "@/lib/cashReportUtils";

export type MobileCashReportPrintResult =
  | { ok: true }
  | { ok: false; message: string };

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildTextSummary(params: CashClosureReportParams): string {
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

async function shareHtmlFile(html: string): Promise<void> {
  const filename = `reporte-caja-${Date.now()}.html`;
  const docHtml = html.trim().startsWith("<!doctype") ? html : `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;

  await Filesystem.writeFile({
    path: filename,
    data: textToBase64(docHtml),
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({
    directory: Directory.Cache,
    path: filename,
  });

  await Share.share({
    title: "Reporte de caja",
    text: "Reporte de caja",
    url: uri,
    dialogTitle: "Imprimir reporte",
  });
}

/**
 * Tablet: abre el menu nativo de Android al instante (sin generar PDF).
 * Android cancela acciones si tardan mucho despues del clic.
 */
export async function printCashReportOnMobile(
  html: string,
  printParams?: CashClosureReportParams | null,
): Promise<MobileCashReportPrintResult> {
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        await shareHtmlFile(html);
        return { ok: true };
      } catch (nativeError: unknown) {
        const nativeMessage =
          nativeError instanceof Error ? nativeError.message : "Error al compartir archivo";

        if (printParams) {
          try {
            await Share.share({
              title: "Reporte de caja",
              text: buildTextSummary(printParams),
              dialogTitle: "Enviar reporte",
            });
            return { ok: true };
          } catch {
            return {
              ok: false,
              message: `${nativeMessage}. Reinstale la app de la tablet.`,
            };
          }
        }

        return {
          ok: false,
          message: `${nativeMessage}. Reinstale la app de la tablet.`,
        };
      }
    }

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      const text = printParams ? buildTextSummary(printParams) : "Reporte de caja";
      await navigator.share({ title: "Reporte de caja", text });
      return { ok: true };
    }

    return {
      ok: false,
      message: "Impresion no disponible aqui. Use una PC con la Epson L395 conectada.",
    };
  } catch (error: unknown) {
    if (error instanceof Error && /cancel|abort/i.test(error.message)) {
      return { ok: true };
    }
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("[cash-report-mobile-print]", error);
    return { ok: false, message };
  }
}
