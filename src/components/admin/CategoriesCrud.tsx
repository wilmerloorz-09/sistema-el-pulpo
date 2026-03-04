import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Category {
  id: string;
  description: string;
  display_order: number;
  is_active: boolean;
}

const columns: ColumnDef<Category>[] = [
  { key: "description", header: "Nombre", width: "1fr", type: "text" },
  { key: "display_order", header: "Orden", width: "5rem", type: "number" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
];

const CategoriesCrud = () => {
  const crud = useCrud<Category>({ table: "categories", queryKey: "admin-categories", orderBy: { column: "display_order" } });
  const edit = useEditState<Category>({ description: "", display_order: 0, is_active: true } as any);

  return (
    <AdminTable<Category>
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
      addLabel="Agregar categoría"
    />
  );
};

export default CategoriesCrud;
