import { describe, expect, it } from "vitest";
import {
  computeCashBalance,
  sumNonCashChangeFromCompletedPayments,
  sumNonCashPaymentChangeOut,
} from "@/lib/transferCashChange";

describe("sumNonCashPaymentChangeOut", () => {
  const methods = {
    cash: "Efectivo",
    transfer: "Transferencia",
  };

  it("suma CHANGE_OUT solo de transferencias activas", () => {
    const total = sumNonCashPaymentChangeOut({
      payments: [
        { id: "p-cash", payment_method_id: "cash", status: "COMPLETED" },
        { id: "p-tr", payment_method_id: "transfer", status: "COMPLETED" },
        { id: "p-void-tr", payment_method_id: "transfer", status: "voided", notes: "VOIDED:x" },
      ],
      methodNameById: methods,
      changeOutMovements: [
        { payment_id: "p-cash", denomination_id: "d25", qty_delta: 1, movement_type: "CHANGE_OUT" },
        { payment_id: "p-tr", denomination_id: "d25", qty_delta: 1, movement_type: "CHANGE_OUT" },
        { payment_id: "p-void-tr", denomination_id: "d25", qty_delta: 4, movement_type: "CHANGE_OUT" },
        { payment_id: "p-tr", denomination_id: "d25", qty_delta: 1, movement_type: "PAYMENT_IN" },
      ],
      denominationValueById: { d25: 0.25 },
    });

    expect(total).toBe(0.25);
  });

  it("devuelve 0 si no hay vueltos de no-efectivo", () => {
    expect(sumNonCashPaymentChangeOut({
      payments: [{ id: "p-cash", payment_method_id: "cash", status: "COMPLETED" }],
      methodNameById: methods,
      changeOutMovements: [
        { payment_id: "p-cash", denomination_id: "d1", qty_delta: 2, movement_type: "CHANGE_OUT" },
      ],
      denominationValueById: { d1: 1 },
    })).toBe(0);
  });
});

describe("sumNonCashChangeFromCompletedPayments", () => {
  it("suma cash_change_detail solo de no-efectivo activos", () => {
    expect(sumNonCashChangeFromCompletedPayments([
      {
        method_name: "Efectivo",
        status: "APPLIED",
        cash_change_detail: [{ total: 1 }],
      },
      {
        method_name: "Transferencia",
        status: "APPLIED",
        cash_change_detail: [{ total: 0.25 }],
      },
      {
        method_name: "Transferencia",
        status: "VOIDED",
        notes: "VOIDED:x",
        cash_change_detail: [{ total: 2 }],
      },
    ])).toBe(0.25);
  });
});

describe("computeCashBalance con vuelto por transferencia", () => {
  it("Michelle: diferencia 331 − efectivo 331.25 + vuelto 0.25 = 0", () => {
    expect(computeCashBalance({
      physicalDelta: 331,
      cashCollected: 331.25,
      transferCashChangeTotal: 0.25,
    })).toBe(0);
  });

  it("sin vuelto mantiene el descuadre", () => {
    expect(computeCashBalance({
      physicalDelta: 331,
      cashCollected: 331.25,
    })).toBe(-0.25);
  });
});
