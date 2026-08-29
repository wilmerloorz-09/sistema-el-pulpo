import { describe, expect, it } from "vitest";
import {
  computeDispatchableQtyFromSnapshotItem,
  orderTreatAsFullyPaidForDispatch,
  resolveDispatchLinePaidQty,
} from "@/lib/orderOperational";
import { operationalMapsFromBundleItems } from "@/lib/dispatchServirQueueBundle";

describe("computeDispatchableQtyFromSnapshotItem", () => {
  it("CASH_THEN_DISPATCH: línea ya despachada no aparece en cola (caso Sprite #0218)", () => {
    const dispatchable = computeDispatchableQtyFromSnapshotItem({
      quantityOrdered: 1,
      quantityPendingPrepare: 0,
      quantityReadyAvailable: 0,
      quantityPaid: 1,
      quantityDispatchedTotal: 1,
      quantityCancelledDispatched: 0,
      quantityCancelledTotal: 0,
      isDispatchFirst: false,
    });
    expect(dispatchable).toBe(0);
  });

  it("CASH_THEN_DISPATCH: cobrado y listo sin despachar sí es despachable", () => {
    const dispatchable = computeDispatchableQtyFromSnapshotItem({
      quantityOrdered: 2,
      quantityPendingPrepare: 0,
      quantityReadyAvailable: 2,
      quantityPaid: 2,
      quantityDispatchedTotal: 0,
      quantityCancelledDispatched: 0,
      quantityCancelledTotal: 0,
      isDispatchFirst: false,
    });
    expect(dispatchable).toBe(2);
  });

  it("CASH_THEN_DISPATCH: cobro parcial limita despacho", () => {
    const dispatchable = computeDispatchableQtyFromSnapshotItem({
      quantityOrdered: 3,
      quantityPendingPrepare: 1,
      quantityReadyAvailable: 2,
      quantityPaid: 1,
      quantityDispatchedTotal: 0,
      quantityCancelledDispatched: 0,
      quantityCancelledTotal: 0,
      isDispatchFirst: false,
    });
    expect(dispatchable).toBe(1);
  });

  it("CASH_THEN_DISPATCH: orden PAID completa habilita despacho aunque quantity_paid del bundle sea 0", () => {
    const dispatchable = computeDispatchableQtyFromSnapshotItem({
      quantityOrdered: 2,
      quantityPendingPrepare: 0,
      quantityReadyAvailable: 2,
      quantityPaid: 0,
      quantityDispatchedTotal: 0,
      quantityCancelledDispatched: 0,
      quantityCancelledTotal: 0,
      isDispatchFirst: false,
      orderFullyPaid: true,
    });
    expect(dispatchable).toBe(2);
  });

  it("DISPATCH_THEN_CASH: despacha trabajo disponible sin exigir cobro", () => {
    const dispatchable = computeDispatchableQtyFromSnapshotItem({
      quantityOrdered: 2,
      quantityPendingPrepare: 1,
      quantityReadyAvailable: 1,
      quantityPaid: 0,
      quantityDispatchedTotal: 0,
      quantityCancelledDispatched: 0,
      quantityCancelledTotal: 0,
      isDispatchFirst: true,
    });
    expect(dispatchable).toBe(2);
  });
});

describe("orderTreatAsFullyPaidForDispatch / resolveDispatchLinePaidQty", () => {
  it("TAKEOUT bandeja en READY con paid_at cuenta como cobrada (Empaquetador)", () => {
    const order = {
      paid_at: "2026-08-29T12:00:00Z",
      status: "READY",
      order_type: "TAKEOUT",
      is_tray_order: true,
    };
    expect(orderTreatAsFullyPaidForDispatch(order)).toBe(true);
    expect(
      resolveDispatchLinePaidQty({ id: "item-1", quantity: 3 }, {}, order),
    ).toBe(3);
  });

  it("TAKEOUT PAID sin payment_items en snapshot sigue siendo despachable", () => {
    const order = {
      paid_at: "2026-08-29T12:00:00Z",
      status: "PAID",
      order_type: "TAKEOUT",
      is_tray_order: false,
    };
    const dispatchable = computeDispatchableQtyFromSnapshotItem({
      quantityOrdered: 2,
      quantityPendingPrepare: 2,
      quantityReadyAvailable: 0,
      quantityPaid: 0,
      quantityDispatchedTotal: 0,
      quantityCancelledDispatched: 0,
      quantityCancelledTotal: 0,
      isDispatchFirst: false,
      orderFullyPaid: orderTreatAsFullyPaidForDispatch(order),
    });
    expect(dispatchable).toBe(2);
  });
});

describe("operationalMapsFromBundleItems dispatchedAvailableMap", () => {
  it("usa unidades ya despachadas netas, no pending+ready", () => {
    const maps = operationalMapsFromBundleItems([
      {
        id: "item-sprite",
        quantity_ready_total: 1,
        quantity_ready_available: 0,
        quantity_pending_prepare: 0,
        quantity_dispatched_total: 1,
        quantity_paid: 1,
        quantity_cancelled_pending: 0,
        quantity_cancelled_ready: 0,
        quantity_cancelled_dispatched: 0,
        quantity_cancelled_total: 0,
      },
    ] as any);

    expect(maps.dispatchedAvailableMap["item-sprite"]).toBe(1);
    expect(maps.pendingPrepareMap["item-sprite"]).toBe(0);
    expect(maps.readyAvailableMap["item-sprite"]).toBe(0);
  });
});
