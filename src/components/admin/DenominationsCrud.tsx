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
  { key: "display_order", header: "Orden", width: "5rem", type: "number" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
];

const DenominationsCrud = () => {
  const crud = useCrud<Denomination>({ table: "denominations", queryKey: "admin-denominations", orderBy: { column: "display_order" } });
  const edit = useEditState<Denomination>({ label: "", value: 0, display_order: 0, is_active: true } as any);

  return (
    <AdminTable<Denomination>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={() => crud.save(edit.editValues as any)}
      onDelete={crud.remove}
      onAdd={() => edit.startAdd()}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar denominación"
    />
  );
};

export default DenominationsCrud;
