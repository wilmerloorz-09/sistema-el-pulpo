import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";
import { useBranch } from "@/contexts/BranchContext";

interface Branch {
  id: string;
  name: string;
  branch_code: string;
  address: string | null;
  reference_table_count: number;
  workflow_mode: 'CASH_THEN_DISPATCH' | 'DISPATCH_THEN_CASH';
  is_active: boolean;
  printer_ip: string | null;
  printer_port: number | null;
}

const BranchesCrud = () => {
  const { refreshAccess } = useBranch();
  const crud = useCrud<Branch>({ 
    table: "branches" as any, 
    queryKey: "admin-branches", 
    orderBy: { column: "name" },
    onAfterSave: refreshAccess
  });

  const edit = useEditState<Branch>({
    name: "",
    branch_code: "",
    address: "",
    reference_table_count: 0,
    workflow_mode: 'DISPATCH_THEN_CASH',
    is_active: true,
    printer_ip: "192.168.1.100",
    printer_port: 9100,
  } as any);

  const columns: ColumnDef<Branch>[] = [
    { key: "name", header: "Nombre", width: "1.2fr", type: "text" },
    { key: "branch_code", header: "Codigo", width: "5rem", type: "text" },
    { key: "address", header: "Direccion", width: "1.2fr", type: "text" },
    { key: "reference_table_count", header: "Mesas ref.", width: "6rem", type: "number" },
    { key: "printer_ip", header: "IP Impresora", width: "1fr", type: "text" },
    { key: "printer_port", header: "Puerto", width: "5rem", type: "number" },
    { 
      key: "workflow_mode", 
      header: "Flujo operativo", 
      width: "1.4fr",
      render: (item) => item.workflow_mode === 'CASH_THEN_DISPATCH' ? 'Método A (Caja primero)' : 'Método B (Despacho primero)',
      editRender: (value, onChange) => (
        <select 
          value={value ?? 'CASH_THEN_DISPATCH'} 
          onChange={(e) => onChange(e.target.value)} 
          className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="CASH_THEN_DISPATCH">Método A: Caja primero</option>
          <option value="DISPATCH_THEN_CASH">Método B: Despacho primero</option>
        </select>
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
