import { buildCashReportEscPos } from "@/lib/escpos/buildCashReportEscPos";
import { buildPaymentReceiptEscPos, type PaymentReceiptEscPosInput } from "@/lib/escpos/buildPaymentReceipt";
import { buildOrderReceiptEscPos, type OrderReceiptEscPosInput } from "@/lib/escpos/buildOrderReceipt";
import type { CashClosureReportParams } from "@/lib/cashReportUtils";
import { sanitizarPromocionReciboData } from "@/lib/promocionesRecibo";
import { DEFAULT_THERMAL_PRINT_BRIDGE_URL } from "@/lib/escpos/constants";
import { Capacitor } from "@capacitor/core";
import { TcpSocket } from "@deedarb/capacitor-tcp-socket";
import { loadEscPosLogo, buildCombinedHeaderRaster } from "@/lib/escpos/encoder";

export type ThermalPrintMode = "escpos" | "html";

export interface ThermalPrintResult {
  mode: ThermalPrintMode;
  error?: string;
}

function getBridgeUrl(): string {
  const fromEnv = import.meta.env.VITE_THERMAL_PRINT_BRIDGE_URL;
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : DEFAULT_THERMAL_PRINT_BRIDGE_URL;
}

function getPrinterName(): string | undefined {
  const fromEnv = import.meta.env.VITE_THERMAL_PRINTER_NAME;
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : undefined;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Envía bytes ESC/POS al puente local (RAW). */
export async function sendEscPosToBridge(bytes: Uint8Array): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    return sendEscPosNative(bytes);
  }

  const controller = new AbortController();
  // Reduce timeout to 1.5s so it falls back to window.print() quickly if the bridge isn't running
  const timeout = window.setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(getBridgeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: uint8ToBase64(bytes),
        printerName: getPrinterName(),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(body || `Puente de impresion respondio ${response.status}`);
    }

    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (payload.ok === false) {
      throw new Error(payload.error || "El puente rechazo la impresion");
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

async function sendEscPosNative(bytes: Uint8Array): Promise<void> {
  const storedIp = localStorage.getItem("activePrinterIp");
  const storedPort = localStorage.getItem("activePrinterPort");

  const ip = storedIp || import.meta.env.VITE_THERMAL_PRINTER_IP || "192.168.1.100";
  const port = storedPort ? Number(storedPort) : Number(import.meta.env.VITE_THERMAL_PRINTER_PORT || 9100);
  
  return new Promise((resolve, reject) => {
    let timeoutId = setTimeout(() => {
      reject(new Error("Timeout al conectar con la impresora TCP"));
    }, 5000);

    const execute = async () => {
      try {
        const connectResult = await TcpSocket.connect({ ipAddress: ip, port: port, timeout: 5 });
        const client = connectResult.client;
        
        const b64Data = uint8ToBase64(bytes);
        
        await TcpSocket.send({ client: client, data: b64Data });
        
        // Dar tiempo al buffer de red del OS para que envíe los paquetes antes de cerrar el socket
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        
        await TcpSocket.disconnect({ client: client });
        
        clearTimeout(timeoutId);
        resolve();
      } catch (e: any) {
        clearTimeout(timeoutId);
        reject(new Error("Error al imprimir via TCP: " + e.message));
      }
    };
    void execute();
  });
}

export function isThermalBridgeEnabled(): boolean {
  const flag = import.meta.env.VITE_THERMAL_PRINT_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

/** Imprime comprobante de pago: ESC/POS primero; si falla, window.print() (HTML 80mm). */
export async function printPaymentReceipt(input: PaymentReceiptEscPosInput): Promise<ThermalPrintResult> {
  const receiptInput = await sanitizarPromocionReciboData(input);

  if (isThermalBridgeEnabled()) {
    try {
      const date = new Date(receiptInput.createdAt);
      const dateStr = date.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
      const timeStr = date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

      const resolveLabel = () => {
        if (receiptInput.isTrayOrder) return "ORDEN BANDEJA";
        if (receiptInput.isSpecial) return "ORDEN ESPECIAL";
        if (receiptInput.orderType === "TAKEOUT") return "PARA LLEVAR";
        if (receiptInput.orderType === "EXPRESS") return "EXPRESS";
        if (receiptInput.orderType === "EXTRA") return "EXTRA";
        return receiptInput.tableName ?? "MESA";
      };

      const headerLines = [
        receiptInput.branchName || "",
        "ORDEN",
        `${receiptInput.orderNumber}`,
        `${resolveLabel()} - ${dateStr} ${timeStr}`
      ].filter(Boolean);

      const headerBytes = await buildCombinedHeaderRaster("/logo.png", headerLines).catch(() => null);
      const bytes = buildPaymentReceiptEscPos({ ...receiptInput, headerBytes });
      await sendEscPosToBridge(bytes);
      return { mode: "escpos" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error de impresion ESC/POS";
      console.warn("[thermalPrint] ESC/POS fallo, usando HTML:", message);
      window.print();
      return { mode: "html", error: message };
    }
  }

  window.print();
  return { mode: "html" };
}

/** Imprime reporte de caja en impresora termica (80mm). */
export async function printCashReportReceipt(input: CashClosureReportParams): Promise<ThermalPrintResult> {
  if (isThermalBridgeEnabled()) {
    try {
      const bytes = buildCashReportEscPos(input);
      await sendEscPosToBridge(bytes);
      return { mode: "escpos" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error de impresion ESC/POS";
      console.warn("[thermalPrint] ESC/POS reporte caja fallo:", message);

      if (Capacitor.isNativePlatform()) {
        return { mode: "html", error: message };
      }

      window.print();
      return { mode: "html", error: message };
    }
  }

  if (Capacitor.isNativePlatform()) {
    return {
      mode: "html",
      error: "Impresion termica desactivada. Configure VITE_THERMAL_PRINT_ENABLED.",
    };
  }

  window.print();
  return { mode: "html" };
}

/** Imprime ticket de orden (cocina/comanda). */
export async function printOrderReceipt(input: OrderReceiptEscPosInput): Promise<ThermalPrintResult> {
  if (isThermalBridgeEnabled()) {
    try {
      const bytes = buildOrderReceiptEscPos(input);
      await sendEscPosToBridge(bytes);
      return { mode: "escpos" };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Error de impresion ESC/POS";
      console.warn("[thermalPrint] ESC/POS orden fallo, usando HTML:", message);
      window.print();
      return { mode: "html", error: message };
    }
  }

  window.print();
  return { mode: "html" };
}
