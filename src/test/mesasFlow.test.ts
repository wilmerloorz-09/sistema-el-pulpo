import { describe, expect, it } from "vitest";
import { getOrderBoundTableId, siblingPlaceholdersFromTableOverview } from "@/lib/mesasFlow";

describe("getOrderBoundTableId", () => {
  it("usa table_id en orden de mesa", () => {
    expect(
      getOrderBoundTableId({
        table_id: "mesa-1",
        is_special: false,
        special_origin_table_id: null,
      }),
    ).toBe("mesa-1");
  });

  it("usa table_id en especial mixta que sigue en mesa", () => {
    expect(
      getOrderBoundTableId({
        table_id: "mesa-1",
        is_special: true,
        special_origin_table_id: "mesa-1",
      }),
    ).toBe("mesa-1");
  });

  it("usa la mesa de origen en especial completa", () => {
    expect(
      getOrderBoundTableId({
        table_id: null,
        is_special: true,
        special_origin_table_id: "mesa-1",
      }),
    ).toBe("mesa-1");
  });

  it("devuelve null si la especial no tiene origen", () => {
    expect(
      getOrderBoundTableId({
        table_id: null,
        is_special: true,
        special_origin_table_id: null,
      }),
    ).toBeNull();
  });
});

describe("siblingPlaceholdersFromTableOverview", () => {
  it("incluye especial con saldo 0 y la orden activa", () => {
    const rows = siblingPlaceholdersFromTableOverview({
      activeOrderId: "normal-1",
      splitTotals: [
        { splitId: "esp-1", splitCode: "Especial", totalDue: 0, isSpecial: true },
        { splitId: "normal-1", splitCode: "Orden 1", totalDue: 5 },
      ],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["esp-1", "normal-1"]);
    expect(rows.find((r) => r.id === "esp-1")?.is_special).toBe(true);
  });
});
