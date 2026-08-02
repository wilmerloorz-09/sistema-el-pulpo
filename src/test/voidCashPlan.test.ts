import { describe, expect, it } from "vitest";
import { buildVoidCashPlan, hasExactTenderStock } from "@/lib/voidCashPlan";

const denoms = [
  { denomination_id: "d20", label: "Billete $20,00", value: 20, qty_current: 1, display_order: 1 },
  { denomination_id: "d10", label: "Billete $10,00", value: 10, qty_current: 2, display_order: 2 },
  { denomination_id: "d5", label: "Billete $5,00", value: 5, qty_current: 3, display_order: 3 },
  { denomination_id: "d1", label: "Moneda $1,00", value: 1, qty_current: 10, display_order: 4 },
];

describe("buildVoidCashPlan", () => {
  it("con billete original en caja: entrega $20 y reingresa vuelto $10+$1", () => {
    const plan = buildVoidCashPlan({
      refundAmount: 9,
      paymentAmount: 9,
      receivedLines: [{ denomination_id: "d20", label: "Billete $20,00", value: 20, qty: 1 }],
      changeLines: [
        { denomination_id: "d10", label: "Billete $10,00", value: 10, qty: 1 },
        { denomination_id: "d1", label: "Moneda $1,00", value: 1, qty: 1 },
      ],
      shiftDenoms: denoms,
    });

    expect(plan.mode).toBe("exact_tender");
    expect(plan.outTotal).toBe(20);
    expect(plan.inTotal).toBe(11);
    expect(plan.netTotal).toBe(9);
    expect(plan.cashOut).toEqual([
      expect.objectContaining({ denomination_id: "d20", qty: 1, total: 20 }),
    ]);
    expect(plan.cashIn).toEqual([
      expect.objectContaining({ denomination_id: "d10", qty: 1, total: 10 }),
      expect.objectContaining({ denomination_id: "d1", qty: 1, total: 1 }),
    ]);
  });

  it("si no hay billete original en caja, usa greedy del monto anulado", () => {
    const plan = buildVoidCashPlan({
      refundAmount: 9,
      paymentAmount: 9,
      receivedLines: [{ denomination_id: "d20", label: "Billete $20,00", value: 20, qty: 1 }],
      changeLines: [
        { denomination_id: "d10", label: "Billete $10,00", value: 10, qty: 1 },
        { denomination_id: "d1", label: "Moneda $1,00", value: 1, qty: 1 },
      ],
      shiftDenoms: denoms.map((d) =>
        d.denomination_id === "d20" ? { ...d, qty_current: 0 } : d,
      ),
    });

    expect(plan.mode).toBe("greedy");
    expect(plan.cashIn).toHaveLength(0);
    expect(plan.netTotal).toBe(9);
    expect(plan.outTotal).toBe(9);
  });

  it("en anulación parcial no fuerza exact_tender", () => {
    const plan = buildVoidCashPlan({
      refundAmount: 5,
      paymentAmount: 9,
      receivedLines: [{ denomination_id: "d20", label: "Billete $20,00", value: 20, qty: 1 }],
      changeLines: [
        { denomination_id: "d10", label: "Billete $10,00", value: 10, qty: 1 },
        { denomination_id: "d1", label: "Moneda $1,00", value: 1, qty: 1 },
      ],
      shiftDenoms: denoms,
    });

    expect(plan.mode).toBe("greedy");
    expect(plan.netTotal).toBe(5);
  });
});

describe("hasExactTenderStock", () => {
  it("exige stock suficiente por denominacion", () => {
    expect(
      hasExactTenderStock(
        [{ denomination_id: "d20", label: "x", value: 20, qty: 1 }],
        denoms,
      ),
    ).toBe(true);
    expect(
      hasExactTenderStock(
        [{ denomination_id: "d20", label: "x", value: 20, qty: 2 }],
        denoms,
      ),
    ).toBe(false);
  });
});
