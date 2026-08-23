import { isCashPaymentMethodName } from "@/lib/paymentMethods";
import { isPaymentExcludedFromCashSummary } from "@/lib/paymentSummary";
import { roundMoney } from "@/lib/paymentQuantity";

export type TransferCashChangePayment = {
  id: string;
  payment_method_id?: string | null;
  notes?: string | null;
  status?: string | null;
};

export type TransferCashChangeOutRow = {
  payment_id: string | null;
  denomination_id: string;
  qty_delta: number;
  movement_type?: string | null;
};

/**
 * Suma CHANGE_OUT de pagos activos que NO son efectivo (p. ej. vuelto en
 * efectivo cuando una transferencia “sobrepaga”).
 * No incluye vueltos de cobros en efectivo ni salidas de anulaciones
 * (esos pagos quedan excluidos del resumen).
 */
export function sumNonCashPaymentChangeOut(params: {
  payments: TransferCashChangePayment[];
  methodNameById: Record<string, string>;
  changeOutMovements: TransferCashChangeOutRow[];
  denominationValueById: Record<string, number>;
}): number {
  const eligiblePaymentIds = new Set<string>();

  for (const payment of params.payments) {
    if (isPaymentExcludedFromCashSummary(payment)) continue;
    const methodName = params.methodNameById[String(payment.payment_method_id ?? "")] ?? "";
    if (!methodName || isCashPaymentMethodName(methodName)) continue;
    eligiblePaymentIds.add(payment.id);
  }

  if (eligiblePaymentIds.size === 0) return 0;

  let total = 0;
  for (const row of params.changeOutMovements) {
    if (!row.payment_id || !eligiblePaymentIds.has(row.payment_id)) continue;
    if (row.movement_type && String(row.movement_type) !== "CHANGE_OUT") continue;
    const value = Number(params.denominationValueById[row.denomination_id] ?? 0);
    const qty = Math.max(0, Math.floor(Number(row.qty_delta ?? 0)));
    if (value <= 0 || qty <= 0) continue;
    total += qty * value;
  }

  return roundMoney(total);
}

/**
 * Misma idea que sumNonCashPaymentChangeOut, pero desde filas de cobros ya
 * hidratadas (reporte / listado) con method_name + cash_change_detail.
 */
export function sumNonCashChangeFromCompletedPayments(
  payments: Array<{
    method_name?: string | null;
    notes?: string | null;
    status?: string | null;
    cash_change_detail?: Array<{ total?: number | null }> | null;
  }>,
): number {
  let total = 0;
  for (const payment of payments) {
    if (isPaymentExcludedFromCashSummary(payment)) continue;
    if (isCashPaymentMethodName(String(payment.method_name ?? ""))) continue;
    for (const line of payment.cash_change_detail ?? []) {
      const lineTotal = Number(line.total ?? 0);
      if (lineTotal > 0) total += lineTotal;
    }
  }
  return roundMoney(total);
}

/** Cuadre: (físico − apertura) − efectivo cobrado + vuelto efectivo por no-efectivo. */
export function computeCashBalance(params: {
  physicalDelta: number;
  cashCollected: number;
  transferCashChangeTotal?: number;
}): number {
  return roundMoney(
    params.physicalDelta
      - params.cashCollected
      + Number(params.transferCashChangeTotal ?? 0),
  );
}
