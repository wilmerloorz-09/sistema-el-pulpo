import { describe, expect, it } from "vitest";
import {
  computeDispatchItemCatalogTotal,
  prorateOrderChargeAmount,
  resolveDispatchPendingChargeTotal,
} from "@/lib/orderFlow";

describe("resolveDispatchPendingChargeTotal", () => {
  it("uses manual special total instead of catalog sum when all items are pending", () => {
    const result = resolveDispatchPendingChargeTotal({
      is_special: true,
      special_total_manual: 2,
      special_group_total: null,
      items: [
        {
          unit_price: 1.75,
          quantity_paid: 2,
          quantity_dispatchable: 2,
        },
      ],
    });

    expect(result.catalogOrderTotal).toBe(3.5);
    expect(result.catalogPendingTotal).toBe(3.5);
    expect(result.chargeTotal).toBe(2);
    expect(result.pendingTotal).toBe(2);
  });

  it("prorates manual total when only part of the order is pending dispatch", () => {
    const result = resolveDispatchPendingChargeTotal({
      is_special: true,
      special_total_manual: 2,
      special_group_total: null,
      items: [
        {
          unit_price: 1.75,
          quantity_paid: 2,
          quantity_dispatchable: 1,
        },
      ],
    });

    expect(result.pendingTotal).toBe(1);
  });

  it("keeps catalog total for non-special orders", () => {
    const result = resolveDispatchPendingChargeTotal({
      is_special: false,
      special_total_manual: null,
      special_group_total: null,
      items: [
        {
          unit_price: 1.75,
          quantity_paid: 2,
          quantity_dispatchable: 2,
        },
      ],
    });

    expect(result.chargeTotal).toBeNull();
    expect(result.pendingTotal).toBe(3.5);
  });
});

describe("computeDispatchItemCatalogTotal", () => {
  it("adds tray container cost for type B items", () => {
    expect(
      computeDispatchItemCatalogTotal(
        { unit_price: 2, tray_item_type: "B", tray_container_cost: 0.5 },
        2,
      ),
    ).toBe(4.5);
  });
});

describe("prorateOrderChargeAmount", () => {
  it("returns zero when there is nothing pending", () => {
    expect(prorateOrderChargeAmount(2, 0, 3.5)).toBe(0);
  });
});
