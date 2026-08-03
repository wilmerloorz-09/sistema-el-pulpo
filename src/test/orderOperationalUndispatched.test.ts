import { describe, expect, it } from "vitest";
import {
  computeOperationalQuantities,
  computeUndispatchedQuantity,
  hasOrderItemOperationalProgress,
} from "@/lib/orderOperational";

describe("computeUndispatchedQuantity", () => {
  it("returns zero when everything is dispatched", () => {
    const quantities = computeOperationalQuantities({
      quantityOrdered: 3,
      quantityDispatchedTotal: 3,
    });
    expect(computeUndispatchedQuantity(quantities)).toBe(0);
  });

  it("returns pending units when only part was dispatched", () => {
    const quantities = computeOperationalQuantities({
      quantityOrdered: 4,
      quantityDispatchedTotal: 1,
    });
    expect(computeUndispatchedQuantity(quantities)).toBe(3);
  });

  it("ignores cancelled units from the active ordered count", () => {
    const quantities = computeOperationalQuantities({
      quantityOrdered: 5,
      quantityDispatchedTotal: 2,
      quantityCancelledPending: 2,
    });
    expect(computeUndispatchedQuantity(quantities)).toBe(1);
  });
});

describe("hasOrderItemOperationalProgress", () => {
  it("no trata un borrador nuevo sin snapshot como progreso (pendingPrepare=0)", () => {
    expect(
      hasOrderItemOperationalProgress({
        activeQuantity: 1,
        quantityDispatched: 0,
        quantityReadyAvailable: 0,
        quantityPendingPrepare: 0,
        hasOperationalSnapshot: false,
      }),
    ).toBe(false);
  });

  it("con snapshot vacio (pendingPrepare=0) no trata borrador nuevo como progreso", () => {
    expect(
      hasOrderItemOperationalProgress({
        activeQuantity: 1,
        quantityDispatched: 0,
        quantityReadyAvailable: 0,
        quantityPendingPrepare: 0,
        hasOperationalSnapshot: true,
      }),
    ).toBe(false);
  });

  it("con snapshot y pending completo, sigue sin progreso de avance", () => {
    expect(
      hasOrderItemOperationalProgress({
        activeQuantity: 1,
        quantityDispatched: 0,
        quantityReadyAvailable: 0,
        quantityPendingPrepare: 1,
        hasOperationalSnapshot: true,
      }),
    ).toBe(false);
  });

  it("detecta progreso cuando hay listo o despachado", () => {
    expect(
      hasOrderItemOperationalProgress({
        activeQuantity: 2,
        quantityDispatched: 1,
        quantityReadyAvailable: 0,
        quantityPendingPrepare: 1,
        hasOperationalSnapshot: true,
      }),
    ).toBe(true);
  });
});
