import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type TableName = "categories" | "subcategories" | "products" | "modifiers" | "restaurant_tables" | "payment_methods" | "denominations" | "profiles" | "user_roles";

interface UseCrudOptions<T> {
  table: TableName;
  queryKey: string;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  onAfterSave?: () => void;
}

export function useCrud<T extends { id: string }>({ table, queryKey, select = "*", orderBy, onAfterSave }: UseCrudOptions<T>) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [queryKey],
    queryFn: async () => {
      let q = supabase.from(table).select(select);
      if (orderBy) {
        q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as T[];
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (item: Partial<T> & { id?: string }) => {
      const { error } = await supabase.from(table).upsert(item as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      setEditingId(null);
      toast.success("Guardado correctamente");
      onAfterSave?.();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      toast.success("Eliminado correctamente");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    data: query.data ?? [],
    isLoading: query.isLoading,
    editingId,
    setEditingId,
    save: upsertMutation.mutate,
    saving: upsertMutation.isPending,
    remove: deleteMutation.mutate,
    removing: deleteMutation.isPending,
    refetch: query.refetch,
  };
}
