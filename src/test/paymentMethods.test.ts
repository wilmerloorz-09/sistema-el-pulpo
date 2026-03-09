import { describe, expect, it } from "vitest";
import { dedupePaymentMethods, getDefaultPaymentMethodId } from "@/lib/paymentMethods";

describe("paymentMethods helpers", () => {
  it("dedupePaymentMethods keeps a single method per id", () => {
    const methods = [
      { id: "1", name: "Efectivo" },
      { id: "1", name: "Efectivo" },
      { id: "2", name: "Tarjeta" },
    ];

    const result = dedupePaymentMethods(methods);

    expect(result).toEqual([
      { id: "1", name: "Efectivo" },
      { id: "2", name: "Tarjeta" },
    ]);
  });

  it("getDefaultPaymentMethodId selects Efectivo by default", () => {
    const methods = [
      { id: "2", name: "Tarjeta" },
      { id: "1", name: "Efectivo" },
      { id: "3", name: "Transferencia" },
    ];

    expect(getDefaultPaymentMethodId(methods)).toBe("1");
  });

  it("getDefaultPaymentMethodId falls back to first method", () => {
    const methods = [
      { id: "9", name: "Tarjeta" },
      { id: "3", name: "Transferencia" },
    ];

    expect(getDefaultPaymentMethodId(methods)).toBe("9");
  });
});
