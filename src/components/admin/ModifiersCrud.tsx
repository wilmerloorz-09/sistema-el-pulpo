import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Modifier {
  id: string;
  description: string;
  is_active: boolean;
}

const columns: ColumnDef<Modifier>[] = [
  { key: "description", header: "Nombre", width: "1fr", type: "text" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
];

const ModifiersCrud = () => {
  const crud = useCrud<Modifier>({ table: "modifiers", queryKey: "admin-modifiers", orderBy: { column: "description" } });
  const edit = useEditState<Modifier>({ description: "", is_active: true } as any);

  return (
    <AdminTable<Modifier>
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
      addLabel="Agregar modificador"
    />
  );
};

export default ModifiersCrud;
