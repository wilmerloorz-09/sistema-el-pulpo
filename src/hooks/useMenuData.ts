import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";
import type { MenuScope } from "@/hooks/useMenuTree";

interface Category {
  id: string;
  description: string;
  display_order: number;
}

interface Subcategory {
  id: string;
  description: string;
  category_id: string;
  display_order: number;
}

interface Product {
  id: string;
  menu_node_id: string;
  description: string;
  subcategory_id: string;
  display_order: number;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  is_active: boolean;
  icon?: string | null;
  image_url?: string | null;
}

interface MenuNodeRef {
  id: string;
  parent_id: string | null;
  node_type: "category" | "product";
  manual_price_enabled?: boolean | null;
}

interface MenuNodeModifierLink {
  node_id: string;
  modifier_id: string;
  display_order: number | null;
  is_active: boolean;
}

interface Modifier {
  id: string;
  description: string;
  node_id: string;
  display_order: number;
}

export function useMenuData(menuScope: MenuScope = "TABLE") {
  const { activeBranchId } = useBranch();

  const categories = useQuery({
    queryKey: ["menu-categories", activeBranchId],
    queryFn: () =>
      dbSelect<Category>("categories", {
        select: "id, description, display_order",
        branchId: activeBranchId,
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "display_order" },
      }),
    enabled: !!activeBranchId,
  });

  const subcategories = useQuery({
    queryKey: ["menu-subcategories", activeBranchId],
    queryFn: () => {
      const catIds = categories.data?.map((c) => c.id) ?? [];
      if (catIds.length === 0) return Promise.resolve([]);
      return dbSelect<Subcategory>("subcategories", {
        select: "id, description, category_id, display_order",
        filters: [
          { column: "is_active", op: "eq", value: true },
          { column: "category_id", op: "in", value: catIds },
        ],
        orderBy: { column: "display_order" },
      });
    },
    enabled: !!activeBranchId && !!categories.data,
  });

  const products = useQuery({
    queryKey: ["menu-products", activeBranchId, menuScope],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const productNodes = await dbSelect<any>("menu_nodes", {
        select: "id, legacy_product_id, name, price, display_order, is_active, icon, image_url, parent_id",
        filters: [
          { column: "branch_id", op: "eq", value: activeBranchId },
          { column: "menu_scope", op: "eq", value: menuScope },
          { column: "node_type", op: "eq", value: "product" },
          { column: "is_active", op: "eq", value: true }
        ]
      });

      const menuNodes = await dbSelect<any>("menu_nodes", {
        select: "id, parent_id, node_type, manual_price_enabled",
        filters: [
          { column: "branch_id", op: "eq", value: activeBranchId },
          { column: "menu_scope", op: "eq", value: menuScope },
          { column: "is_active", op: "eq", value: true }
        ]
      });

      const nodeRows = (productNodes ?? []) as Array<{
        id: string;
        legacy_product_id?: string | null;
        name: string;
        price?: number | null;
        display_order?: number | null;
        is_active?: boolean | null;
        parent_id?: string | null;
        icon?: string | null;
        image_url?: string | null;
      }>;
      const menuNodeMap = new Map(((menuNodes ?? []) as unknown as MenuNodeRef[]).map((node) => [node.id, node]));

      const inheritsManualPrice = (startParentId: string | null | undefined) => {
        let currentId = startParentId ?? null;
        while (currentId) {
          const currentNode = menuNodeMap.get(currentId);
          if (!currentNode) break;
          if (currentNode.node_type === "category" && Boolean(currentNode.manual_price_enabled)) {
            return true;
          }
          currentId = currentNode.parent_id ?? null;
        }
        return false;
      };
      const productIdSet = new Set<string>(
        nodeRows
          .map((node) => node.legacy_product_id ?? node.id)
          .filter(Boolean)
      );
      const productIds = Array.from(productIdSet);
      if (productIds.length === 0) return [];

      const legacyProducts = await dbSelect<Omit<Product, "menu_node_id">>("products", {
        select: "id, description, subcategory_id, display_order, unit_price, price_mode",
        filters: [
          { column: "id", op: "in", value: productIds },
        ],
        orderBy: { column: "display_order" },
      });

      const legacyProductsById = new Map(legacyProducts.map((product) => [product.id, product]));

      return nodeRows.flatMap((node) => {
        const legacyId = node.legacy_product_id ?? node.id;
        const legacyProduct = legacyProductsById.get(legacyId);
        if (!legacyProduct) return [];

        return [{
          ...legacyProduct,
          id: legacyId,
          menu_node_id: node.id,
          description: node.name || legacyProduct.description,
          display_order: Number(node.display_order ?? legacyProduct.display_order ?? 0),
          unit_price: node.price == null ? legacyProduct.unit_price : Number(node.price),
          price_mode: inheritsManualPrice(node.parent_id) ? "MANUAL" : legacyProduct.price_mode,
          is_active: Boolean(node.is_active ?? true),
          icon: node.icon ?? null,
          image_url: node.image_url ?? null,
        }];
      });
    },
    enabled: !!activeBranchId,
  });

  const modifiers = useQuery({
    queryKey: ["menu-modifiers", activeBranchId, menuScope, products.data?.length ?? 0],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const activeProducts = products.data ?? [];
      if (activeProducts.length === 0) return [];

      const menuNodes = await dbSelect<any>("menu_nodes", {
        select: "id, parent_id, node_type",
        filters: [
          { column: "branch_id", op: "eq", value: activeBranchId },
          { column: "menu_scope", op: "eq", value: menuScope },
          { column: "is_active", op: "eq", value: true }
        ]
      });

      const nodeRows = (menuNodes ?? []) as unknown as MenuNodeRef[];
      if (nodeRows.length === 0) return [];

      const nodeIds = nodeRows.map((node) => node.id);
      const links = await dbSelect<any>("menu_node_modifiers", {
        select: "node_id, modifier_id, display_order, is_active",
        filters: [
          { column: "node_id", op: "in", value: nodeIds },
          { column: "is_active", op: "eq", value: true }
        ],
        orderBy: { column: "display_order", ascending: true }
      });

      const linkRows = (links ?? []) as unknown as MenuNodeModifierLink[];
      const modifierIdSet = new Set<string>(linkRows.map((link) => link.modifier_id).filter(Boolean));
      const modifierIds = Array.from(modifierIdSet);
      if (modifierIds.length === 0) return [];

      const mods = await dbSelect<{ id: string; description: string }>("modifiers", {
        select: "id, description",
        branchId: activeBranchId,
        filters: [
          { column: "is_active", op: "eq", value: true },
          { column: "id", op: "in", value: modifierIds },
        ],
        orderBy: { column: "description" },
      });

      const nodesById = new Map(nodeRows.map((node) => [node.id, node]));
      const linksByNode = new Map<string, MenuNodeModifierLink[]>();
      for (const link of linkRows) {
        const bucket = linksByNode.get(link.node_id) ?? [];
        bucket.push(link);
        linksByNode.set(link.node_id, bucket);
      }
      const modsById = Object.fromEntries(mods.map((mod) => [mod.id, mod]));

      return activeProducts.flatMap((product) => {
        const startNodeId = nodesById.has(product.menu_node_id) ? product.menu_node_id : product.subcategory_id;
        const seenModifierIds = new Set<string>();
        const effectiveModifiers: Modifier[] = [];

        let currentNodeId: string | null = startNodeId;
        while (currentNodeId) {
          const currentNode = nodesById.get(currentNodeId);
          if (!currentNode) break;

          const nodeLinks = linksByNode.get(currentNode.id) ?? [];
          for (const link of nodeLinks) {
            if (seenModifierIds.has(link.modifier_id)) continue;
            const mod = modsById[link.modifier_id];
            if (!mod) continue;

            effectiveModifiers.push({
              id: mod.id,
              description: mod.description,
              node_id: product.menu_node_id,
              display_order: Number(link.display_order ?? 0),
            });
            seenModifierIds.add(link.modifier_id);
          }

          currentNodeId = currentNode.parent_id ?? null;
        }

        return effectiveModifiers;
      });
    },
    enabled: !!activeBranchId && !!products.data,
  });

  return {
    categories: categories.data ?? [],
    subcategories: subcategories.data ?? [],
    products: products.data ?? [],
    modifiers: modifiers.data ?? [],
    isLoading: categories.isLoading || subcategories.isLoading || products.isLoading || modifiers.isLoading,
  };
}
