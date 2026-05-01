import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

type BranchWorkflowMode = "DISPATCH_THEN_CASH" | "CASH_THEN_DISPATCH";

interface Branch {
  id: string;
  name: string;
  branch_code: string;
  address: string | null;
  reference_table_count: number;
  workflow_mode: BranchWorkflowMode;
  is_active: boolean;
}

const WORKFLOW_OPTIONS: Array<{ value: BranchWorkflowMode; label: string }> = [
  { value: "DISPATCH_THEN_CASH", label: "Despacho - Caja" },
  { value: "CASH_THEN_DISPATCH", label: "Caja - Despacho" },
];

function getWorkflowLabel(value: string | null | undefined) {
  return WORKFLOW_OPTIONS.find((option) => option.value === value)?.label ?? "Despacho - Caja";
}

const BranchesCrud = () => {
  const crud = useCrud<Branch>({ table: "branches" as any, queryKey: "admin-branches", orderBy: { column: "name" } });
  const edit = useEditState<Branch>({
    name: "",
    branch_code: "",
    address: "",
    reference_table_count: 0,
    workflow_mode: "DISPATCH_THEN_CASH",
    is_active: true,
  } as any);

  const columns: ColumnDef<Branch>[] = [
    { key: "name", header: "Nombre", width: "1fr", type: "text" },
    { key: "branch_code", header: "Codigo", width: "5rem", type: "text" },
    { key: "address", header: "Direccion", width: "1fr", type: "text" },
    { key: "reference_table_count", header: "Mesas ref.", width: "6rem", type: "number" },
    {
      key: "workflow_mode",
      header: "Flujo de trabajo",
      width: "10rem",
      render: (branch) => getWorkflowLabel(branch.workflow_mode),
      editRender: (value, onChange) => (
        <select
          value={value || "DISPATCH_THEN_CASH"}
          onChange={(event) => onChange(event.target.value as BranchWorkflowMode)}
          required
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
        >
          {WORKFLOW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ),
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
