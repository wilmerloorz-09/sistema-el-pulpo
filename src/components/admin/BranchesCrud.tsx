import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Branch {
  id: string;
  name: string;
  branch_code: string;
  address: string | null;
  reference_table_count: number;
  workflow_mode: 'CASH_THEN_DISPATCH' | 'DISPATCH_THEN_CASH';
  is_active: boolean;
}

const BranchesCrud = () => {
  const crud = useCrud<Branch>({ table: "branches" as any, queryKey: "admin-branches", orderBy: { column: "name" } });
  const edit = useEditState<Branch>({
    name: "",
    branch_code: "",
    address: "",
    reference_table_count: 0,
    workflow_mode: 'DISPATCH_THEN_CASH',
    is_active: true,
  } as any);

  const columns: ColumnDef<Branch>[] = [
    { key: "name", header: "Nombre", width: "1fr", type: "text" },
    { key: "branch_code", header: "Codigo", width: "5rem", type: "text" },
    { key: "address", header: "Direccion", width: "1fr", type: "text" },
    { key: "reference_table_count", header: "Mesas ref.", width: "6rem", type: "number" },
    {
      key: "workflow_mode",
      header: "Mesero/Cajero",
      width: "8rem",
      render: (item) => (
        <Switch
          checked={item.workflow_mode === 'CASH_THEN_DISPATCH'}
          disabled
        />
      ),
      editRender: (value, onChange) => (
        <Switch
          checked={value === 'CASH_THEN_DISPATCH'}
          onCheckedChange={(val) => onChange(val ? 'CASH_THEN_DISPATCH' : 'DISPATCH_THEN_CASH')}
        />
      )
    },
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
