import { describe, expect, it } from "vitest";
import {
  computeKitchenSendMoneyDelta,
  computeKitchenSendMoneyDeltaForSend,
  formatKitchenSendMoneyDelta,
  hasKitchenPendingChanges,
  hasKitchenPendingSendChanges,
  reconcileKitchenStagedItems,
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

  it("ignora bajas de lineas ya despachadas para Enviar a cocina", () => {
    const dispatchedBaseline = [
      {
        id: "d1",
        quantity: 3,
        unit_price: 3.5,
        tray_container_cost: 0,
        quantity_dispatched: 3,
        quantity_remaining: 0,
        status: "SENT_TO_KITCHEN",
      },
      {
        id: "e1",
        quantity: 2,
        unit_price: 1.25,
        tray_container_cost: 0,
        quantity_dispatched: 0,
        quantity_remaining: 2,
        status: "SENT_TO_KITCHEN",
      },
    ];
    const pending = [
      { ...dispatchedBaseline[0], quantity: 0, total: 0 },
      dispatchedBaseline[1],
    ];

    expect(hasKitchenPendingChanges(dispatchedBaseline, pending)).toBe(true);
    expect(hasKitchenPendingSendChanges(dispatchedBaseline, pending)).toBe(false);
    expect(computeKitchenSendMoneyDeltaForSend(dispatchedBaseline, pending)).toBe(0);
  });

  it("si incluye baja en En despacho, si cuenta para Enviar a cocina", () => {
    const mixBaseline = [
      {
        id: "d1",
        quantity: 3,
        unit_price: 3.5,
        tray_container_cost: 0,
        quantity_dispatched: 3,
        quantity_remaining: 0,
      },
      {
        id: "e1",
        quantity: 2,
        unit_price: 1.25,
        tray_container_cost: 0,
        quantity_dispatched: 0,
        quantity_remaining: 2,
      },
    ];
    const pending = [
      { ...mixBaseline[0], quantity: 0, total: 0 },
      { ...mixBaseline[1], quantity: 1, total: 1.25 },
    ];

    expect(hasKitchenPendingSendChanges(mixBaseline, pending)).toBe(true);
    expect(computeKitchenSendMoneyDeltaForSend(mixBaseline, pending)).toBe(-1.25);
  });

  it("reemplaza ids temp-* con lineas reales del servidor", () => {
    const staged = [
      { id: "line-1", quantity: 1, unit_price: 3 },
      { id: "temp-123", quantity: 2, unit_price: 0.5 },
    ];
    const server = [
      { id: "line-1", quantity: 1, unit_price: 3 },
      { id: "real-999", quantity: 2, unit_price: 0.5 },
    ];

    expect(reconcileKitchenStagedItems(staged, server)).toEqual([
      { id: "line-1", quantity: 1, unit_price: 3 },
      { id: "real-999", quantity: 2, unit_price: 0.5 },
    ]);
  });

  it("sin temps no reinyecta lineas del servidor ausentes en staging", () => {
    const staged = [{ id: "line-1", quantity: 1, unit_price: 3 }];
    const server = [
      { id: "line-1", quantity: 1, unit_price: 3 },
      { id: "deleted-locally", quantity: 1, unit_price: 2 },
    ];

    expect(reconcileKitchenStagedItems(staged, server)).toEqual(staged);
  });
});
