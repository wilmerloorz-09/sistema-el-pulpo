import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Branch {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
}

const BranchesCrud = () => {
  const crud = useCrud<Branch>({ table: "branches" as any, queryKey: "admin-branches", orderBy: { column: "name" } });
  const edit = useEditState<Branch>({ name: "", address: "", is_active: true } as any);

  const columns: ColumnDef<Branch>[] = [
    { key: "name", header: "Nombre", width: "1fr", type: "text" },
    { key: "address", header: "Dirección", width: "1fr", type: "text" },
    { key: "is_active", header: "Activa", width: "4rem", type: "switch" },
  ];

  return (
    <AdminTable<Branch>
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
      addLabel="Agregar sucursal"
    />
  );
};

export default BranchesCrud;
