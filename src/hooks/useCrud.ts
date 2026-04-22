import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbUpsert, dbDelete } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { showSystemAlert } from "@/App";

type TableName = "categories" | "subcategories" | "products" | "modifiers" | "restaurant_tables" | "payment_methods" | "denominations" | "profiles" | "user_roles" | "branches" | "user_branches";

/** Tables that have a branch_id column and should be filtered/injected automatically */
const BRANCH_TABLES: TableName[] = [
  "categories",
  "modifiers",
  "restaurant_tables",
  "payment_methods",
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

function getCrudErrorMessage(error: any) {
  const message = error?.message ?? "Ocurrio un error inesperado";
  const constraint = error?.details ?? error?.hint ?? "";

  if (
    typeof message === "string" &&
    (message.includes("uq_branches_display_code") || constraint.includes("uq_branches_display_code"))
  ) {
    return "No se pudo crear la sucursal porque el codigo visible interno quedo duplicado. Actualiza las migraciones de la base y vuelve a intentar.";
  }

  if (typeof message === "string" && message.includes("violates foreign key constraint")) {
    return "⛔ Acción bloqueada por seguridad: Este registro no se puede eliminar porque tiene otros datos trabajando con él (historial, cajas o configuraciones). Primero debes eliminar lo que dependa de él.";
  }

  return message;
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
      const dbFilters: any[] = [];
      if (filters) {
        for (const f of filters) {
          dbFilters.push({ column: f.column, op: f.op, value: f.value });
        }
      }

      return dbSelect<any>(table as any, {
        select,
        branchId: isBranchScoped ? activeBranchId : null,
        filters: dbFilters,
        orderBy,
      });
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
      await dbUpsert(table as any, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      setEditingId(null);
      toast.success("Guardado correctamente");
      onAfterSave?.();
    },
    onError: (err: any) => toast.error(getCrudErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await dbDelete(table as any, id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      toast.success("Eliminado correctamente");
    },
    onError: (err: any) => {
      const msg = getCrudErrorMessage(err);
      if (msg.includes("Acción bloqueada por seguridad")) {
        showSystemAlert("Seguridad del Sistema El Pulpo", msg);
      } else {
        toast.error(msg);
      }
    },
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

