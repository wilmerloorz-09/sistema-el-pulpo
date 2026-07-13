import { toast } from "sonner";
import { Shield } from "lucide-react";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { useBranch } from "@/contexts/BranchContext";
import { useQueryClient } from "@tanstack/react-query";
import { AdminTable, ColumnDef } from "./AdminTable";

interface Banco {
  id: string;
  nombre: string;
  activo: boolean;
  orden_visual: number;
}

const columns: ColumnDef<Banco>[] = [
  { key: "nombre", header: "Nombre", width: "1.4fr", type: "text" },
  { key: "orden_visual", header: "Orden", width: "5rem", type: "number" },
  { key: "activo", header: "Activo", width: "4rem", type: "switch" },
];

const BancosCrud = () => {
  const { isGlobalAdmin } = useBranch();
  const qc = useQueryClient();
  const crud = useCrud<Banco>({
    table: "bancos",
    queryKey: "admin-bancos",
    orderBy: { column: "orden_visual" },
  });
  const edit = useEditState<Banco>({
    nombre: "",
    activo: true,
    orden_visual: 1,
  } as Banco);

  if (!isGlobalAdmin) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Shield className="h-8 w-8" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-black text-slate-900">Acceso restringido</h2>
          <p className="max-w-xs text-sm text-slate-500">
            Solo los administradores globales pueden gestionar el catálogo de bancos.
          </p>
        </div>
      </div>
    );
  }

  const getNextOrden = () => {
    if (crud.data.length === 0) return 1;
    return Math.max(...crud.data.map((item) => Number(item.orden_visual) || 0)) + 1;
  };

  const handleSave = () => {
    const nombre = String(edit.editValues.nombre ?? "").trim();
    if (!nombre) {
      toast.error("Debes ingresar el nombre del banco");
      return;
    }
    const orden = Math.max(1, Math.floor(Number(edit.editValues.orden_visual ?? 1)));
    crud.save({
      ...(edit.editValues as Banco),
      nombre,
      orden_visual: orden,
      activo: Boolean(edit.editValues.activo),
    });
    qc.invalidateQueries({ queryKey: ["bancos-activos"] });
  };

  const handleAdd = () => {
    edit.startAdd({ nombre: "", activo: true, orden_visual: getNextOrden() } as Banco);
  };

  const handleDelete = (id: string) => {
    crud.remove(id);
    qc.invalidateQueries({ queryKey: ["bancos-activos"] });
  };

  return (
    <AdminTable<Banco>
      columns={columns}
      data={crud.data}
      isLoading={crud.isLoading}
      editingId={edit.editingId}
      editValues={edit.editValues}
      onEdit={edit.startEdit}
      onCancelEdit={edit.cancelEdit}
      onSave={handleSave}
      onDelete={handleDelete}
      onAdd={handleAdd}
      onFieldChange={edit.setField}
      saving={crud.saving}
      addLabel="Agregar banco"
    />
  );
};

export default BancosCrud;
