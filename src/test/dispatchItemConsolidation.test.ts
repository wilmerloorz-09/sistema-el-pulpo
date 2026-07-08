import { describe, expect, it } from "vitest";
import {
  buildDispatchAllocations,
  consolidateDispatchOrderItems,
} from "@/lib/dispatchItemConsolidation";
import type { DispatchOrderItem } from "@/hooks/useDispatchOrders";

function makeDispatchItem(overrides: Partial<DispatchOrderItem> & Pick<DispatchOrderItem, "id">): DispatchOrderItem {
  return {
    description_snapshot: "Chifle",
    quantity_ordered: 1,
    quantity_paid: 1,
    quantity_pending_prepare: 1,
    quantity_ready_available: 0,
    quantity_dispatchable: 1,
    quantity_dispatched: 0,
    quantity_cancelled: 0,
    unit_price: 0.25,
    status: "SENT",
    modifiers: [],
    sent_to_kitchen_at: "2026-07-08T00:00:00.000Z",
    paid_at: null,
    total: 0.25,
    ...overrides,
  };
}

describe("dispatchItemConsolidation", () => {
  it("consolida lineas identicas en una sola fila con cantidad sumada", () => {
    const consolidated = consolidateDispatchOrderItems([
      makeDispatchItem({ id: "line-a" }),
      makeDispatchItem({ id: "line-b" }),
    ]);

    expect(consolidated).toHaveLength(1);
    expect(consolidated[0]?.quantity_dispatchable).toBe(2);
    expect(consolidated[0]?.quantity_paid).toBe(2);
    expect(consolidated[0]?.total).toBe(0.5);
    expect(consolidated[0]?.group_item_ids).toEqual(["line-a", "line-b"]);
  });

  it("reparte despacho parcial entre lineas origen", () => {
    const item = consolidateDispatchOrderItems([
      makeDispatchItem({ id: "line-a" }),
      makeDispatchItem({ id: "line-b" }),
    ])[0]!;

    expect(buildDispatchAllocations(item, 1)).toEqual([
      { order_item_id: "line-a", quantity_dispatched: 1 },
    ]);

    expect(buildDispatchAllocations(item, 2)).toEqual([
      { order_item_id: "line-a", quantity_dispatched: 1 },
      { order_item_id: "line-b", quantity_dispatched: 1 },
    ]);
  });
});
