import { buildPaymentReceiptEscPos, type PaymentReceiptEscPosInput } from "@/lib/escpos/buildPaymentReceipt";
import { buildOrderReceiptEscPos, type OrderReceiptEscPosInput } from "@/lib/escpos/buildOrderReceipt";
import { DEFAULT_THERMAL_PRINT_BRIDGE_URL } from "@/lib/escpos/constants";
import { Capacitor } from "@capacitor/core";
import { TcpSocket } from "@deedarb/capacitor-tcp-socket";

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
  const timeout = window.setTimeout(() => controller.abort(), 8000);

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
  const ip = import.meta.env.VITE_THERMAL_PRINTER_IP || "192.168.1.100";
  const port = Number(import.meta.env.VITE_THERMAL_PRINTER_PORT || 9100);
  
  return new Promise(async (resolve, reject) => {
    let timeoutId = setTimeout(() => {
      reject(new Error("Timeout al conectar con la impresora TCP"));
    }, 5000);

    try {
      const connectResult = await TcpSocket.connect({ ipAddress: ip, port: port, timeout: 5 });
      const client = connectResult.client;
      
      const b64Data = uint8ToBase64(bytes);
      
      await TcpSocket.send({ client: client, data: b64Data });
      
      await TcpSocket.disconnect({ client: client });
      
      clearTimeout(timeoutId);
      resolve();
    } catch (e: any) {
      clearTimeout(timeoutId);
      reject(new Error("Error al imprimir via TCP: " + e.message));
    }
  });
}

export function isThermalBridgeEnabled(): boolean {
  const flag = import.meta.env.VITE_THERMAL_PRINT_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

/** Imprime comprobante de pago: ESC/POS primero; si falla, window.print() (HTML 80mm). */
export async function printPaymentReceipt(input: PaymentReceiptEscPosInput): Promise<ThermalPrintResult> {
  if (isThermalBridgeEnabled()) {
    try {
      const bytes = buildPaymentReceiptEscPos(input);
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
