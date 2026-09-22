import { describe, expect, it } from "vitest";
import { scopeReportToOpening, type CashShiftSnapshot } from "@/lib/cashReportUtils";

const baseShift: CashShiftSnapshot = {
  id: "shift-1",
  opened_at: "2026-09-21T18:00:00.000Z",
  caja_status: "OPEN",
  active_tables_count: 0,
  denoms: [
    {
      label: "1",
      value: 1,
      display_order: 1,
      denomination_type: "coin",
      qty_initial: 10,
      qty_current: 20,
    },
  ],
  openingHistory: [],
};

describe("scopeReportToOpening", () => {
  it("incluye cobros cuando la apertura sigue abierta (closed_at null → hasta ahora)", () => {
    const openedAt = "2026-09-21T18:00:00.000Z";
    const paymentAt = "2026-09-21T19:00:00.000Z";

    const scoped = scopeReportToOpening({
      branchName: "Test",
      shift: baseShift,
      opening: {
        opened_at: openedAt,
        closed_at: null,
        status: "abierta",
        cashier_name: "Cajero",
        initial_total: 10,
      },
      completedPayments: [
        {
          id: "pay-1",
          created_at: paymentAt,
          amount: 5,
          method_name: "Efectivo",
          status: "APPLIED",
        },
      ],
      movements: [],
      denominationSnapshot: baseShift.denoms,
    });

    expect(scoped.completedPayments).toHaveLength(1);
    expect(scoped.methodSummary).toEqual([
      expect.objectContaining({ methodName: "Efectivo", amount: 5, paymentCount: 1 }),
    ]);
  });

  it("no vacía cobros usando opened_at como tope cuando falta closed_at", () => {
    const openedAt = "2026-09-21T18:00:00.000Z";
    const scoped = scopeReportToOpening({
      branchName: "Test",
      shift: baseShift,
      opening: {
        opened_at: openedAt,
        closed_at: null,
        status: "abierta",
        cashier_name: "Cajero",
        initial_total: 10,
      },
      completedPayments: [
        {
          id: "pay-1",
          created_at: "2026-09-21T18:00:00.001Z",
          amount: 3,
          method_name: "Efectivo",
          status: "APPLIED",
        },
      ],
      movements: [],
      denominationSnapshot: baseShift.denoms,
    });

    expect(scoped.methodSummary[0]?.amount).toBe(3);
  });
});
