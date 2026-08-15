import { describe, expect, it } from "vitest";
import {
  isPackingOrderType,
  orderMatchesDispatchModuleRoute,
  shouldReserveOrderForPacking,
} from "@/lib/dispatchModuleRouting";

describe("dispatch module routing", () => {
  it("identifica las ordenes que pertenecen al empaquetador", () => {
    expect(isPackingOrderType("TAKEOUT")).toBe(true);
    expect(isPackingOrderType("EXPRESS")).toBe(true);
    expect(isPackingOrderType("TABLE")).toBe(false);
    expect(isPackingOrderType("EXTRA")).toBe(false);
  });

  it("reserva para llevar y express para empaquetador cuando hay empacador habilitado", () => {
    expect(shouldReserveOrderForPacking({ order_type: "TAKEOUT" }, true)).toBe(true);
    expect(shouldReserveOrderForPacking({ order_type: "EXPRESS" }, true)).toBe(true);
    expect(shouldReserveOrderForPacking({ order_type: "TAKEOUT", is_special: true }, true)).toBe(false);
    expect(shouldReserveOrderForPacking({ order_type: "TAKEOUT" }, false)).toBe(false);
  });

  it("oculta para llevar de despacho cuando hay empacador habilitado", () => {
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT" }, "dispatch", true)).toBe(false);
    expect(orderMatchesDispatchModuleRoute({ order_type: "EXPRESS" }, "dispatch", true)).toBe(false);
    expect(orderMatchesDispatchModuleRoute({ order_type: "TABLE" }, "dispatch", true)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT" }, "dispatch", false)).toBe(true);
  });

  it("mantiene empaquetador limitado a para llevar y express no especiales", () => {
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT" }, "packing", true)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "EXPRESS" }, "packing", false)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "TABLE" }, "packing", true)).toBe(false);
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT", is_special: true }, "packing", true)).toBe(false);
  });
});
