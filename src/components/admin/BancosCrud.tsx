import { useMutation } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { useCrud } from "@/hooks/useCrud";
import { useEditState } from "@/hooks/useEditState";
import { useBranch } from "@/contexts/BranchContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showSystemAlert } from "@/lib/systemAlert";
import { AdminTable, ColumnDef } from "./AdminTable";

function formatSaveError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint, e.code ? `Codigo: ${e.code}` : ""].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ");
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "Revisa que la migracion de bancos este aplicada y que tengas permisos de administrador global.";
}

interface Banco {
  id: string;
  nombre: string;
  activo: boolean;
  orden_visual: number;
  mascara_cuenta_destino: string;
}

const columns: ColumnDef<Banco>[] = [
  { key: "nombre", header: "Banco de origen", width: "1.4fr", type: "text" },
  {
    key: "mascara_cuenta_destino",
    header: "Máscara cuenta destino",
    width: "1.2fr",
    type: "text",
  },
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
    mascara_cuenta_destino: "XXXXXX####",
  } as Banco);

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const nombre = String(values.nombre ?? "").trim();
      if (!nombre) throw new Error("Debes ingresar el nombre del banco");

      const id = String(values.id ?? "");
      if (!id) throw new Error("No se encontro el identificador del banco");
      const mascara = String(values.mascara_cuenta_destino ?? "")
        .trim()
        .replace(/\s+/g, "");
      if (!/^[Xx*#.-]+$/.test(mascara) || !mascara.includes("#")) {
        throw new Error("La máscara debe usar # para dígitos visibles y X o * para ocultos");
      }

      const payload = {
        id,
        nombre,
        orden_visual: Math.max(1, Math.floor(Number(values.orden_visual ?? 1))),
        activo: values.activo === true,
        mascara_cuenta_destino: mascara,
      };

      const { error } = await supabase.from("bancos").upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-bancos"] });
      qc.invalidateQueries({ queryKey: ["bancos-activos"] });
      edit.cancelEdit();
    },
    onError: (err: unknown) => {
      showSystemAlert("No se pudo guardar el banco", formatSaveError(err));
    },
  });

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
    saveMutation.mutate(edit.editValues);
  };

  const handleAdd = () => {
    edit.startAdd({
      nombre: "",
      activo: true,
      orden_visual: getNextOrden(),
      mascara_cuenta_destino: "XXXXXX####",
    } as Banco);
  };

  const handleDelete = (id: string) => {
    crud.remove(id);
    qc.invalidateQueries({ queryKey: ["bancos-activos"] });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
        <p className="font-bold">Máscara mostrada por cada banco de origen</p>
        <p className="mt-1 text-xs">
          Usa <strong>#</strong> para cada dígito visible que se compara y
          <strong> X</strong> o <strong>*</strong> para los ocultos.
          Ejemplos: <code>XXXXXX####</code> (últimos 4) o{" "}
          <code>##XXXXX##</code> (primeros 2 y últimos 2).
        </p>
      </div>
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
        saving={saveMutation.isPending}
        addLabel="Agregar banco"
      />
    </div>
  );
};

export default BancosCrud;
