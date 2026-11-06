import { describe, expect, it } from "vitest";
import {
  countUnsentDraftUnits,
  getDispatchedEditQuantity,
  getDispatchedEditTargetQuantity,
  isDispatchFirstOrder,
  isOrderItemFullyDispatched,
  isPureTakeoutOrder,
  orderBlocksCollectForUnsentDrafts,
  redistributeGroupedItemQuantities,
  resolveInDispatchStagingQuantities,
} from "@/lib/orderFlow";

describe("isPureTakeoutOrder", () => {
  it("identifies para llevar without bandeja or especial", () => {
    expect(isPureTakeoutOrder({ order_type: "TAKEOUT", is_tray_order: false, is_special: false })).toBe(true);
  });

  it("excludes orden especial", () => {
    expect(isPureTakeoutOrder({ order_type: "TAKEOUT", is_special: true })).toBe(false);
  });

  it("excludes orden bandeja", () => {
    expect(isPureTakeoutOrder({ order_type: "TAKEOUT", is_tray_order: true })).toBe(false);
  });
});

describe("orderBlocksCollectForUnsentDrafts", () => {
  it("applies to para llevar and express", () => {
    expect(orderBlocksCollectForUnsentDrafts({ order_type: "TAKEOUT" })).toBe(true);
    expect(orderBlocksCollectForUnsentDrafts({ order_type: "EXPRESS" })).toBe(true);
    expect(orderBlocksCollectForUnsentDrafts({ order_type: "DINE_IN" })).toBe(false);
  });

  it("no bloquea orden especial para llevar (cobro manual)", () => {
    expect(orderBlocksCollectForUnsentDrafts({ order_type: "TAKEOUT", is_special: true })).toBe(false);
  });

  it("counts draft units only", () => {
    expect(
      countUnsentDraftUnits([
        { status: "DRAFT", quantity: 2 },
        { status: "SENT", quantity: 5 },
        { status: "DRAFT", quantity: 1 },
      ]),
    ).toBe(3);
  });
});

describe("isDispatchFirstOrder", () => {
  const dispatchFirstWorkflow = "DISPATCH_THEN_CASH";

  it("blocks mesa until dispatch in dispatch-first workflow", () => {
    expect(isDispatchFirstOrder({ order_type: "DINE_IN" }, dispatchFirstWorkflow)).toBe(true);
  });

  it("allows special takeout with value to collect without dispatch", () => {
    expect(
      isDispatchFirstOrder(
        { order_type: "TAKEOUT", is_special: true, special_total_manual: 6 },
        dispatchFirstWorkflow,
      ),
    ).toBe(false);
  });

  it("treats special takeout $0 as dispatch-first (autopago al despachar)", () => {
    expect(
      isDispatchFirstOrder(
        { order_type: "TAKEOUT", is_special: true, special_total_manual: 0 },
        dispatchFirstWorkflow,
      ),
    ).toBe(true);
    expect(
      isDispatchFirstOrder(
        { order_type: "TAKEOUT", is_special: true, special_total_manual: 0 },
        "CASH_THEN_DISPATCH",
      ),
    ).toBe(true);
  });

  it("blocks orden especial de mesa until dispatch like mesa", () => {
    expect(
      isDispatchFirstOrder({ order_type: "DINE_IN", is_special: true }, dispatchFirstWorkflow),
    ).toBe(true);
  });

  it("treats special express like express (dispatch-first)", () => {
    expect(
      isDispatchFirstOrder(
        { order_type: "EXPRESS", is_special: true, special_total_manual: 5 },
        "CASH_THEN_DISPATCH",
      ),
    ).toBe(true);
  });

  it("allows para llevar to pay before dispatch", () => {
    expect(
      isDispatchFirstOrder({ order_type: "TAKEOUT", is_special: false, is_tray_order: false }, dispatchFirstWorkflow),
    ).toBe(false);
  });

  it("does not block takeout when workflow is cash-first", () => {
    expect(
      isDispatchFirstOrder({ order_type: "DINE_IN" }, "CASH_THEN_DISPATCH"),
    ).toBe(false);
  });
});

describe("edicion temporal de cantidades despachadas", () => {
  it("edita solo la porcion despachada de una linea parcial", () => {
    const item = {
      quantity: 5,
      quantity_dispatched: 2,
      quantity_remaining: 3,
    };

    expect(getDispatchedEditQuantity(item)).toBe(2);
    expect(getDispatchedEditTargetQuantity(item, 1)).toBe(4);
  });

  it("permite eliminar la porcion despachada sin tocar lo que sigue en despacho", () => {
    const item = {
      quantity: 5,
      quantity_dispatched: 2,
      quantity_remaining: 3,
    };

    expect(getDispatchedEditTargetQuantity(item, 0)).toBe(3);
  });

  it("usa directamente la cantidad objetivo cuando toda la linea fue despachada", () => {
    const item = {
      quantity: 3,
      quantity_dispatched: 3,
      quantity_remaining: 0,
    };

    expect(getDispatchedEditQuantity(item)).toBe(3);
    expect(getDispatchedEditTargetQuantity(item, 5)).toBe(5);
  });
});

describe("resolveInDispatchStagingQuantities", () => {
  it("baja cantidad en EN DESPACHO de una linea solo enviada", () => {
    const item = {
      quantity: 2,
      quantity_dispatched: 0,
      quantity_remaining: 2,
      status: "DISPATCHED",
    };

    expect(isOrderItemFullyDispatched(item)).toBe(false);
    expect(resolveInDispatchStagingQuantities(item, 1)).toEqual({
      quantity: 1,
      quantity_remaining: 1,
    });
  });

  it("al bajar EN DESPACHO de una parcial preserva lo ya despachado", () => {
    const item = {
      quantity: 5,
      quantity_dispatched: 3,
      quantity_remaining: 2,
    };

    expect(resolveInDispatchStagingQuantities(item, 1)).toEqual({
      quantity: 4,
      quantity_remaining: 1,
    });
  });
});

describe("redistributeGroupedItemQuantities", () => {
  it("baja unidades desde la ultima linea consolidada", () => {
    expect(
      redistributeGroupedItemQuantities(["a", "b"], [1, 1], 1),
    ).toEqual([
      { id: "a", quantity: 1 },
      { id: "b", quantity: 0 },
    ]);
  });

  it("sube unidades en la ultima linea consolidada", () => {
    expect(
      redistributeGroupedItemQuantities(["a", "b"], [1, 1], 3),
    ).toEqual([
      { id: "a", quantity: 1 },
      { id: "b", quantity: 2 },
    ]);
  });

  it("actualiza una sola linea sin redistribuir", () => {
    expect(
      redistributeGroupedItemQuantities(["a"], [2], 1),
    ).toEqual([{ id: "a", quantity: 1 }]);
  });
});
