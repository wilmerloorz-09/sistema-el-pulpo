import { describe, expect, it } from "vitest";
import { computeLineAmount, computePendingActiveQuantity, computePendingQuantity } from "@/lib/paymentQuantity";

describe("paymentQuantity", () => {
  it("calcula pendientes por cantidad en multiples pagos", () => {
    const encebolladoPendingAfterP1 = computePendingQuantity(3, 2);
    const cevichePendingAfterP1 = computePendingQuantity(4, 1);
    const gaseosaPendingAfterP1 = computePendingQuantity(6, 3);

    expect(encebolladoPendingAfterP1).toBe(1);
    expect(cevichePendingAfterP1).toBe(3);
    expect(gaseosaPendingAfterP1).toBe(3);

    const encebolladoPendingAfterP2 = computePendingQuantity(3, 2);
    const cevichePendingAfterP2 = computePendingQuantity(4, 3);
    const gaseosaPendingAfterP2 = computePendingQuantity(6, 4);

    expect(encebolladoPendingAfterP2).toBe(1);
    expect(cevichePendingAfterP2).toBe(1);
    expect(gaseosaPendingAfterP2).toBe(2);

    const encebolladoPendingAfterP3 = computePendingQuantity(3, 3);
    const cevichePendingAfterP3 = computePendingQuantity(4, 4);
    const gaseosaPendingAfterP3 = computePendingQuantity(6, 6);

    expect(encebolladoPendingAfterP3).toBe(0);
    expect(cevichePendingAfterP3).toBe(0);
    expect(gaseosaPendingAfterP3).toBe(0);
  });

  it("calcula pendientes activos restando pagado y cancelado", () => {
    expect(computePendingActiveQuantity(3, 1, 1)).toBe(1);
    expect(computePendingActiveQuantity(4, 0, 2)).toBe(2);
    expect(computePendingActiveQuantity(6, 4, 2)).toBe(0);
  });

  it("calcula monto por linea usando cantidad parcial", () => {
    expect(computeLineAmount(2, 6.5)).toBe(13);
    expect(computeLineAmount(3, 1.25)).toBe(3.75);
  });
});
