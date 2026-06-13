import { roundMoney } from "@/lib/paymentQuantity";
import { EscPosEncoder, formatAmountLine, wrapWords } from "./encoder";
import { THERMAL_LINE_CHARS } from "./constants";
import type { PaymentReceiptData } from "@/lib/paymentReceiptData";

export type PaymentReceiptEscPosInput = PaymentReceiptData & {
  /** Abrir cajon antes del corte (nunca despues). */
  openDrawerBeforeCut?: boolean;
  headerBytes?: Uint8Array | null;
};

function formatMoney(amount: number) {
  return `$${roundMoney(amount).toFixed(2)}`;
}

function resolveOrderLabel(input: PaymentReceiptEscPosInput): string {
  if (input.isTrayOrder) return "ORDEN BANDEJA";
  if (input.isSpecial) return "ORDEN ESPECIAL";
  if (input.orderType === "TAKEOUT") return "PARA LLEVAR";
  if (input.orderType === "EXPRESS") return "EXPRESS";
  if (input.orderType === "EXTRA") return "EXTRA";
  return input.tableName ?? "MESA";
}

export function buildPaymentReceiptEscPos(input: PaymentReceiptEscPosInput): Uint8Array {
  const date = new Date(input.createdAt);
  const dateStr = date.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  const enc = new EscPosEncoder();
  enc.initialize().codePageLatin1();

  if (input.headerBytes) {
    // Si tenemos los bytes del encabezado combinado (logo + texto)
    enc.align("center");
    enc.raw(input.headerBytes);
  } else {
    // Fallback: Encabezado de texto clásico si falla la renderización del lienzo
    enc.align("center");

    if (input.branchName) {
      for (const line of wrapWords(input.branchName, THERMAL_LINE_CHARS)) {
        enc.line(line);
      }
    }

    enc.bold(true).textSize(true);
    enc.line("ORDEN");
    enc.line(`${input.orderNumber}`);
    enc.bold(false).textSize(false);
    enc.line(resolveOrderLabel(input));
    enc.line(`${dateStr} ${timeStr}`);
    if (input.clienteNombre) {
      enc.line(`Cliente: ${input.clienteNombre}`);
    }
    if (input.clienteCedula) {
      enc.line(`Cedula: ${input.clienteCedula}`);
    }
    enc.feed(1);
  }

  // Usar Font B y menor interlineado para ahorrar papel en el cuerpo del ticket
  enc.font("B").lineSpacing(28);

  enc.align("left").separator();

  if (!input.isSpecial) {
    enc.bold(true).line("PRODUCTOS:");
    enc.bold(false);
    for (const item of input.items ?? []) {
      const amount = formatMoney(item.amount);
      const header = `${item.quantity}x ${item.description}`;
      const lines = wrapWords(header, THERMAL_LINE_CHARS);
      lines.forEach((line, idx) => {
        if (idx === lines.length - 1) {
          enc.line(formatAmountLine(line, amount));
        } else {
          enc.line(line);
        }
      });
      enc.line(`  P.U. ${formatMoney(item.unitPrice)}`);
    }
  } else {
    enc.line(formatAmountLine("CARGO ESPECIAL", formatMoney(input.totalAmount)));
  }

  enc.separator();

  enc.bold(true);
  enc.line(formatAmountLine("TOTAL A PAGAR", formatMoney(input.totalAmount)));
  enc.bold(false);

  for (const payment of input.payments ?? []) {
    enc.line(formatAmountLine(payment.methodName, formatMoney(payment.appliedAmount)));
  }

  enc.line("-".repeat(THERMAL_LINE_CHARS));
  enc.line(formatAmountLine("RECIBIDO", formatMoney(input.totalReceived)));
  enc.bold(true);
  enc.line(formatAmountLine("CAMBIO", formatMoney(input.changeAmount)));
  enc.bold(false);

  // Restablecer fuente A e interlineado por defecto para el pie de página y la finalización (evita corte de QR)
  enc.font("A").lineSpacing(null);

  enc.align("center");
  enc.line("GRACIAS POR SU PREFERENCIA");

  if (input.token_promocion) {
    enc.feed(1);
    enc.separator("=");
    enc.bold(true).line("¡OFERTA MUNDIALISTA!");
    enc.bold(false);
    enc.line("Escanea el QR para registrar");
    enc.line("tu prediccion y ganar.");
    enc.bold(true).line(`CODIGO: ${input.token_promocion}`);
    enc.bold(false);
    enc.feed(1);
    const url = `https://sistema-el-pulpo.vercel.app/promociones/registro?t=${input.token_promocion}`;
    enc.qrcode(url, 4);
    enc.feed(1);
    enc.separator("=");
  }

  enc.finalizeTicket({
    feedLines: 5,
    openDrawer: input.openDrawerBeforeCut,
  });

  return enc.build();
}
