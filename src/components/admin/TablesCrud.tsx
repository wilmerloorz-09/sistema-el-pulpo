import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface RestaurantTable {
  id: string;
  name: string;
  visual_order: number;
  is_active: boolean;
}

const columns: ColumnDef<RestaurantTable>[] = [
  { key: "name", header: "Nombre", width: "1fr", type: "text" },
  { key: "visual_order", header: "Orden", width: "5rem", type: "number" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
];

const TablesCrud = () => {
  const crud = useCrud<RestaurantTable>({ table: "restaurant_tables", queryKey: "admin-tables", orderBy: { column: "visual_order" } });
  const edit = useEditState<RestaurantTable>({ name: "", visual_order: 0, is_active: true } as any);

  return (
    <AdminTable<RestaurantTable>
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
      addLabel="Agregar mesa"
    />
  );
};

export default TablesCrud;
