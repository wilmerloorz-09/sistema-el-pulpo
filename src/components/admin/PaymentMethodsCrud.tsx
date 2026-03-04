import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { AdminTable, ColumnDef } from "./AdminTable";

interface PaymentMethod {
  id: string;
  name: string;
  is_active: boolean;
}

const columns: ColumnDef<PaymentMethod>[] = [
  { key: "name", header: "Nombre", width: "1fr", type: "text" },
  { key: "is_active", header: "Activo", width: "4rem", type: "switch" },
];

const PaymentMethodsCrud = () => {
  const crud = useCrud<PaymentMethod>({ table: "payment_methods", queryKey: "admin-payment-methods", orderBy: { column: "name" } });
  const edit = useEditState<PaymentMethod>({ name: "", is_active: true } as any);

  return (
    <AdminTable<PaymentMethod>
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
      addLabel="Agregar método"
    />
  );
};

export default PaymentMethodsCrud;
