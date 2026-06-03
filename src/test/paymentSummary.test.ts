import { describe, expect, it } from "vitest";
import { buildMethodSummaryFromPayments, isPaymentExcludedFromCashSummary } from "@/lib/paymentSummary";

describe("paymentSummary", () => {
  it("excludes voided and reversed payments", () => {
    expect(isPaymentExcludedFromCashSummary({ notes: "VOIDED:abc", status: "voided" })).toBe(true);
    expect(isPaymentExcludedFromCashSummary({ notes: "REVERSED:abc", status: "reversed" })).toBe(true);
    expect(isPaymentExcludedFromCashSummary({ notes: null, status: "applied" })).toBe(false);
  });

  it("builds net method summary after partial void", () => {
    const methods = { cash: "Efectivo" };
    const rows = buildMethodSummaryFromPayments(
      [
        { payment_method_id: "cash", amount: 12, notes: "VOIDED:pay-1", status: "voided" },
        { payment_method_id: "cash", amount: 8.5, notes: "REPLACEMENT_FOR_VOID:pay-1", status: "applied" },
      ],
      methods,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(8.5);
    expect(rows[0].paymentCount).toBe(1);
  });
});
