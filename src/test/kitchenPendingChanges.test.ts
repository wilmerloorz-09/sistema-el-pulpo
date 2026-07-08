import { describe, expect, it } from "vitest";
import {
  computeKitchenSendMoneyDelta,
  formatKitchenSendMoneyDelta,
  hasKitchenPendingChanges,
} from "@/lib/kitchenPendingChanges";

describe("kitchenPendingChanges", () => {
  const baseline = [
    { id: "a", quantity: 2, unit_price: 1.25, tray_container_cost: 0 },
    { id: "b", quantity: 1, unit_price: 3.5, tray_container_cost: 0 },
  ];

  it("detecta cambios al quitar cantidad de una linea enviada", () => {
    const pending = [
      { id: "a", quantity: 1, unit_price: 1.25, tray_container_cost: 0 },
      { id: "b", quantity: 1, unit_price: 3.5, tray_container_cost: 0 },
    ];

    expect(hasKitchenPendingChanges(baseline, pending)).toBe(true);
    expect(computeKitchenSendMoneyDelta(baseline, pending)).toBe(-1.25);
    expect(formatKitchenSendMoneyDelta(-1.25)).toBe("$-1.25");
  });

  it("detecta cambios al agregar una linea nueva", () => {
    const pending = [
      ...baseline,
      { id: "c", quantity: 1, unit_price: 3.5, tray_container_cost: 0 },
    ];

    expect(hasKitchenPendingChanges(baseline, pending)).toBe(true);
    expect(computeKitchenSendMoneyDelta(baseline, pending)).toBe(3.5);
    expect(formatKitchenSendMoneyDelta(3.5)).toBe("+$3.50");
  });

  it("no marca cambios cuando la vista coincide con la base", () => {
    expect(hasKitchenPendingChanges(baseline, baseline)).toBe(false);
    expect(computeKitchenSendMoneyDelta(baseline, baseline)).toBe(0);
  });
});
