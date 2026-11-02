import { describe, expect, it } from "vitest";
import {
  isPackingEnvaseItem,
  isPackingOrderType,
  itemBelongsToPackingRoute,
  itemMatchesDispatchModuleRoute,
  orderMatchesDispatchModuleRoute,
  orderMayAppearInPackingModule,
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
    expect(orderMatchesDispatchModuleRoute({ order_type: "DINE_IN" }, "dispatch", true)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT" }, "dispatch", false)).toBe(true);
  });

  it("permite mesa en empaquetador solo si hay empacador (lineas Con envase)", () => {
    expect(orderMayAppearInPackingModule({ order_type: "TAKEOUT" }, false)).toBe(true);
    expect(orderMayAppearInPackingModule({ order_type: "DINE_IN" }, true)).toBe(true);
    expect(orderMayAppearInPackingModule({ order_type: "DINE_IN" }, false)).toBe(false);
    expect(orderMayAppearInPackingModule({ order_type: "DINE_IN", is_special: true }, true)).toBe(false);
    expect(orderMatchesDispatchModuleRoute({ order_type: "DINE_IN" }, "packing", true)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "DINE_IN" }, "packing", false)).toBe(false);
  });

  it("enruta Con envase de mesa (tray B) a empaquetador y fuera de despacho/servir", () => {
    const mesa = { order_type: "DINE_IN" };
    const envase = { tray_item_type: "B" as const };
    const plato = { tray_item_type: null };

    expect(isPackingEnvaseItem(envase)).toBe(true);
    expect(itemBelongsToPackingRoute(mesa, envase, true)).toBe(true);
    expect(itemBelongsToPackingRoute(mesa, envase, false)).toBe(false);
    expect(itemBelongsToPackingRoute(mesa, plato, true)).toBe(false);

    expect(itemMatchesDispatchModuleRoute(mesa, envase, "packing", true)).toBe(true);
    expect(itemMatchesDispatchModuleRoute(mesa, plato, "packing", true)).toBe(false);
    expect(itemMatchesDispatchModuleRoute(mesa, envase, "dispatch", true)).toBe(false);
    expect(itemMatchesDispatchModuleRoute(mesa, plato, "dispatch", true)).toBe(true);
    expect(itemMatchesDispatchModuleRoute(mesa, envase, "servir", true)).toBe(false);
    expect(itemMatchesDispatchModuleRoute(mesa, envase, "dispatch", false)).toBe(true);
  });

  it("mantiene empaquetador de para llevar/express a nivel orden", () => {
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT" }, "packing", true)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "EXPRESS" }, "packing", false)).toBe(true);
    expect(orderMatchesDispatchModuleRoute({ order_type: "TAKEOUT", is_special: true }, "packing", true)).toBe(false);
    expect(itemBelongsToPackingRoute({ order_type: "TAKEOUT" }, { tray_item_type: null }, true)).toBe(true);
  });
});
