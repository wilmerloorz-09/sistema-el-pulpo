import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MenuNode } from "@/hooks/useMenuTree";

export type FrequentProductContext = "MESA" | "TAKEOUT" | "EXPRESS" | "EXTRA";

export const FREQUENT_PRODUCT_CONTEXTS: Array<{ value: FrequentProductContext; label: string }> = [
  { value: "MESA", label: "Mesa" },
  { value: "TAKEOUT", label: "Para llevar" },
  { value: "EXPRESS", label: "Express" },
  { value: "EXTRA", label: "Extra" },
];

export interface FrequentProductRow {
  id: string;
  branch_id: string;
  context: FrequentProductContext;
  menu_node_id: string;
  display_order: number;
  menu_node: MenuNode | null;
}

export function getFrequentProductsQueryKey(
  branchId: string | null | undefined,
  context: FrequentProductContext,
) {
  return ["frequent-products", branchId ?? null, context] as const;
}

export async function fetchFrequentProducts(
  branchId: string,
  context: FrequentProductContext,
): Promise<FrequentProductRow[]> {
  const { data, error } = await supabase
    .from("extra_frequent_products" as any)
    .select("id, branch_id, context, menu_node_id, display_order, menu_nodes(*)")
    .eq("branch_id", branchId)
    .eq("context", context)
    .order("display_order", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    branch_id: row.branch_id,
    context: row.context as FrequentProductContext,
    menu_node_id: row.menu_node_id,
    display_order: row.display_order,
    menu_node: (row.menu_nodes ?? null) as MenuNode | null,
  }));
}

const DISPLAY_ORDER_STAGING_OFFSET = 100_000;

async function applyDisplayOrders(branchId: string, context: FrequentProductContext, orderedIds: string[]) {
  for (let index = 0; index < orderedIds.length; index++) {
    const { error } = await supabase
      .from("extra_frequent_products" as any)
      .update({ display_order: DISPLAY_ORDER_STAGING_OFFSET + index + 1 })
      .eq("id", orderedIds[index])
      .eq("branch_id", branchId)
      .eq("context", context);
    if (error) throw error;
  }

  for (let index = 0; index < orderedIds.length; index++) {
    const { error } = await supabase
      .from("extra_frequent_products" as any)
      .update({ display_order: index + 1 })
      .eq("id", orderedIds[index])
      .eq("branch_id", branchId)
      .eq("context", context);
    if (error) throw error;
  }
}

export function useFrequentProducts(
  branchId: string | null | undefined,
  context: FrequentProductContext,
) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: getFrequentProductsQueryKey(branchId, context),
    queryFn: () => fetchFrequentProducts(branchId!, context),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getFrequentProductsQueryKey(branchId, context) });
  };

  const addProduct = useMutation({
    mutationFn: async (menuNodeId: string) => {
      if (!branchId) throw new Error("No hay sucursal activa");

      const existing = await fetchFrequentProducts(branchId, context);
      if (existing.some((row) => row.menu_node_id === menuNodeId)) {
        throw new Error("ALREADY_IN_LIST");
      }

      const nextOrder =
        existing.length === 0
          ? 1
          : Math.max(...existing.map((row) => Number(row.display_order) || 0)) + 1;

      const { error } = await supabase.from("extra_frequent_products" as any).insert({
        branch_id: branchId,
        context,
        menu_node_id: menuNodeId,
        display_order: nextOrder,
      });

      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeProduct = useMutation({
    mutationFn: async (rowId: string) => {
      if (!branchId) throw new Error("No hay sucursal activa");

      const { error: deleteError } = await supabase
        .from("extra_frequent_products" as any)
        .delete()
        .eq("id", rowId)
        .eq("branch_id", branchId)
        .eq("context", context);

      if (deleteError) throw deleteError;

      const remaining = await fetchFrequentProducts(branchId, context);
      await applyDisplayOrders(
        branchId,
        context,
        remaining.map((row) => row.id),
      );
    },
    onSuccess: invalidate,
  });

  const reorderProducts = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      if (!branchId) throw new Error("No hay sucursal activa");
      await applyDisplayOrders(branchId, context, orderedIds);
    },
    onSuccess: invalidate,
  });

  return {
    products: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    addProduct,
    removeProduct,
    reorderProducts,
  };
}
