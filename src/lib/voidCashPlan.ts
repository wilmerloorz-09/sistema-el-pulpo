import { roundMoney } from "@/lib/paymentQuantity";

export type VoidDenomLine = {
  denomination_id: string;
  label: string;
  value: number;
  qty: number;
  total: number;
  image_url?: string | null;
};

export type VoidCashPlan = {
  mode: "exact_tender" | "greedy";
  /** Denominaciones a entregar al cliente (salen de caja). */
  cashOut: VoidDenomLine[];
  /** Vuelto que el cliente regresa a caja (entran). */
  cashIn: VoidDenomLine[];
  outTotal: number;
  inTotal: number;
  netTotal: number;
};

type StockDenom = {
  denomination_id: string;
  label: string;
  value: number;
  qty_current: number;
  display_order?: number;
  image_url?: string | null;
};

type DetailLine = {
  denomination_id: string;
  label: string;
  value: number;
  qty: number;
  total?: number;
  image_url?: string | null;
};

function toLine(line: DetailLine): VoidDenomLine {
  const qty = Math.max(0, Math.floor(Number(line.qty ?? 0)));
  const value = Number(line.value ?? 0);
  return {
    denomination_id: line.denomination_id,
    label: line.label,
    value,
    qty,
    total: roundMoney(qty * value),
    image_url: line.image_url ?? null,
  };
}

function sumLines(lines: VoidDenomLine[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
}

/** ¿La caja tiene al menos las cantidades del desglose recibido? */
export function hasExactTenderStock(
  received: DetailLine[],
  stock: StockDenom[],
): boolean {
  const stockById = new Map(
    stock.map((d) => [d.denomination_id, Math.max(0, Number(d.qty_current ?? 0))]),
  );
  for (const line of received) {
    const qty = Math.max(0, Math.floor(Number(line.qty ?? 0)));
    if (qty <= 0) continue;
    if ((stockById.get(line.denomination_id) ?? 0) < qty) return false;
  }
  return received.some((line) => Math.max(0, Math.floor(Number(line.qty ?? 0))) > 0);
}

function buildGreedyOut(refundAmount: number, stock: StockDenom[]): VoidDenomLine[] {
  if (refundAmount <= 0.001) return [];

  const sorted = [...stock]
    .filter((d) => Number(d.value) > 0)
    .sort(
      (a, b) =>
        Number(b.value) - Number(a.value)
        || Number(a.display_order ?? 0) - Number(b.display_order ?? 0),
    );

  const result: VoidDenomLine[] = [];
  let remaining = refundAmount;

  for (const denomination of sorted) {
    if (remaining <= 0.001) break;
    const available = Math.max(0, Number(denomination.qty_current ?? 0));
    if (available <= 0) continue;

    const maxQty = Math.floor(remaining / denomination.value + 1e-9);
    const qty = Math.min(maxQty, available);
    if (qty <= 0) continue;

    result.push({
      denomination_id: denomination.denomination_id,
      label: denomination.label,
      value: Number(denomination.value),
      qty,
      total: roundMoney(qty * Number(denomination.value)),
      image_url: denomination.image_url ?? null,
    });
    remaining = roundMoney(remaining - qty * Number(denomination.value));
  }

  return result;
}

/**
 * Plan de efectivo al anular.
 * - exact_tender: devolver lo que entregó el cliente y reingresar el vuelto (mismas denoms),
 *   solo si es anulación completa y la caja aún tiene el billete/moneda original.
 * - greedy: armar solo el monto anulado con lo disponible en caja (comportamiento actual).
 */
export function buildVoidCashPlan(input: {
  refundAmount: number;
  paymentAmount: number;
  receivedLines: DetailLine[];
  changeLines: DetailLine[];
  shiftDenoms: StockDenom[];
}): VoidCashPlan {
  const refundAmount = roundMoney(Math.max(0, Number(input.refundAmount ?? 0)));
  const paymentAmount = roundMoney(Math.max(0, Number(input.paymentAmount ?? 0)));
  const isFullVoid = paymentAmount > 0 && Math.abs(refundAmount - paymentAmount) < 0.015;
  const received = (input.receivedLines ?? [])
    .map(toLine)
    .filter((line) => line.qty > 0 && line.value > 0);
  const change = (input.changeLines ?? [])
    .map(toLine)
    .filter((line) => line.qty > 0 && line.value > 0);

  if (
    isFullVoid
    && refundAmount > 0
    && received.length > 0
    && hasExactTenderStock(received, input.shiftDenoms)
  ) {
    const outTotal = sumLines(received);
    const inTotal = sumLines(change);
    const netTotal = roundMoney(outTotal - inTotal);
    if (Math.abs(netTotal - refundAmount) < 0.015) {
      return {
        mode: "exact_tender",
        cashOut: received,
        cashIn: change,
        outTotal,
        inTotal,
        netTotal,
      };
    }
  }

  const cashOut = buildGreedyOut(refundAmount, input.shiftDenoms);
  return {
    mode: "greedy",
    cashOut,
    cashIn: [],
    outTotal: sumLines(cashOut),
    inTotal: 0,
    netTotal: sumLines(cashOut),
  };
}
