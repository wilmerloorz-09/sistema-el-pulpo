import { getOrderRef } from "@/lib/orderPresentation";
import { isCashPaymentMethodName } from "@/lib/paymentMethods";
import {
  computeCashBalance,
  sumNonCashChangeFromCompletedPayments,
} from "@/lib/transferCashChange";
import {
  formatDateTime,
  formatMoney,
  translateCashStatus,
  translatePaymentStatus,
  type CashClosureReportParams,
} from "@/lib/cashReportUtils";
import { EscPosEncoder, formatAmountLine, wrapWords } from "@/lib/escpos/encoder";
import { THERMAL_LINE_CHARS } from "@/lib/escpos/constants";

const MAX_PAYMENT_LINES = 18;

function shortDateTime(value: string | null | undefined): string {
  if (!value) return "N/D";
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildCashReportEscPos(params: CashClosureReportParams): Uint8Array {
  const sortedDenoms = [...params.shift.denoms]
    .filter((denomination) => denomination.value > 0)
    .sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.value - b.value;
    });

  const totalInitial =
    params.openingCashTotals?.initial ??
    sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_initial, 0);
  const totalCurrent =
    params.openingCashTotals?.current ??
    sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_current, 0);
  const physicalDelta = totalCurrent - totalInitial;

  const transferFromPayments = sumNonCashChangeFromCompletedPayments(params.completedPayments);
  const transferCashChangeTotal =
    transferFromPayments > 0 ? transferFromPayments : Math.max(0, Number(params.transferCashChangeTotal ?? 0));

  const cashCollected = params.methodSummary
    .filter((entry) => isCashPaymentMethodName(entry.methodName))
    .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  const collectedNet = params.methodSummary.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const cashBalance = computeCashBalance({
    physicalDelta,
    cashCollected,
    transferCashChangeTotal,
  });
  const cashBalanceAbs = Math.abs(cashBalance);
  const cashBalanced = cashBalanceAbs < 0.01;

  const uniquePayments = Array.from(
    new Map(
      params.completedPayments.map((payment) => [
        payment.id,
        {
          created_at: payment.created_at,
          amount: payment.amount,
          method_name: payment.method_name,
          order_ref: getOrderRef(payment.order_code, payment.order_number),
          status: translatePaymentStatus(payment.status),
        },
      ]),
    ).values(),
  ).sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

  const isOpeningReport = params.reportMode === "opening";
  const currentOpening = params.shift.openingHistory[0] ?? null;
  const reportTitle = isOpeningReport ? "REPORTE APERTURA CAJA" : "REPORTE CIERRE CAJA";

  const enc = new EscPosEncoder();
  enc.initialize().codePageLatin1();
  enc.align("center").bold(true).textSize(false);
  enc.line(reportTitle);
  enc.bold(false).textSize(true);

  for (const line of wrapWords(params.branchName, THERMAL_LINE_CHARS)) {
    enc.line(line);
  }

  enc.textSize(false);
  enc.line(formatDateTime(new Date().toISOString()));
  enc.feed(1);

  if (isOpeningReport && currentOpening) {
    enc.align("left");
    enc.line(`Apertura: ${shortDateTime(currentOpening.opened_at)}`);
    enc.line(`Cierre: ${shortDateTime(currentOpening.closed_at)}`);
    enc.line(`Estado: ${currentOpening.status}`);
    enc.line(`Cajero: ${currentOpening.cashier_username || currentOpening.cashier_name || "N/D"}`);
  } else {
    enc.align("left");
    enc.line(`Turno: ${shortDateTime(params.shift.opened_at)}`);
    enc.line(`Estado: ${translateCashStatus(params.shift.caja_status)}`);
  }

  enc.separator("=");
  enc.bold(true).line("RESUMEN");
  enc.bold(false);
  enc.line(formatAmountLine("Apertura", formatMoney(totalInitial)));
  enc.line(formatAmountLine("Caja actual", formatMoney(totalCurrent)));
  enc.line(formatAmountLine("Diferencia", formatMoney(physicalDelta)));
  enc.line(formatAmountLine("Cobrado neto", formatMoney(collectedNet)));
  enc.line(formatAmountLine("Vuelto transf.", formatMoney(transferCashChangeTotal)));
  enc.bold(true);
  enc.line(
    formatAmountLine(
      cashBalanced ? "Cuadre OK" : cashBalance > 0 ? "Sobra" : "Falta",
      formatMoney(cashBalanceAbs),
    ),
  );
  enc.bold(false);

  if (params.methodSummary.length > 0) {
    enc.separator("-");
    enc.bold(true).line("COBRO POR METODO");
    enc.bold(false);
    for (const method of params.methodSummary) {
      enc.line(formatAmountLine(`${method.methodName} (${method.paymentCount})`, formatMoney(method.amount)));
    }
  }

  if (uniquePayments.length > 0) {
    enc.separator("-");
    enc.bold(true).line(isOpeningReport ? "PAGOS APERTURA" : "PAGOS TURNO");
    enc.bold(false);

    const paymentsToPrint = uniquePayments.slice(-MAX_PAYMENT_LINES);
    for (const payment of paymentsToPrint) {
      const header = `${shortDateTime(payment.created_at)} ${payment.order_ref || "N/D"}`;
      for (const line of wrapWords(header, THERMAL_LINE_CHARS - 12)) {
        enc.line(line);
      }
      enc.line(
        formatAmountLine(
          `${payment.method_name} ${payment.status}`,
          formatMoney(payment.amount),
          THERMAL_LINE_CHARS,
        ),
      );
    }

    if (uniquePayments.length > MAX_PAYMENT_LINES) {
      enc.line(`... y ${uniquePayments.length - MAX_PAYMENT_LINES} pagos mas`);
    }
  }

  const closingDenoms = sortedDenoms.filter((denomination) => Number(denomination.qty_current ?? 0) > 0);
  if (closingDenoms.length > 0) {
    enc.separator("-");
    enc.bold(true).line("DENOMINACIONES");
    enc.bold(false);
    for (const denomination of closingDenoms) {
      enc.line(
        formatAmountLine(
          `${denomination.label || formatMoney(denomination.value)} x${denomination.qty_current ?? 0}`,
          formatMoney(denomination.value * Number(denomination.qty_current ?? 0)),
        ),
      );
    }
  }

  if (params.closureNotes?.trim()) {
    enc.separator("-");
    enc.bold(true).line("NOTAS");
    enc.bold(false);
    for (const line of wrapWords(params.closureNotes.trim(), THERMAL_LINE_CHARS)) {
      enc.line(line);
    }
  }

  enc.align("center");
  enc.feed(1);
  enc.line("--- FIN REPORTE ---");
  enc.font("A").lineSpacing(null);
  enc.finalizeTicket({ feedLines: 5 });
  return enc.build();
}
