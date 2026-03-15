import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2, Store, TableProperties } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";

const TablesCrud = () => {
  const qc = useQueryClient();
  const { activeBranch, activeBranchId } = useBranch();
  const [referenceCount, setReferenceCount] = useState(0);

  const settingsQuery = useQuery({
    queryKey: ["admin-table-settings", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;

      const [{ data: branch, error: branchError }, { data: shift, error: shiftError }, { count, error: countError }] = await Promise.all([
        supabase.from("branches").select("id, name, reference_table_count").eq("id", activeBranchId).single(),
        supabase
          .from("cash_shifts")
          .select("id, opened_at, active_tables_count")
          .eq("branch_id", activeBranchId)
          .eq("status", "OPEN")
          .order("opened_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("restaurant_tables")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", activeBranchId),
      ]);

      if (branchError) throw branchError;
      if (shiftError) throw shiftError;
      if (countError) throw countError;

      return {
        branchName: branch.name,
        referenceTableCount: Number(branch.reference_table_count ?? 0),
        activeShiftTablesCount: Number(shift?.active_tables_count ?? 0),
        generatedTablesCount: Number(count ?? 0),
      };
    },
    enabled: !!activeBranchId,
  });

  useEffect(() => {
    setReferenceCount(settingsQuery.data?.referenceTableCount ?? 0);
  }, [settingsQuery.data?.referenceTableCount]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa");
      const normalized = Math.max(0, Math.trunc(referenceCount || 0));

      const { error: updateError } = await supabase
        .from("branches")
        .update({ reference_table_count: normalized })
        .eq("id", activeBranchId);
      if (updateError) throw updateError;

      const { error: ensureError } = await supabase.rpc("ensure_branch_table_capacity", {
        p_branch_id: activeBranchId,
        p_requested_count: normalized,
      });
      if (ensureError) throw ensureError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-table-settings"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["branch-table-settings"] });
      toast.success("Configuracion de mesas guardada");
    },
    onError: (err: any) => toast.error(err.message || "No se pudo guardar la configuracion"),
  });

  if (!activeBranchId) {
    return (
      <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
        Selecciona una sucursal para configurar las mesas referenciales.
      </div>
    );
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-orange-200 bg-gradient-to-br from-white via-orange-50/65 to-amber-50/75 p-5 shadow-[0_22px_55px_-42px_rgba(249,115,22,0.55)]">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
            <TableProperties className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-black text-foreground">Mesas por sucursal y turno</h3>
            <p className="text-sm text-muted-foreground">
              La sucursal guarda una cantidad referencial. Las mesas disponibles del dia se definen al abrir turno.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-orange-200 bg-white/85 p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <Store className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
                {settingsQuery.data?.branchName ?? activeBranch?.name ?? "Sucursal activa"}
              </span>
            </div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mesas referenciales
            </label>
            <Input
              type="number"
              min={0}
              step={1}
              value={referenceCount}
              onChange={(event) => setReferenceCount(Math.max(0, parseInt(event.target.value, 10) || 0))}
              className="h-11 w-36 rounded-2xl text-center text-lg font-black"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Este numero sirve como base para la sucursal. En apertura de turno se puede usar un valor menor o mayor.
            </p>

            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="mt-4 h-11 rounded-2xl px-5 font-bold"
            >
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar referencia
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-sky-200 bg-sky-50/85 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Referencia sucursal</p>
              <p className="mt-2 font-display text-3xl font-black text-sky-900">
                {settingsQuery.data?.referenceTableCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-sky-700">Base sugerida para abrir turno</p>
            </div>

            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/85 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Turno abierto</p>
              <p className="mt-2 font-display text-3xl font-black text-emerald-900">
                {settingsQuery.data?.activeShiftTablesCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-emerald-700">Mesas activas en el turno actual</p>
            </div>

            <div className="rounded-2xl border border-violet-200 bg-violet-50/85 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Mesas generadas</p>
              <p className="mt-2 font-display text-3xl font-black text-violet-900">
                {settingsQuery.data?.generatedTablesCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-violet-700">Pool interno disponible para ordenes y divisiones</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">Nuevo comportamiento</p>
            <p className="text-muted-foreground">
              Ya no se administran mesas una por una desde esta pantalla. El sistema crea internamente las necesarias y usa la apertura de turno para decidir cuantas mesas mostrar como operativas ese dia.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-amber-200 bg-amber-50/85 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">Importante</p>
            <p className="text-muted-foreground">
              Cambiar la referencia no cierra ni reescribe ordenes historicas. Solo asegura capacidad futura de mesas para la sucursal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TablesCrud;
