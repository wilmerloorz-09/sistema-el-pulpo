import { describe, expect, it } from "vitest";
import { ALL_CASHIERS, scopeCajaSummary, belongsToCashierRegisterActivity, resolveCashierOpening, type CajaRegisterDenomRow } from "@/lib/cajaSummaryScope";
import type { CashRegisterMovement, CashRegisterOpeningHistoryEntry } from "@/hooks/useCaja";

function denom(partial: Partial<CajaRegisterDenomRow> & Pick<CajaRegisterDenomRow, "id" | "denomination_id" | "cashier_id" | "opening_id">): CajaRegisterDenomRow {
  return {
    label: partial.label ?? "1",
    denomination_type: "bill",
    display_order: 1,
    value: partial.value ?? 1,
    image_url: null,
    qty_initial: partial.qty_initial ?? 0,
    qty_current: partial.qty_current ?? 0,
    ...partial,
  };
}

function opening(
  partial: Partial<CashRegisterOpeningHistoryEntry> & Pick<CashRegisterOpeningHistoryEntry, "id" | "cashier_id" | "status" | "opened_at">,
): CashRegisterOpeningHistoryEntry {
  return {
    shift_id: "shift-1",
    cashier_name: "Cajero",
    cashier_username: "cajero",
    closed_at: null,
    initial_total: 10,
    notes: null,
    anulada_por: null,
    anulada_por_nombre: null,
    anulada_por_username: null,
    anulada_at: null,
    motivo_anulacion: null,
    is_current: false,
    payment_count: 0,
    ...partial,
  };
}

function movement(partial: Pick<CashRegisterMovement, "id" | "recordedBy">): CashRegisterMovement {
  return {
    shiftId: "shift-1",
    branchId: "branch-1",
    movementType: "entrada",
    amount: 5,
    reason: "cambio",
    movementDetail: null,
    recordedByName: null,
    recordedByUsername: null,
    createdAt: "2026-08-12T12:00:00.000Z",
    ...partial,
  };
}

describe("scopeCajaSummary", () => {
  const openings: CashRegisterOpeningHistoryEntry[] = [
    opening({ id: "open-a", cashier_id: "cashier-a", status: "abierta", opened_at: "2026-08-12T11:00:00.000Z", initial_total: 20 }),
    opening({ id: "open-b", cashier_id: "cashier-b", status: "abierta", opened_at: "2026-08-12T11:05:00.000Z", initial_total: 30 }),
    opening({ id: "open-closed", cashier_id: "cashier-c", status: "cerrada", opened_at: "2026-08-12T10:00:00.000Z", closed_at: "2026-08-12T10:30:00.000Z" }),
  ];

  const denoms: CajaRegisterDenomRow[] = [
    denom({ id: "d1", denomination_id: "bill-1", cashier_id: "cashier-a", opening_id: "open-a", qty_initial: 10, qty_current: 15, value: 1 }),
    denom({ id: "d2", denomination_id: "bill-1", cashier_id: "cashier-b", opening_id: "open-b", qty_initial: 4, qty_current: 7, value: 1 }),
    denom({ id: "d3", denomination_id: "bill-1", cashier_id: "cashier-c", opening_id: "open-closed", qty_initial: 50, qty_current: 50, value: 1 }),
  ];

  const movements: CashRegisterMovement[] = [
    movement({ id: "m1", recordedBy: "cashier-a" }),
    movement({ id: "m2", recordedBy: "cashier-b" }),
  ];

  it("devuelve solo la caja del cajero seleccionado", () => {
    const scoped = scopeCajaSummary({
      denoms,
      openingHistory: openings,
      movements,
      cashierId: "cashier-a",
    });

    expect(scoped.denoms).toHaveLength(1);
    expect(scoped.denoms[0].qty_initial).toBe(10);
    expect(scoped.denoms[0].qty_current).toBe(15);
    expect(scoped.openingHistory.map((entry) => entry.cashier_id)).toEqual(["cashier-a"]);
    expect(scoped.openingHistory[0].is_current).toBe(true);
    expect(scoped.movements.map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("suma las cajas abiertas cuando se eligen todos los cajeros", () => {
    const scoped = scopeCajaSummary({
      denoms,
      openingHistory: openings,
      movements,
      cashierId: ALL_CASHIERS,
    });

    expect(scoped.denoms).toHaveLength(1);
    expect(scoped.denoms[0].qty_initial).toBe(14);
    expect(scoped.denoms[0].qty_current).toBe(22);
    expect(scoped.openingHistory).toHaveLength(3);
    expect(scoped.movements).toHaveLength(2);
  });

  it("usa la ultima apertura cerrada si el cajero ya no tiene caja abierta", () => {
    const scoped = scopeCajaSummary({
      denoms,
      openingHistory: openings,
      movements,
      cashierId: "cashier-c",
    });

    expect(scoped.denoms[0]?.qty_current).toBe(50);
    expect(scoped.openingHistory[0]?.is_current).toBe(false);
  });

  it("conserva denominaciones del cajero aunque no haya historial de aperturas", () => {
    const scoped = scopeCajaSummary({
      denoms: [denoms[0]],
      openingHistory: [],
      movements,
      cashierId: "cashier-a",
    });

    expect(scoped.denoms[0]?.qty_current).toBe(15);
    expect(scoped.cashierGroups).toHaveLength(1);
    expect(scoped.cashierGroups[0]?.cashierId).toBe("cashier-a");
  });

  it("agrupa el desglose por cajero cuando se eligen todos", () => {
    const scoped = scopeCajaSummary({
      denoms,
      openingHistory: openings,
      movements,
      cashierId: ALL_CASHIERS,
    });

    expect(scoped.cashierGroups).toHaveLength(2);
    expect(scoped.cashierGroups.map((group) => group.cashierId).sort()).toEqual(["cashier-a", "cashier-b"]);
  });

  it("incluye movimientos del cajero anterior tras reemplazo en la misma apertura", () => {
    const transferredOpening = opening({
      id: "open-b",
      cashier_id: "cashier-b",
      status: "abierta",
      opened_at: "2026-08-12T11:00:00.000Z",
      initial_total: 20,
    });
    const scoped = scopeCajaSummary({
      denoms: [denoms[0]],
      openingHistory: [transferredOpening],
      movements: [
        movement({ id: "m-will", recordedBy: "cashier-a", createdAt: "2026-08-12T11:10:00.000Z" }),
        movement({ id: "m-ketty", recordedBy: "cashier-b", createdAt: "2026-08-12T11:20:00.000Z" }),
      ],
      cashierId: "cashier-b",
    });

    expect(scoped.movements.map((entry) => entry.id).sort()).toEqual(["m-ketty", "m-will"]);
  });
});

describe("belongsToCashierRegisterActivity", () => {
  const transferredOpening = opening({
    id: "open-b",
    cashier_id: "cashier-b",
    status: "abierta",
    opened_at: "2026-08-12T11:00:00.000Z",
  });

  it("incluye cobros del cajero saliente cuando ya no tiene caja abierta", () => {
    expect(
      belongsToCashierRegisterActivity({
        actorId: "cashier-a",
        activityAt: "2026-08-12T11:10:00.000Z",
        cashierId: "cashier-b",
        opening: transferredOpening,
        openingHistory: [transferredOpening],
      }),
    ).toBe(true);
  });

  it("excluye cobros de otro cajero que sigue con caja abierta distinta", () => {
    const openings = [
      transferredOpening,
      opening({
        id: "open-a",
        cashier_id: "cashier-a",
        status: "abierta",
        opened_at: "2026-08-12T11:05:00.000Z",
      }),
    ];
    expect(
      belongsToCashierRegisterActivity({
        actorId: "cashier-a",
        activityAt: "2026-08-12T11:10:00.000Z",
        cashierId: "cashier-b",
        opening: transferredOpening,
        openingHistory: openings,
      }),
    ).toBe(false);
  });

  it("excluye cobros de un cajero cuya caja ya cerró pero cubría ese momento", () => {
    const elyOpening = opening({
      id: "open-ely",
      cashier_id: "ely",
      status: "abierta",
      opened_at: "2026-09-02T11:48:00.000Z",
    });
    const jhonOpening = opening({
      id: "open-jhon",
      cashier_id: "jhon",
      status: "cerrada",
      opened_at: "2026-09-02T11:48:00.000Z",
      closed_at: "2026-09-02T18:51:00.000Z",
    });
    expect(
      belongsToCashierRegisterActivity({
        actorId: "jhon",
        activityAt: "2026-09-02T15:00:00.000Z",
        cashierId: "ely",
        opening: elyOpening,
        openingHistory: [elyOpening, jhonOpening],
      }),
    ).toBe(false);
  });

  it("incluye cobros del cajero saliente posteriores al cierre de su propia caja", () => {
    const bOpening = opening({
      id: "open-b",
      cashier_id: "cashier-b",
      status: "abierta",
      opened_at: "2026-08-12T11:00:00.000Z",
    });
    const aClosed = opening({
      id: "open-a",
      cashier_id: "cashier-a",
      status: "cerrada",
      opened_at: "2026-08-12T10:00:00.000Z",
      closed_at: "2026-08-12T11:05:00.000Z",
    });
    expect(
      belongsToCashierRegisterActivity({
        actorId: "cashier-a",
        activityAt: "2026-08-12T11:10:00.000Z",
        cashierId: "cashier-b",
        opening: bOpening,
        openingHistory: [bOpening, aClosed],
      }),
    ).toBe(true);
  });

  it("incluye cobros del cajero saliente anteriores a su nueva caja abierta", () => {
    const openings = [
      transferredOpening,
      opening({
        id: "open-a",
        cashier_id: "cashier-a",
        status: "abierta",
        opened_at: "2026-08-12T11:15:00.000Z",
      }),
    ];
    expect(
      belongsToCashierRegisterActivity({
        actorId: "cashier-a",
        activityAt: "2026-08-12T11:10:00.000Z",
        cashierId: "cashier-b",
        opening: transferredOpening,
        openingHistory: openings,
      }),
    ).toBe(true);
  });
});
