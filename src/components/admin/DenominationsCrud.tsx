import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Denomination {
  id: string;
  label: string;
  value: number;
  display_order: number;
  is_active: boolean;
}

const columns: ColumnDef<Denomination>[] = [
  { key: "label", header: "Etiqueta", width: "1fr", type: "text" },
  { key: "value", header: "Valor", width: "6rem", type: "number", render: (item) => <span>${item.value}</span> },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
  { key: "display_order", header: "Orden", width: "5rem", render: (item) => <span>{item.display_order}</span>, editRender: (value) => <span className="text-sm text-muted-foreground">{value}</span> },
];

const DenominationsCrud = () => {
  const qc = useQueryClient();
  const crud = useCrud<Denomination>({ table: "denominations", queryKey: "admin-denominations", orderBy: { column: "display_order" } });
  const edit = useEditState<Denomination>({ label: "", value: 0, display_order: 1, is_active: true } as any);

  const getNextDisplayOrder = () => {
    if (crud.data.length === 0) return 1;
    return Math.max(...crud.data.map((item) => Number(item.display_order) || 0)) + 1;
  };

  const moveMutation = useMutation({
    mutationFn: async ({ current, target }: { current: Denomination; target: Denomination }) => {
      const tempOrder = -1000000 - Number(current.display_order || 0);

      let error = (await supabase.from("denominations").update({ display_order: tempOrder } as never).eq("id", current.id)).error;
      if (error) throw error;

      error = (await supabase.from("denominations").update({ display_order: current.display_order } as never).eq("id", target.id)).error;
      if (error) throw error;

      error = (await supabase.from("denominations").update({ display_order: target.display_order } as never).eq("id", current.id)).error;
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-denominations"] });
    },
    onError: (err: any) => toast.error(err.message || "No se pudo mover la denominacion"),
  });

  const handleSave = () => {
    const label = String(edit.editValues.label ?? "").trim();
    const value = Number(edit.editValues.value ?? 0);
    const displayOrder = Math.trunc(Number(edit.editValues.display_order ?? 0));

    if (!label) {
      toast.error("La etiqueta es obligatoria");
      return;
    }

    if (!Number.isFinite(value) || value <= 0) {
      toast.error("El valor debe ser mayor a 0");
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
      toast.error(`Ya existe una denominacion con el orden ${displayOrder}`);
      return;
    }

    crud.save({
      ...edit.editValues,
      label,
      value,
      display_order: displayOrder,
    } as any);
  };

  const renderRowActions = (item: Denomination) => {
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
    <AdminTable<Denomination>
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
      addLabel="Agregar denominacion"
      renderRowActions={renderRowActions}
      actionsWidth="9rem"
    />
  );
};

export default DenominationsCrud;
