import { useQuery } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useBranch } from "@/contexts/BranchContext";

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
  description: string;
  subcategory_id: string;
  display_order: number;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  is_active: boolean;
}

interface MenuNodeRef {
  id: string;
  parent_id: string | null;
  node_type: "category" | "product";
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

export function useMenuData() {
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
    queryKey: ["menu-products", activeBranchId],
    queryFn: () => {
      const subIds = subcategories.data?.map((s) => s.id) ?? [];
      if (subIds.length === 0) return Promise.resolve([]);
      return dbSelect<Product>("products", {
        select: "id, description, subcategory_id, display_order, unit_price, price_mode",
        filters: [
          { column: "is_active", op: "eq", value: true },
          { column: "subcategory_id", op: "in", value: subIds },
        ],
        orderBy: { column: "display_order" },
      });
    },
    enabled: !!activeBranchId && !!subcategories.data,
  });

  const modifiers = useQuery({
    queryKey: ["menu-modifiers", activeBranchId, products.data?.length ?? 0],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const activeProducts = products.data ?? [];
      if (activeProducts.length === 0) return [];

      const { data: menuNodes, error: menuNodesError } = await supabase
        .from("menu_nodes" as never)
        .select("id, parent_id, node_type")
        .eq("branch_id", activeBranchId)
        .eq("is_active", true);

      if (menuNodesError) throw menuNodesError;

      const nodeRows = (menuNodes ?? []) as unknown as MenuNodeRef[];
      if (nodeRows.length === 0) return [];

      const nodeIds = nodeRows.map((node) => node.id);
      const { data: links, error: linksError } = await supabase
        .from("menu_node_modifiers" as never)
        .select("node_id, modifier_id, display_order, is_active")
        .in("node_id", nodeIds)
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (linksError) throw linksError;

      const linkRows = (links ?? []) as unknown as MenuNodeModifierLink[];
      const modifierIds = [...new Set(linkRows.map((link) => link.modifier_id).filter(Boolean))] as string[];
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
        const startNodeId = nodesById.has(product.id) ? product.id : product.subcategory_id;
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
              node_id: product.id,
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
