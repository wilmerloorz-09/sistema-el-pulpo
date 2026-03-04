import { useQuery } from "@tanstack/react-query";
import { dbSelect } from "@/services/DatabaseService";
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
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  is_active: boolean;
}

interface Modifier {
  id: string;
  description: string;
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
        select: "id, description, subcategory_id, unit_price, price_mode",
        filters: [
          { column: "is_active", op: "eq", value: true },
          { column: "subcategory_id", op: "in", value: subIds },
        ],
        orderBy: { column: "description" },
      });
    },
    enabled: !!activeBranchId && !!subcategories.data,
  });

  const modifiers = useQuery({
    queryKey: ["menu-modifiers", activeBranchId],
    queryFn: () =>
      dbSelect<Modifier>("modifiers", {
        select: "id, description",
        branchId: activeBranchId,
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "description" },
      }),
    enabled: !!activeBranchId,
  });

  return {
    categories: categories.data ?? [],
    subcategories: subcategories.data ?? [],
    products: products.data ?? [],
    modifiers: modifiers.data ?? [],
    isLoading: categories.isLoading || subcategories.isLoading || products.isLoading || modifiers.isLoading,
  };
}
