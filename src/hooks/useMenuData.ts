import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  const categories = useQuery({
    queryKey: ["menu-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, description, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data as Category[];
    },
  });

  const subcategories = useQuery({
    queryKey: ["menu-subcategories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcategories")
        .select("id, description, category_id, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data as Subcategory[];
    },
  });

  const products = useQuery({
    queryKey: ["menu-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, description, subcategory_id, unit_price, price_mode")
        .eq("is_active", true)
        .order("description");
      if (error) throw error;
      return data as Product[];
    },
  });

  const modifiers = useQuery({
    queryKey: ["menu-modifiers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modifiers")
        .select("id, description")
        .eq("is_active", true)
        .order("description");
      if (error) throw error;
      return data as Modifier[];
    },
  });

  return {
    categories: categories.data ?? [],
    subcategories: subcategories.data ?? [],
    products: products.data ?? [],
    modifiers: modifiers.data ?? [],
    isLoading: categories.isLoading || subcategories.isLoading || products.isLoading || modifiers.isLoading,
  };
}
