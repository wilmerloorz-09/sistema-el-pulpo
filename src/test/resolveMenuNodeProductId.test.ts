import { describe, expect, it } from "vitest";
import { resolveMenuNodeProductId } from "@/lib/inventarioMenuData";

describe("resolveMenuNodeProductId", () => {
  it("prioriza producto_global_id sobre legacy y nodo", () => {
    expect(
      resolveMenuNodeProductId({
        node_type: "product",
        id: "node-1",
        legacy_product_id: "legacy-1",
        producto_global_id: "global-1",
      }),
    ).toBe("global-1");
  });

  it("usa legacy_product_id cuando no hay global (TABLE con ids distintos)", () => {
    expect(
      resolveMenuNodeProductId({
        node_type: "product",
        id: "node-table",
        legacy_product_id: "legacy-product",
        producto_global_id: null,
      }),
    ).toBe("legacy-product");
  });

  it("no usa el id del nodo si hay legacy (evita RPC producto inexistente)", () => {
    const id = resolveMenuNodeProductId({
      node_type: "product",
      id: "1d9cdd83-9fa9-4371-816a-8fcbcbf1851d",
      legacy_product_id: "7fc1425c-8555-4ee6-a6ba-3a69c5391e7e",
    });
    expect(id).toBe("7fc1425c-8555-4ee6-a6ba-3a69c5391e7e");
    expect(id).not.toBe("1d9cdd83-9fa9-4371-816a-8fcbcbf1851d");
  });
});
