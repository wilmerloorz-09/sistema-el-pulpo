import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, description, display_order")
        .eq("is_active", true)
        .eq("branch_id", activeBranchId!)
        .order("display_order");
      if (error) throw error;
      return data as Category[];
    },
    enabled: !!activeBranchId,
  });

  const subcategories = useQuery({
    queryKey: ["menu-subcategories", activeBranchId],
    queryFn: async () => {
      // Get category IDs for this branch first
      const catIds = categories.data?.map(c => c.id) ?? [];
      if (catIds.length === 0) return [];
      const { data, error } = await supabase
        .from("subcategories")
        .select("id, description, category_id, display_order")
        .eq("is_active", true)
        .in("category_id", catIds)
        .order("display_order");
      if (error) throw error;
      return data as Subcategory[];
    },
    enabled: !!activeBranchId && !!categories.data,
  });

  const products = useQuery({
    queryKey: ["menu-products", activeBranchId],
    queryFn: async () => {
      const subIds = subcategories.data?.map(s => s.id) ?? [];
      if (subIds.length === 0) return [];
      const { data, error } = await supabase
        .from("products")
        .select("id, description, subcategory_id, unit_price, price_mode")
        .eq("is_active", true)
        .in("subcategory_id", subIds)
        .order("description");
      if (error) throw error;
      return data as Product[];
    },
    enabled: !!activeBranchId && !!subcategories.data,
  });

  const modifiers = useQuery({
    queryKey: ["menu-modifiers", activeBranchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modifiers")
        .select("id, description")
        .eq("is_active", true)
        .eq("branch_id", activeBranchId!)
        .order("description");
      if (error) throw error;
      return data as Modifier[];
    },
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
