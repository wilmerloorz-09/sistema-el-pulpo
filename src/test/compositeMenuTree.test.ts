import { describe, expect, it } from "vitest";
import { buildCompositeMenuNodes } from "@/lib/compositeMenuTree";
import type { MenuNode } from "@/hooks/useMenuTree";

function category(id: string, name: string, scope: MenuNode["menu_scope"], order: number): MenuNode {
  return {
    id,
    branch_id: "branch-1",
    menu_scope: scope,
    parent_id: null,
    name,
    node_type: "category",
    depth: 1,
    display_order: order,
    is_active: true,
  };
}

function product(id: string, parentId: string, scope: MenuNode["menu_scope"], name: string): MenuNode {
  return {
    id,
    branch_id: "branch-1",
    menu_scope: scope,
    parent_id: parentId,
    name,
    node_type: "product",
    depth: 2,
    display_order: 1,
    is_active: true,
  };
}

describe("buildCompositeMenuNodes", () => {
  it("no duplica categorias raiz que ya existen en Con envase", () => {
    const takeoutNodes = [
      category("t-platos", "PLATOS", "TAKEOUT", 1),
      category("t-bebidas", "BEBIDAS", "TAKEOUT", 2),
      category("t-varios", "VARIOS", "TAKEOUT", 3),
      product("t-prod", "t-platos", "TAKEOUT", "Encebollado"),
    ];
    const tableNodes = [
      category("m-platos", "PLATOS", "TABLE", 1),
      category("m-bebidas", "BEBIDAS", "TABLE", 2),
      category("m-varios", "VARIOS", "TABLE", 3),
      product("m-prod", "m-platos", "TABLE", "Arroz"),
    ];

    const merged = buildCompositeMenuNodes(takeoutNodes, tableNodes);
    const rootNames = merged
      .filter((node) => node.parent_id === null && node.node_type === "category")
      .map((node) => node.name);

    expect(rootNames).toEqual(["PLATOS", "BEBIDAS", "VARIOS"]);
    expect(merged).toHaveLength(takeoutNodes.length);
  });

  it("anexa categorias de mesa que faltan en Con envase", () => {
    const takeoutNodes = [
      category("t-platos", "PLATOS", "TAKEOUT", 1),
      product("t-prod", "t-platos", "TAKEOUT", "Encebollado"),
    ];
    const tableNodes = [
      category("m-platos", "PLATOS", "TABLE", 1),
      category("m-bebidas", "BEBIDAS", "TABLE", 2),
      product("m-bebida", "m-bebidas", "TABLE", "Jugo"),
    ];

    const merged = buildCompositeMenuNodes(takeoutNodes, tableNodes);
    const rootNames = merged
      .filter((node) => node.parent_id === null && node.node_type === "category")
      .map((node) => node.name);

    expect(rootNames).toEqual(["PLATOS", "BEBIDAS"]);
    expect(merged.some((node) => node.id === "m-bebidas")).toBe(true);
    expect(merged.some((node) => node.id === "m-bebida")).toBe(true);
  });
});
