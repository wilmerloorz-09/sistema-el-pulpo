import { EscPosEncoder, formatAmountLine, wrapWords } from "./encoder";
import { THERMAL_LINE_CHARS } from "./constants";

export interface OrderReceiptEscPosInput {
  orderNumber: string | number;
  orderType: string;
  isSpecial?: boolean;
  isTrayOrder?: boolean;
  tableName?: string;
  items: Array<{
    description_snapshot: string;
    quantity: number;
    unit_price: number;
    total: number;
    tray_item_type?: "A" | "B" | "C" | null;
    modifiers: { description: string }[];
    item_note?: string | null;
  }>;
  total: number;
  createdAt: string;
}

function resolveOrderLabel(input: OrderReceiptEscPosInput): string {
  if (input.isTrayOrder) return "ORDEN BANDEJA";
  if (input.isSpecial) return "ORDEN ESPECIAL";
  if (input.orderType === "TAKEOUT") return "PARA LLEVAR";
  if (input.orderType === "EXPRESS") return "EXPRESS";
  if (input.orderType === "EXTRA") return "EXTRA";
  return input.tableName ?? "MESA";
}

export function buildOrderReceiptEscPos(input: OrderReceiptEscPosInput): Uint8Array {
  const date = new Date(input.createdAt);
  const dateStr = date.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  const enc = new EscPosEncoder();
  enc.initialize().codePageLatin1();

  enc.align("center").bold(true).textSize(false);
  enc.line(`ORDEN ${input.orderNumber}`);
  enc.bold(false).textSize(true);
  enc.line(resolveOrderLabel(input));
  enc.line(`${dateStr} ${timeStr}`);
  enc.feed(1);

  // Usar Font B y espaciado de 40 para que las líneas estén bien separadas
  enc.font("B").lineSpacing(40);

  enc.align("left").separator();

    const indent = "  "; // 2 spaces left margin
    for (const item of input.items ?? []) {
      const isBulk = item.tray_item_type === "C";
      const amount = `$${Number(item.total).toFixed(2)}`;
      const left = isBulk ? item.description_snapshot : `${item.quantity}x ${item.description_snapshot}`;
      const lines = wrapWords(left, THERMAL_LINE_CHARS - indent.length);
      lines.forEach((line, idx) => {
        if (idx === lines.length - 1) {
          enc.line(indent + formatAmountLine(line, amount, THERMAL_LINE_CHARS - indent.length));
        } else {
          enc.line(indent + line);
        }
      });

      for (const mod of item.modifiers ?? []) {
        const desc = String(mod.description ?? "").trim();
        if (!desc) continue;
        enc.line(`${indent}  - ${desc}`);
      }

      const note = String(item.item_note ?? "").trim();
      if (note) {
        const prefix = note.toLowerCase().startsWith("entregar:") ? "" : "Nota: ";
        for (const line of wrapWords(`${prefix}${note}`, THERMAL_LINE_CHARS - indent.length - 2)) {
          enc.line(`${indent}  ${line}`);
        }
      }
    }

  enc.separator();
  enc.bold(true);
  enc.line(formatAmountLine("TOTAL", `$${Number(input.total).toFixed(2)}`));
  enc.bold(false);

  enc.align("center");
  enc.feed(1);
  enc.line("Gracias por su compra");

  // Restablecer fuente A e interlineado por defecto para la finalización (evita corte del final)
  enc.font("A").lineSpacing(null);

  enc.finalizeTicket({ feedLines: 5 });

  return enc.build();
}
