import { describe, expect, it } from "vitest";
import {
  buildPlatosProductIdSet,
  isPlatosOrderItem,
  isPlatosRootCategoryName,
} from "@/lib/menuPlatosCategory";
import type { MenuNode } from "@/hooks/useMenuTree";

function node(partial: Partial<MenuNode> & Pick<MenuNode, "id" | "node_type" | "name">): MenuNode {
  return {
    branch_id: "b1",
    menu_scope: "TABLE",
    parent_id: null,
    depth: 0,
    display_order: 1,
    is_active: true,
    ...partial,
  };
}

describe("menuPlatosCategory", () => {
  it("detects PLATOS root category names", () => {
    expect(isPlatosRootCategoryName("PLATOS")).toBe(true);
    expect(isPlatosRootCategoryName("Platos fuertes")).toBe(true);
    expect(isPlatosRootCategoryName("BEBIDAS")).toBe(false);
  });

  it("builds product id set for PLATOS menu products", () => {
    const nodes: MenuNode[] = [
      node({ id: "cat-platos", node_type: "category", name: "PLATOS", depth: 0, parent_id: null }),
      node({
        id: "prod-1",
        node_type: "product",
        name: "Seco",
        parent_id: "cat-platos",
        depth: 1,
        legacy_product_id: "p-plato-1",
      }),
      node({ id: "cat-beb", node_type: "category", name: "BEBIDAS", depth: 0, parent_id: null }),
      node({
        id: "prod-2",
        node_type: "product",
        name: "Cola",
        parent_id: "cat-beb",
        depth: 1,
        legacy_product_id: "p-beb-1",
      }),
    ];

    const platosIds = buildPlatosProductIdSet(nodes);
    expect(platosIds.has("p-plato-1")).toBe(true);
    expect(platosIds.has("p-beb-1")).toBe(false);
    expect(isPlatosOrderItem("p-plato-1", platosIds)).toBe(true);
    expect(isPlatosOrderItem("p-beb-1", platosIds)).toBe(false);
  });
});
