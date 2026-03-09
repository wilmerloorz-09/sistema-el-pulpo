import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";

type TableName = "categories" | "subcategories" | "products" | "modifiers" | "restaurant_tables" | "payment_methods" | "denominations" | "profiles" | "user_roles" | "branches" | "user_branches";

/** Tables that have a branch_id column and should be filtered/injected automatically */
const BRANCH_TABLES: TableName[] = [
  "categories",
  "modifiers",
  "restaurant_tables",
  "payment_methods",
  "denominations",
];

interface UseCrudOptions<T> {
  table: TableName;
  queryKey: string;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  /** Extra filters to apply (e.g. for subcategories filtering by branch categories) */
  filters?: Array<{ column: string; op: "eq" | "in"; value: any }>;
  /** Set to false to skip automatic branch filtering (e.g. branches, profiles) */
  branchScoped?: boolean;
  onAfterSave?: () => void;
}

export function useCrud<T extends { id: string }>({ table, queryKey, select = "*", orderBy, filters, branchScoped, onAfterSave }: UseCrudOptions<T>) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const { activeBranchId } = useBranch();

  // Auto-detect if table should be branch-scoped
  const isBranchScoped = branchScoped ?? BRANCH_TABLES.includes(table);

  const query = useQuery({
    queryKey: [queryKey, isBranchScoped ? activeBranchId : null],
    queryFn: async () => {
      let q = supabase.from(table as any).select(select);

      // Filter by branch
      if (isBranchScoped && activeBranchId) {
        q = q.eq("branch_id", activeBranchId);
      }

      // Extra filters
      if (filters) {
        for (const f of filters) {
          if (f.op === "eq") q = q.eq(f.column, f.value);
          if (f.op === "in") q = q.in(f.column, f.value);
        }
      }

      if (orderBy) {
        q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as T[];
    },
    enabled: isBranchScoped ? !!activeBranchId : true,
  });

  const upsertMutation = useMutation({
    mutationFn: async (item: Partial<T> & { id?: string }) => {
      // Auto-inject branch_id for branch-scoped tables
      const payload = { ...item } as any;
      if (isBranchScoped && activeBranchId && !payload.branch_id) {
        payload.branch_id = activeBranchId;
      }
      const { error } = await supabase.from(table as any).upsert(payload);
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
      const { error } = await supabase.from(table as any).delete().eq("id", id);
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

