import { describe, expect, it } from "vitest";
import { orderBelongsToOpenCashShift } from "@/lib/openCashShift";

const openShift = { id: "shift-new", opened_at: "2026-05-18T10:00:00.000Z" };

describe("orderBelongsToOpenCashShift", () => {
  it("rechaza orden con cash_shift_id de turno cerrado", () => {
    expect(
      orderBelongsToOpenCashShift(
        {
          cash_shift_id: "shift-old",
          created_at: "2026-05-18T11:00:00.000Z",
        },
        openShift,
      ),
    ).toBe(false);
  });

  it("acepta orden del turno abierto cuando el ancla es posterior a opened_at", () => {
    expect(
      orderBelongsToOpenCashShift(
        {
          cash_shift_id: "shift-new",
          created_at: "2026-05-18T10:30:00.000Z",
        },
        openShift,
      ),
    ).toBe(true);
  });

  it("usa sent_to_kitchen_at como ancla si existe", () => {
    expect(
      orderBelongsToOpenCashShift(
        {
          cash_shift_id: null,
          created_at: "2026-05-18T09:00:00.000Z",
          sent_to_kitchen_at: "2026-05-18T10:30:00.000Z",
        },
        openShift,
      ),
    ).toBe(true);

    expect(
      orderBelongsToOpenCashShift(
        {
          cash_shift_id: null,
          created_at: "2026-05-18T11:00:00.000Z",
          sent_to_kitchen_at: "2026-05-18T09:00:00.000Z",
        },
        openShift,
      ),
    ).toBe(false);
  });
});
