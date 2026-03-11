import { toast } from "sonner";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { isCashPaymentMethodName, normalizePaymentMethodName } from "@/lib/paymentMethods";
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

  const existingCashMethod = crud.data.find((item) => isCashPaymentMethodName(item.name));

  const handleSave = () => {
    const current = crud.data.find((item) => item.id === edit.editingId);
    const normalizedName = normalizePaymentMethodName(String(edit.editValues.name ?? ""));

    if (!normalizedName) {
      toast.error("Debes ingresar un nombre para el metodo de pago");
      return;
    }

    if (existingCashMethod && !current && isCashPaymentMethodName(normalizedName)) {
      toast.error("Efectivo ya existe en esta sucursal");
      return;
    }

    if (current && isCashPaymentMethodName(current.name)) {
      edit.setField("name", "Efectivo");
      if (!edit.editValues.is_active) {
        toast.error("Efectivo siempre debe permanecer activo");
        return;
      }
      crud.save({ ...(edit.editValues as any), name: "Efectivo", is_active: true });
      return;
    }

    crud.save(edit.editValues as any);
  };

  const handleDelete = (id: string) => {
    const current = crud.data.find((item) => item.id === id);
    if (current && isCashPaymentMethodName(current.name)) {
      toast.error("Efectivo no se puede eliminar");
      return;
    }
    crud.remove(id);
  };

  const handleAdd = () => {
    if (!existingCashMethod) {
      edit.startAdd({ name: "Efectivo", is_active: true } as any);
      return;
    }
    edit.startAdd();
  };

  return (
    <AdminTable<PaymentMethod>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={(item) => edit.startEdit(isCashPaymentMethodName(item.name) ? { ...item, name: "Efectivo", is_active: true } : item)}
      onCancelEdit={edit.cancelEdit}
      onSave={handleSave}
      onDelete={handleDelete}
      onAdd={handleAdd}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar metodo"
    />
  );
};

export default PaymentMethodsCrud;
