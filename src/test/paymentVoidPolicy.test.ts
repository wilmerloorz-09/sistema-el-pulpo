import { describe, expect, it } from "vitest";
import { getPaymentVoidValidationMessage } from "@/lib/paymentVoidPolicy";

const baseCase = {
  paymentExists: true,
  currentShiftExists: true,
  currentShiftOpen: true,
  paymentShiftId: "shift-1",
  currentShiftId: "shift-1",
  paymentStatus: "active",
  alreadyVoided: false,
  supervisorAuthorized: true,
  reason: "Cobro duplicado",
} as const;

describe("payment void policy", () => {
  it("allows voiding when the payment belongs to the same open shift and has supervisor approval", () => {
    expect(getPaymentVoidValidationMessage(baseCase)).toBeNull();
  });

  it("rejects when the payment belongs to a different shift", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        paymentShiftId: "shift-2",
      }),
    ).toBe("El pago solo puede anularse dentro del mismo turno en que fue registrado");
  });

  it("rejects when the shift is closed", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        currentShiftOpen: false,
      }),
    ).toBe("No se puede anular un pago de un turno cerrado");
  });

  it("rejects when supervisor authorization is missing", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        supervisorAuthorized: false,
      }),
    ).toBe("Solo un supervisor puede autorizar la anulacion del pago");
  });

  it("rejects when the reason is empty", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        reason: "   ",
      }),
    ).toBe("Debes indicar un motivo para anular el pago");
  });

  it("rejects when the payment was already voided", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        alreadyVoided: true,
        paymentStatus: "voided",
      }),
    ).toBe("El pago ya fue anulado");
  });

  it("rejects when the payment is missing", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        paymentExists: false,
      }),
    ).toBe("El pago no existe");
  });

  it("rejects when the payment status is not voidable", () => {
    expect(
      getPaymentVoidValidationMessage({
        ...baseCase,
        paymentStatus: "refunded",
      }),
    ).toBe("El pago no esta en un estado anulable");
  });
});
