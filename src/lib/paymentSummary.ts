import { roundMoney } from "@/lib/paymentQuantity";

export interface PaymentMethodSummaryRow {
  methodId: string;
  methodName: string;
  amount: number;
  paymentCount: number;
}

/** Pagos que no deben sumar en recaudación / cuadre (anulados, reversados, transferencia pendiente). */
export function isPaymentExcludedFromCashSummary(payment: {
  notes?: string | null;
  status?: string | null;
}): boolean {
  const notes = String(payment.notes ?? "");
  const segments = notes.split("|").map((segment) => segment.trim());
  for (const segment of segments) {
    if (segment.startsWith("REVERSED:") || segment.startsWith("VOIDED:")) return true;
    if (segment === "TRANSFER_PROOF_PENDING:1") return true;
  }
  const status = String(payment.status ?? "").toLowerCase();
  return status === "voided" || status === "reversed";
}

export function buildMethodSummaryFromPayments(
  payments: Array<{
    amount?: number | null;
    payment_method_id?: string | null;
    notes?: string | null;
    status?: string | null;
  }>,
  methodNameById: Record<string, string>,
): PaymentMethodSummaryRow[] {
  const byMethod = new Map<string, { amount: number; paymentCount: number }>();

  for (const payment of payments) {
    if (isPaymentExcludedFromCashSummary(payment)) continue;
    const methodId = String(payment.payment_method_id ?? "");
    if (!methodId) continue;
    const current = byMethod.get(methodId) ?? { amount: 0, paymentCount: 0 };
    current.amount += Number(payment.amount ?? 0);
    current.paymentCount += 1;
    byMethod.set(methodId, current);
  }

  return Array.from(byMethod.entries())
    .map(([methodId, totals]) => ({
      methodId,
      methodName: methodNameById[methodId] ?? "Metodo",
      amount: roundMoney(totals.amount),
      paymentCount: totals.paymentCount,
    }))
    .sort((a, b) => b.amount - a.amount || a.methodName.localeCompare(b.methodName));
}
