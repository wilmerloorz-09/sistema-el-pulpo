const CASH_REPORT_PRINT_PREFIX = "el-pulpo-cash-report-print:";
const CASH_REPORT_PRINT_TTL_MS = 60 * 60 * 1000;
const CASH_REPORT_PRINT_CHANNEL = "el-pulpo-cash-report-print";

export function getCashReportPrintStoragePrefix(): string {
  return CASH_REPORT_PRINT_PREFIX;
}

export function getCashReportPrintChannelName(): string {
  return CASH_REPORT_PRINT_CHANNEL;
}

function cleanupOldPrintKeys(): void {
  if (typeof localStorage === "undefined") return;

  const now = Date.now();
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(CASH_REPORT_PRINT_PREFIX)) continue;

    const timestamp = Number(key.slice(CASH_REPORT_PRINT_PREFIX.length).split("-")[0]);
    if (!Number.isFinite(timestamp) || now - timestamp > CASH_REPORT_PRINT_TTL_MS) {
      localStorage.removeItem(key);
    }
  }
}

export function stashCashReportHtml(html: string): string {
  if (typeof localStorage === "undefined") {
    throw new Error("Almacenamiento no disponible.");
  }

  cleanupOldPrintKeys();
  const key = `${CASH_REPORT_PRINT_PREFIX}${Date.now()}-${crypto.randomUUID()}`;
  localStorage.setItem(key, html);
  return key;
}

export function readCashReportHtml(key: string | null | undefined): string | null {
  if (!key || typeof localStorage === "undefined") return null;
  if (!key.startsWith(CASH_REPORT_PRINT_PREFIX)) return null;
  return localStorage.getItem(key);
}

export type InkjetPrintOpenResult = "opened" | "failed";

/** Abre el reporte en Chrome/navegador donde sí funciona imprimir en Epson u otra impresora. */
export async function openCashReportForInkjetPrint(html: string): Promise<InkjetPrintOpenResult> {
  if (typeof window === "undefined") return "failed";

  let key: string;
  try {
    key = stashCashReportHtml(html);
  } catch {
    return "failed";
  }

  const url = `${window.location.origin}/imprimir-reporte-caja?k=${encodeURIComponent(key)}`;

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CASH_REPORT_PRINT_CHANNEL);
    channel.postMessage({ type: "report", key, html });
    channel.close();
  }

  await new Promise((resolve) => window.setTimeout(resolve, 120));

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return "opened";
    }
  } catch (error: unknown) {
    console.error("[cash-report-inkjet]", error);
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  return popup ? "opened" : "failed";
}
