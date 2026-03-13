import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, type ColumnDef } from "./AdminTable";

interface ModifierRow {
  id: string;
  description: string;
  is_active: boolean;
}

const ModifiersCrud = () => {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const edit = useEditState<ModifierRow>({ description: "", is_active: true } as ModifierRow);

  const { data: modifiers = [], isLoading } = useQuery({
    queryKey: ["admin-modifiers", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("modifiers")
        .select("id, description, is_active")
        .eq("branch_id", activeBranchId)
        .order("description", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ModifierRow[];
    },
    enabled: !!activeBranchId,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, any>) => {
      if (!activeBranchId) throw new Error("Selecciona una sucursal activa");

      const description = String(values.description ?? "").trim();
      if (!description) throw new Error("El nombre del modificador es obligatorio");

      const { error } = await supabase.from("modifiers").upsert({
        id: values.id,
        description,
        is_active: Boolean(values.is_active),
        branch_id: activeBranchId,
      } as never);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modifiers", activeBranchId] });
      qc.invalidateQueries({ queryKey: ["node-modifiers"] });
      qc.invalidateQueries({ queryKey: ["menu-modifiers", activeBranchId] });
      edit.cancelEdit();
      toast.success("Modificador guardado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo guardar"),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modifiers").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-modifiers", activeBranchId] });
      qc.invalidateQueries({ queryKey: ["node-modifiers"] });
      qc.invalidateQueries({ queryKey: ["menu-modifiers", activeBranchId] });
      toast.success("Modificador desactivado");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo desactivar"),
  });

  const columns: ColumnDef<ModifierRow>[] = useMemo(
    () => [
      { key: "description", header: "Nombre", width: "1fr", type: "text" },
      { key: "is_active", header: "Activo", width: "5rem", type: "switch" },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Catalogo base de modificadores</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Aqui solo se administra el nombre y el estado del modificador. Las asignaciones a categorias o productos se hacen en
              <span className="font-medium text-foreground"> Admin &gt; Arbol Menu</span>.
            </p>
          </div>
        </div>
      </div>

      <AdminTable<ModifierRow>
        columns={columns}
        data={modifiers}
        isLoading={isLoading}
        editingId={edit.editingId}
        editValues={edit.editValues}
        onEdit={edit.startEdit}
        onCancelEdit={edit.cancelEdit}
        onSave={() => saveMutation.mutate(edit.editValues)}
        onDelete={(id) => removeMutation.mutate(id)}
        onAdd={() => edit.startAdd({ is_active: true })}
        onFieldChange={edit.setField}
        saving={saveMutation.isPending}
        addLabel="Agregar modificador"
      />
    </div>
  );
};

export default ModifiersCrud;
