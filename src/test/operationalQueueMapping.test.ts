import { describe, expect, it } from "vitest";
import { mapServerQueueItemToDispatchLine } from "@/lib/operationalQueue";

describe("mapServerQueueItemToDispatchLine", () => {
  it("confía en quantity_dispatchable del servidor (Sprite ya despachado → 0)", () => {
    const line = mapServerQueueItemToDispatchLine(
      {
        quantity: 1,
        quantity_paid: 1,
        quantity_ready_total: 1,
        quantity_dispatched_total: 1,
        quantity_cancelled_dispatched: 0,
        quantity_cancelled_total: 0,
        quantity_pending_prepare: 0,
        quantity_ready_available: 0,
        quantity_dispatchable: 0,
      },
      { status: "PAID", paid_at: "2026-08-29T00:00:00Z", order_type: "TABLE" },
      false,
    );
    expect(line.quantityDispatchable).toBe(0);
  });

  it("mapea cobrado y listo sin recalcular dispatchable en cliente", () => {
    const line = mapServerQueueItemToDispatchLine(
      {
        quantity: 2,
        quantity_paid: 2,
        quantity_ready_total: 2,
        quantity_dispatched_total: 0,
        quantity_cancelled_dispatched: 0,
        quantity_cancelled_total: 0,
        quantity_pending_prepare: 0,
        quantity_ready_available: 2,
        quantity_dispatchable: 2,
      },
      { status: "READY", paid_at: null, order_type: "TAKEOUT" },
      false,
    );
    expect(line.quantityDispatchable).toBe(2);
    expect(line.quantityPaid).toBe(2);
    expect(line.quantityReadyAvailable).toBe(2);
  });

  it("DISPATCH_THEN_CASH: quantity_paid de display usa orden activa, dispatchable del servidor", () => {
    const line = mapServerQueueItemToDispatchLine(
      {
        quantity: 3,
        quantity_paid: 0,
        quantity_ready_total: 3,
        quantity_dispatched_total: 0,
        quantity_cancelled_dispatched: 0,
        quantity_cancelled_total: 0,
        quantity_pending_prepare: 1,
        quantity_ready_available: 2,
        quantity_dispatchable: 3,
      },
      { status: "SENT_TO_KITCHEN", paid_at: null, order_type: "EXPRESS" },
      true,
    );
    expect(line.quantityDispatchable).toBe(3);
    expect(line.quantityPaid).toBe(3);
  });
});
