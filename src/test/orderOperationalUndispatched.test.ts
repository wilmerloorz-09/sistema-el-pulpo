import { describe, expect, it } from "vitest";
import { computeOperationalQuantities, computeUndispatchedQuantity } from "@/lib/orderOperational";

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
