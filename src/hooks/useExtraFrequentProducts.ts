import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MenuNode } from "@/hooks/useMenuTree";

export interface ExtraFrequentProductRow {
  id: string;
  branch_id: string;
  menu_node_id: string;
  display_order: number;
  menu_node: MenuNode | null;
}

export function getExtraFrequentProductsQueryKey(branchId: string | null | undefined) {
  return ["extra-frequent-products", branchId ?? null] as const;
}

export async function fetchExtraFrequentProducts(branchId: string): Promise<ExtraFrequentProductRow[]> {
  const { data, error } = await supabase
    .from("extra_frequent_products" as any)
    .select("id, branch_id, menu_node_id, display_order, menu_nodes(*)")
    .eq("branch_id", branchId)
    .order("display_order", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    branch_id: row.branch_id,
    menu_node_id: row.menu_node_id,
    display_order: row.display_order,
    menu_node: (row.menu_nodes ?? null) as MenuNode | null,
  }));
}

async function applyDisplayOrders(branchId: string, orderedIds: string[]) {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("extra_frequent_products" as any)
        .update({ display_order: -(index + 1) })
        .eq("id", id)
        .eq("branch_id", branchId),
    ),
  );

  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("extra_frequent_products" as any)
        .update({ display_order: index + 1 })
        .eq("id", id)
        .eq("branch_id", branchId),
    ),
  );
}

export function useExtraFrequentProducts(branchId: string | null | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: getExtraFrequentProductsQueryKey(branchId),
    queryFn: () => fetchExtraFrequentProducts(branchId!),
    enabled: !!branchId,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getExtraFrequentProductsQueryKey(branchId) });
  };

  const addProduct = useMutation({
    mutationFn: async (menuNodeId: string) => {
      if (!branchId) throw new Error("No hay sucursal activa");

      const existing = await fetchExtraFrequentProducts(branchId);
      if (existing.length >= 10) {
        throw new Error("Ya tienes 10 productos. Elimina uno para agregar otro.");
      }
      if (existing.some((row) => row.menu_node_id === menuNodeId)) {
        throw new Error("ALREADY_IN_LIST");
      }

      const nextOrder =
        existing.length === 0
          ? 1
          : Math.max(...existing.map((row) => Number(row.display_order) || 0)) + 1;

      const { error } = await supabase.from("extra_frequent_products" as any).insert({
        branch_id: branchId,
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
        .eq("branch_id", branchId);

      if (deleteError) throw deleteError;

      const remaining = await fetchExtraFrequentProducts(branchId);
      await applyDisplayOrders(
        branchId,
        remaining.map((row) => row.id),
      );
    },
    onSuccess: invalidate,
  });

  const reorderProducts = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      if (!branchId) throw new Error("No hay sucursal activa");
      await applyDisplayOrders(branchId, orderedIds);
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
