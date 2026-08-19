import { describe, expect, it } from "vitest";
import { getOrderBoundTableId } from "@/lib/mesasFlow";

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
