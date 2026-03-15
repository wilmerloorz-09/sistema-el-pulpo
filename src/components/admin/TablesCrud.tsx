import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { useBranch } from "@/contexts/BranchContext";
import { AdminTable, ColumnDef } from "./AdminTable";

interface RestaurantTable {
  id: string;
  name: string;
  visual_order: number;
  table_number?: number | null;
  is_active: boolean;
}

const columns: ColumnDef<RestaurantTable>[] = [
  { key: "name", header: "Nombre", width: "1fr", type: "text" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
  { key: "visual_order", header: "Orden", width: "5rem", render: (item) => <span>{item.visual_order}</span>, editRender: (value) => <span className="text-sm text-muted-foreground">{value}</span> },
];

const TablesCrud = () => {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const crud = useCrud<RestaurantTable>({ table: "restaurant_tables", queryKey: "admin-tables", orderBy: { column: "visual_order" } });
  const edit = useEditState<RestaurantTable>({ name: "", visual_order: 1, is_active: true } as any);

  const getNextVisualOrder = () => {
    if (crud.data.length === 0) return 1;
    return Math.max(...crud.data.map((item) => Number(item.visual_order) || 0)) + 1;
  };

  const moveMutation = useMutation({
    mutationFn: async ({ current, target }: { current: RestaurantTable; target: RestaurantTable }) => {
      const tempOrder = -1000000 - Number(current.visual_order || 0);

      let error = (await supabase.from("restaurant_tables").update({ visual_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("restaurant_tables").update({ visual_order: current.visual_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("restaurant_tables").update({ visual_order: target.visual_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-tables"] });
      qc.invalidateQueries({ queryKey: ["tables-status"] });
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover la mesa"),
  });

  const handleSave = async () => {
    const name = String(edit.editValues.name ?? "").trim();
    const visualOrder = Math.trunc(Number(edit.editValues.visual_order ?? 0));
    const isAdding = !!edit.editingId && !crud.data.some((item) => item.id === edit.editingId);

    if (!name) {
      toast.error("El nombre de la mesa es obligatorio");
      return;
    }

    if (!Number.isFinite(visualOrder) || visualOrder < 1) {
      toast.error("El numero de orden debe ser mayor a 0");
      return;
    }

    const duplicate = crud.data.find(
      (item) => item.id !== edit.editingId && Number(item.visual_order) === visualOrder,
    );

    if (duplicate) {
      toast.error(`Ya existe una mesa con el orden ${visualOrder}`);
      return;
    }

    if (isAdding) {
      if (!activeBranchId) {
        toast.error("No hay sucursal activa para crear la mesa");
        return;
      }

      try {
        let lastError: any = null;

        for (let attempt = 0; attempt < 20; attempt += 1) {
          const { data: nextSequence, error: sequenceError } = await supabase.rpc("next_human_sequence", {
            p_entity_key: "restaurant_tables",
            p_branch_id: activeBranchId,
            p_period_key: null,
          });

          if (sequenceError) throw sequenceError;

          const nextTableNumber = Number(nextSequence);
          if (!Number.isFinite(nextTableNumber) || nextTableNumber < 1) {
            throw new Error("No se pudo generar un numero de mesa valido");
          }

          const { error: insertError } = await supabase.from("restaurant_tables").insert({
            id: edit.editingId!,
            branch_id: activeBranchId,
            name,
            visual_order: visualOrder,
            is_active: !!edit.editValues.is_active,
            table_number: nextTableNumber,
          } as any);

          if (!insertError) {
            qc.invalidateQueries({ queryKey: ["admin-tables"] });
            qc.invalidateQueries({ queryKey: ["tables-status"] });
            edit.cancelEdit();
            toast.success("Guardado correctamente");
            return;
          }

          lastError = insertError;
          if (!String(insertError.message || "").includes("uq_restaurant_tables_branch_table_number")) {
            throw insertError;
          }
        }

        throw lastError;
      } catch (err: any) {
        toast.error(err.message || "No se pudo crear la mesa");
      }
      return;
    }

    crud.save({
      ...edit.editValues,
      name,
      visual_order: visualOrder,
    } as any);
  };

  const renderRowActions = (item: RestaurantTable) => {
    const index = crud.data.findIndex((row) => row.id === item.id);
    const prev = index > 0 ? crud.data[index - 1] : null;
    const next = index >= 0 && index < crud.data.length - 1 ? crud.data[index + 1] : null;

    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!prev || moveMutation.isPending}
          onClick={() => prev && moveMutation.mutate({ current: item, target: prev })}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          disabled={!next || moveMutation.isPending}
          onClick={() => next && moveMutation.mutate({ current: item, target: next })}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
      </>
    );
  };

  return (
    <AdminTable<RestaurantTable>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={handleSave}
      onDelete={crud.remove}
      onAdd={() => edit.startAdd({ visual_order: getNextVisualOrder(), is_active: true })}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar mesa"
      renderRowActions={renderRowActions}
      actionsWidth="9rem"
    />
  );
};

export default TablesCrud;
