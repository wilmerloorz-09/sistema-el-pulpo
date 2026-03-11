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

interface Modifier {
  id: string;
  description: string;
  subcategory_id: string;
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
    queryKey: ["menu-modifiers", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const subIds = subcategories.data?.map((s) => s.id) ?? [];
      if (subIds.length === 0) return [];

      const { data: links, error: linksError } = await supabase
        .from("subcategory_modifiers" as never)
        .select("subcategory_id, modifier_id, display_order, is_active")
        .in("subcategory_id", subIds)
        .eq("is_active", true)
        .order("display_order", { ascending: true });

      if (linksError) throw linksError;

      const modifierIds = [...new Set((links ?? []).map((link: any) => link.modifier_id).filter(Boolean))] as string[];
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

      const modsById = Object.fromEntries(mods.map((mod) => [mod.id, mod]));

      return (links ?? [])
        .map((link: any) => {
          const mod = modsById[link.modifier_id];
          if (!mod) return null;
          return {
            id: mod.id,
            description: mod.description,
            subcategory_id: String(link.subcategory_id),
            display_order: Number(link.display_order ?? 0),
          } as Modifier;
        })
        .filter(Boolean) as Modifier[];
    },
    enabled: !!activeBranchId && !!subcategories.data,
  });

  return {
    categories: categories.data ?? [],
    subcategories: subcategories.data ?? [],
    products: products.data ?? [],
    modifiers: modifiers.data ?? [],
    isLoading: categories.isLoading || subcategories.isLoading || products.isLoading || modifiers.isLoading,
  };
}
