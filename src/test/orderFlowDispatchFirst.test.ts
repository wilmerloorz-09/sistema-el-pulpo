import { describe, expect, it } from "vitest";
import { isDispatchFirstOrder, isPureTakeoutOrder } from "@/lib/orderFlow";

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
