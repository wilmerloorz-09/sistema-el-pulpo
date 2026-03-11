import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Category {
  id: string;
  description: string;
  display_order: number;
  is_active: boolean;
  branch_id?: string;
}

const columns: ColumnDef<Category>[] = [
  { key: "description", header: "Nombre", width: "1fr", type: "text" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
  { key: "display_order", header: "Orden", width: "5rem", render: (item) => <span>{item.display_order}</span>, editRender: (value) => <span className="text-sm text-muted-foreground">{value}</span> },
];

const CategoriesCrud = () => {
  const qc = useQueryClient();
  const crud = useCrud<Category>({ table: "categories", queryKey: "admin-categories", orderBy: { column: "display_order" } });
  const edit = useEditState<Category>({ description: "", display_order: 1, is_active: true } as any);

  const getNextDisplayOrder = () => {
    if (crud.data.length === 0) return 1;
    return Math.max(...crud.data.map((item) => Number(item.display_order) || 0)) + 1;
  };

  const moveMutation = useMutation({
    mutationFn: async ({ current, target }: { current: Category; target: Category }) => {
      const tempOrder = -1000000 - Number(current.display_order || 0);

      let error = (await supabase.from("categories").update({ display_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("categories").update({ display_order: current.display_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("categories").update({ display_order: target.display_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-categories"] });
      qc.invalidateQueries({ queryKey: ["admin-categories-list"] });
      qc.invalidateQueries({ queryKey: ["menu-categories"] });
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover la categoria"),
  });

  const handleSave = () => {
    const description = String(edit.editValues.description ?? "").trim();
    const displayOrder = Math.trunc(Number(edit.editValues.display_order ?? 0));

    if (!description) {
      toast.error("El nombre de la categoria es obligatorio");
      return;
    }

    if (!Number.isFinite(displayOrder) || displayOrder < 1) {
      toast.error("El numero de orden debe ser mayor a 0");
      return;
    }

    const duplicate = crud.data.find(
      (item) => item.id !== edit.editingId && Number(item.display_order) === displayOrder,
    );

    if (duplicate) {
      toast.error(`Ya existe una categoria con el orden ${displayOrder}`);
      return;
    }

    crud.save({
      ...edit.editValues,
      description,
      display_order: displayOrder,
    } as any);
  };

  const renderRowActions = (item: Category) => {
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
    <AdminTable<Category>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={handleSave}
      onDelete={crud.remove}
      onAdd={() => edit.startAdd({ display_order: getNextDisplayOrder(), is_active: true })}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar categoria"
      renderRowActions={renderRowActions}
      actionsWidth="9rem"
    />
  );
};

export default CategoriesCrud;


