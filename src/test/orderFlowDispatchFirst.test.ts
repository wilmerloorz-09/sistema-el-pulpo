import { describe, expect, it } from "vitest";
import {
  getDispatchedEditQuantity,
  getDispatchedEditTargetQuantity,
  isDispatchFirstOrder,
  isPureTakeoutOrder,
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

describe("isDispatchFirstOrder", () => {
  const dispatchFirstWorkflow = "DISPATCH_THEN_CASH";

  it("blocks mesa until dispatch in dispatch-first workflow", () => {
    expect(isDispatchFirstOrder({ order_type: "DINE_IN" }, dispatchFirstWorkflow)).toBe(true);
  });

  it("blocks orden especial until dispatch like mesa", () => {
    expect(
      isDispatchFirstOrder({ order_type: "TAKEOUT", is_special: true }, dispatchFirstWorkflow),
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
