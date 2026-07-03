import { fetchMenuTreeNodes, type MenuNode, type MenuScope } from "@/hooks/useMenuTree";
import { supabase } from "@/integrations/supabase/client";

export function normalizeMenuCategoryLabel(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export function isPlatosRootCategoryName(value?: string | null) {
  return normalizeMenuCategoryLabel(value).includes("PLATOS");
}

export function resolveRootCategoryName(node: MenuNode, nodesById: Map<string, MenuNode>) {
  let parentId = node.parent_id;
  let rootCategoryName: string | null = null;

  while (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent) break;
    if (parent.node_type === "category") {
      rootCategoryName = parent.name;
      if (parent.depth === 0 || !parent.parent_id) return parent.name;
    }
    parentId = parent.parent_id;
  }

  return rootCategoryName;
}

/** Product IDs (`products.id`) whose menu node belongs to a root category named PLATOS. */
export function buildPlatosProductIdSet(menuNodes: MenuNode[]) {
  const nodesById = new Map(menuNodes.map((node) => [node.id, node]));
  const productIds = new Set<string>();

  for (const node of menuNodes) {
    if (node.node_type !== "product") continue;
    const legacyProductId = node.legacy_product_id?.trim();
    if (!legacyProductId) continue;
    const rootName = resolveRootCategoryName(node, nodesById);
    if (isPlatosRootCategoryName(rootName)) {
      productIds.add(legacyProductId);
    }
  }

  return productIds;
}

const SERVIR_MENU_SCOPES: MenuScope[] = ["TABLE", "TAKEOUT", "BULK"];

export async function fetchPlatosProductIdsForBranch(branchId: string) {
  const scopeNodes = await Promise.all(
    SERVIR_MENU_SCOPES.map((menuScope) =>
      fetchMenuTreeNodes({ branchId, menuScope, includeInactive: false }),
    ),
  );
  
  const productIds = buildPlatosProductIdSet(scopeNodes.flat());

  // Consultar productos no pertenecientes a la categoría platos pero forzados a Módulo Servir
  const { data: forcedProducts } = await supabase
    .from("products")
    .select("id")
    .eq("force_servir_module", true);

  if (forcedProducts) {
    for (const p of forcedProducts) {
      productIds.add(p.id);
    }
  }

  return productIds;
}

export function isPlatosOrderItem(
  productId: string | null | undefined,
  platosProductIds: Set<string>,
) {
  if (!productId) return false;
  return platosProductIds.has(productId);
}
