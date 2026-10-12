import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, History, Loader2, RotateCcw, Save, Shield } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { generateUUID } from "@/lib/uuid";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { Switch } from "@/components/ui/switch";
import DenominationVisual from "@/components/caja/DenominationVisual";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/cashReportUtils";
import { getUserDisplayName } from "@/lib/userDisplay";

interface Denomination {
  id: string;
  label: string;
  denomination_type?: "coin" | "bill";
  value: number;
  display_order: number;
  image_url?: string | null;
  is_active?: boolean;
}

interface AuxiliaryDenomRow {
  denomination_id: string;
  qty: number;
  is_enabled: boolean;
}

type TipoAjuste = "AJUSTE" | "RESTABLECER";

interface AjusteDetalleLinea {
  denomination_id: string;
  label: string;
  tipo: "coin" | "bill";
  valor: number;
  qty_antes: number;
  qty_despues: number;
  habilitada_antes: boolean;
  habilitada_despues: boolean;
}

interface AjusteCajaAuxiliar {
  id: string;
  tipo: TipoAjuste;
  motivo: string;
  detalle: AjusteDetalleLinea[];
  total_antes: number;
  total_despues: number;
  created_at: string;
  ajustado_por_nombre: string;
}

const MIN_MOTIVO = 3;

const describirLinea = (linea: AjusteDetalleLinea) => {
  const nombre = `$${Number(linea.valor).toFixed(2)} ${linea.tipo === "coin" ? "moneda" : "billete"}`;
  const partes: string[] = [];
  if (linea.qty_antes !== linea.qty_despues) {
    const delta = linea.qty_despues - linea.qty_antes;
    partes.push(`${linea.qty_antes} → ${linea.qty_despues} (${delta > 0 ? "+" : ""}${delta})`);
  }
  if (linea.habilitada_antes !== linea.habilitada_despues) {
    partes.push(linea.habilitada_despues ? "habilitada" : "deshabilitada");
  }
  return `${nombre}: ${partes.join(", ")}`;
};

const AUXILIARY_TEMPLATE_NAME = "Caja auxiliar";

const buildCountsMap = (
  denominations: Denomination[],
  rows?: AuxiliaryDenomRow[],
) => {
  const countMap = new Map((rows ?? []).map((item) => [item.denomination_id, Math.max(0, Math.trunc(item.qty || 0))]));
  return Object.fromEntries(denominations.map((item) => [item.id, countMap.get(item.id) ?? 0]));
};

const buildEnabledMap = (
  denominations: Denomination[],
  rows?: AuxiliaryDenomRow[],
) => {
  const enabledMap = new Map((rows ?? []).map((item) => [item.denomination_id, item.is_enabled !== false]));
  return Object.fromEntries(denominations.map((item) => [item.id, enabledMap.get(item.id) ?? true]));
};

async function loadAuxiliaryTemplateRows(branchId: string): Promise<{
  templateId: string | null;
  rows: AuxiliaryDenomRow[];
}> {
  const { data, error } = await supabase
    .from("cash_register_templates" as any)
    .select(`
      id,
      cash_register_template_denoms (
        denomination_id,
        qty,
        is_enabled
      )
    `)
    .eq("branch_id", branchId)
    .eq("is_auxiliary", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { templateId: null, rows: [] };

  const row = data as any;
  return {
    templateId: String(row.id),
    rows: Array.isArray(row.cash_register_template_denoms)
      ? row.cash_register_template_denoms.map((item: any) => ({
          denomination_id: String(item.denomination_id),
          qty: Math.max(0, Math.trunc(Number(item.qty ?? 0))),
          is_enabled: item.is_enabled !== false,
        }))
      : [],
  };
}

/** Devuelve el id del ajuste registrado, o null si no hubo cambios. */
async function guardarAjusteCajaAuxiliar(
  branchId: string,
  denominations: Denomination[],
  rows: AuxiliaryDenomRow[],
  motivo: string,
  tipo: TipoAjuste,
): Promise<string | null> {
  const byId = new Map(rows.map((item) => [item.denomination_id, item]));
  const conteos = denominations.map((item) => {
    const row = byId.get(item.id);
    return {
      denomination_id: item.id,
      qty: Math.max(0, Math.trunc(row?.qty ?? 0)),
      is_enabled: row ? row.is_enabled !== false : true,
    };
  });

  const { data, error } = await supabase.rpc("guardar_ajuste_caja_auxiliar" as any, {
    p_branch_id: branchId,
    p_conteos: conteos,
    p_motivo: motivo,
    p_tipo: tipo,
  } as any);
  if (error) throw error;
  return (data as string | null) ?? null;
}

async function syncAuxiliaryTemplate(
  branchId: string,
  denominations: Denomination[],
  counts: Record<string, number>,
  enabled: Record<string, boolean>,
  existingTemplateId?: string | null,
) {
  const templateId = existingTemplateId ?? generateUUID();
  const { error: templateError } = await supabase.from("cash_register_templates" as any).upsert({
    id: templateId,
    branch_id: branchId,
    name: AUXILIARY_TEMPLATE_NAME,
    is_active: true,
    is_auxiliary: true,
  });
  if (templateError) throw templateError;

  const { error: deleteError } = await supabase
    .from("cash_register_template_denoms" as any)
    .delete()
    .eq("template_id", templateId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase
    .from("cash_register_template_denoms" as any)
    .insert(
      denominations.map((item) => ({
        id: generateUUID(),
        template_id: templateId,
        denomination_id: item.id,
        qty: Math.max(0, Math.trunc(counts[item.id] ?? 0)),
        is_enabled: enabled[item.id] !== false,
      })),
    );
  if (insertError) throw insertError;

  return templateId;
}

export default function AuxiliaryCashTemplateCrud() {
  const qc = useQueryClient();
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const canManageTemplates = isGlobalAdmin || permissions?.admin_sucursal === "MANAGE" || permissions?.admin_global === "MANAGE";
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [motivo, setMotivo] = useState("");

  const denominationsQuery = useQuery({
    queryKey: ["admin-denominations"],
    queryFn: async (): Promise<Denomination[]> => {
      const { data, error } = await supabase
        .from("denominations")
        .select("id, label, denomination_type, value, display_order, image_url, is_active")
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Denomination[];
    },
  });

  const stockQuery = useQuery({
    queryKey: ["admin-branch-auxiliary-cash", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async (): Promise<AuxiliaryDenomRow[]> => {
      if (!activeBranchId) return [];
      const { error: ensureError } = await supabase.rpc("ensure_branch_auxiliary_cash" as any, {
        p_branch_id: activeBranchId,
      } as any);
      if (ensureError) throw ensureError;

      const { data, error } = await supabase
        .from("branch_auxiliary_cash_denoms" as any)
        .select("denomination_id, qty, is_enabled")
        .eq("branch_id", activeBranchId);
      if (error) throw error;
      return ((data ?? []) as any[]).map((item) => ({
        denomination_id: String(item.denomination_id),
        qty: Math.max(0, Math.trunc(Number(item.qty ?? 0))),
        is_enabled: item.is_enabled !== false,
      }));
    },
  });

  const historialQuery = useQuery({
    queryKey: ["admin-ajustes-caja-auxiliar", activeBranchId],
    enabled: !!activeBranchId && canManageTemplates,
    queryFn: async (): Promise<AjusteCajaAuxiliar[]> => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("ajustes_caja_auxiliar" as any)
        .select(
          "id, tipo, motivo, detalle, total_antes, total_despues, created_at, ajustado_por:profiles!ajustes_caja_auxiliar_ajustado_por_fkey(id, alias, username, email)",
        )
        .eq("branch_id", activeBranchId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return ((data ?? []) as any[]).map((item) => ({
        id: String(item.id),
        tipo: item.tipo as TipoAjuste,
        motivo: String(item.motivo ?? ""),
        detalle: Array.isArray(item.detalle) ? (item.detalle as AjusteDetalleLinea[]) : [],
        total_antes: Number(item.total_antes ?? 0),
        total_despues: Number(item.total_despues ?? 0),
        created_at: String(item.created_at),
        ajustado_por_nombre: getUserDisplayName(item.ajustado_por),
      }));
    },
  });

  const denominations = denominationsQuery.data ?? [];
  const stockRows = stockQuery.data ?? [];
  const isLoading = denominationsQuery.isLoading || stockQuery.isLoading;
  const historial = historialQuery.data ?? [];

  const hayCambios = useMemo(() => {
    const actual = new Map(stockRows.map((row) => [row.denomination_id, row]));
    return denominations.some((item) => {
      const row = actual.get(item.id);
      const qtyActual = row?.qty ?? 0;
      const habilitadaActual = row ? row.is_enabled !== false : true;
      return (counts[item.id] ?? 0) !== qtyActual || (enabled[item.id] !== false) !== habilitadaActual;
    });
  }, [counts, denominations, enabled, stockRows]);
  const motivoValido = motivo.trim().length >= MIN_MOTIVO;

  useEffect(() => {
    if (!denominations.length) return;
    setCounts(buildCountsMap(denominations, stockRows));
    setEnabled(buildEnabledMap(denominations, stockRows));
  }, [stockRows, denominations]);

  const total = useMemo(
    () =>
      denominations.reduce((sum, denomination) => {
        if (!(enabled[denomination.id] ?? true)) return sum;
        return sum + denomination.value * (counts[denomination.id] ?? 0);
      }, 0),
    [counts, denominations, enabled],
  );

  const invalidateAuxiliary = () => {
    qc.invalidateQueries({ queryKey: ["admin-branch-auxiliary-cash"] });
    qc.invalidateQueries({ queryKey: ["admin-auxiliary-cash-template"] });
    qc.invalidateQueries({ queryKey: ["auxiliary-cash-context"] });
    qc.invalidateQueries({ queryKey: ["admin-ajustes-caja-auxiliar"] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa seleccionada.");
      if (denominations.length === 0) throw new Error("No hay denominaciones activas configuradas.");

      const rows = denominations.map((item) => ({
        denomination_id: item.id,
        qty: Math.max(0, Math.trunc(counts[item.id] ?? 0)),
        is_enabled: enabled[item.id] !== false,
      }));

      if (!rows.some((item) => item.is_enabled)) {
        throw new Error("Debes habilitar al menos una denominacion.");
      }
      if (hayCambios && !motivoValido) {
        throw new Error("Escribe el motivo del ajuste antes de guardar.");
      }

      const { templateId } = await loadAuxiliaryTemplateRows(activeBranchId);
      const ajusteId = await guardarAjusteCajaAuxiliar(
        activeBranchId,
        denominations,
        rows,
        motivo.trim(),
        "AJUSTE",
      );
      await syncAuxiliaryTemplate(activeBranchId, denominations, counts, enabled, templateId);
      return ajusteId;
    },
    onSuccess: (ajusteId) => {
      invalidateAuxiliary();
      setMotivo("");
      toast.success(
        ajusteId
          ? "Caja auxiliar guardada y ajuste registrado en el historial"
          : "Caja auxiliar guardada (sin cambios en las cantidades)",
      );
    },
    onError: (error: any) => toast.error(error?.message ?? "No se pudo guardar la caja auxiliar"),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa seleccionada.");
      if (denominations.length === 0) throw new Error("No hay denominaciones activas configuradas.");

      const { templateId, rows: templateRows } = await loadAuxiliaryTemplateRows(activeBranchId);
      if (!templateId || templateRows.length === 0) {
        throw new Error("No hay una plantilla auxiliar guardada para restablecer.");
      }

      // Solo restaura cantidades; conserva el estado Habilitado actual.
      const qtyById = new Map(templateRows.map((item) => [item.denomination_id, item.qty]));
      const rows = denominations.map((item) => ({
        denomination_id: item.id,
        qty: Math.max(0, Math.trunc(qtyById.get(item.id) ?? 0)),
        is_enabled: enabled[item.id] !== false,
      }));

      if (!motivoValido) {
        throw new Error("Escribe el motivo del ajuste (abajo, junto al total) antes de restablecer.");
      }

      const ajusteId = await guardarAjusteCajaAuxiliar(
        activeBranchId,
        denominations,
        rows,
        motivo.trim(),
        "RESTABLECER",
      );
      return { rows, ajusteId };
    },
    onSuccess: ({ rows, ajusteId }) => {
      setCounts(buildCountsMap(denominations, rows));
      invalidateAuxiliary();
      setMotivo("");
      toast.success(
        ajusteId
          ? "Cantidades restablecidas a la plantilla y registradas en el historial"
          : "La caja auxiliar ya tenía las cantidades de la plantilla",
      );
    },
    onError: (error: any) => toast.error(error?.message ?? "No se pudo restablecer la caja auxiliar"),
  });

  if (!canManageTemplates) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Shield className="h-8 w-8" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-black text-slate-900">Acceso restringido</h2>
          <p className="max-w-xs text-sm text-slate-500">
            Solo administracion de sucursal o administracion global puede gestionar la caja auxiliar.
          </p>
        </div>
      </div>
    );
  }

  const busy = saveMutation.isPending || resetMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-sky-200 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-black text-foreground">Caja auxiliar de la sucursal</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{activeBranch?.name ?? "la sucursal activa"}</span>
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => resetMutation.mutate()}
            disabled={busy || denominations.length === 0}
            className="h-11 shrink-0 gap-2 rounded-2xl"
          >
            {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Restablecer
          </Button>
        </div>
      </div>

      <div className="rounded-[28px] border border-sky-200 bg-white/90 p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="font-display text-lg font-black text-foreground">Stock actual</h3>
          <p className="text-sm text-muted-foreground">
            Define cantidades actuales y cuales denominaciones estan habilitadas para el cambio.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : denominations.length === 0 ? (
          <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
            No hay denominaciones activas para configurar la caja auxiliar.
          </div>
        ) : (
          <div className="space-y-3">
            {denominations.map((denomination) => {
              const isItemEnabled = enabled[denomination.id] !== false;
              return (
                <div
                  key={denomination.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3",
                    isItemEnabled ? "border-border" : "border-slate-200 opacity-60",
                  )}
                >
                  <DenominationVisual
                    label={denomination.label}
                    imageUrl={denomination.image_url}
                    className="h-14 w-20 rounded-2xl"
                    imageClassName="object-contain bg-white p-0.5"
                    iconClassName="h-6 w-6"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{denomination.label}</p>
                    <p className="text-2xl font-black leading-none text-red-600">${denomination.value.toFixed(2)}</p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 rounded-xl border border-border px-3 py-2">
                    <Switch
                      checked={isItemEnabled}
                      onCheckedChange={(checked) => {
                        setEnabled((current) => ({ ...current, [denomination.id]: checked }));
                        if (!checked) {
                          setCounts((current) => ({ ...current, [denomination.id]: 0 }));
                        }
                      }}
                    />
                    <span className="text-sm font-medium text-foreground">Habilitado</span>
                  </label>
                  <NumericInput
                    value={counts[denomination.id] ?? 0}
                    onValueChange={(nextQty) => setCounts((current) => ({ ...current, [denomination.id]: nextQty }))}
                    min={0}
                    disabled={!isItemEnabled || busy}
                    className="h-10 w-24 rounded-xl text-center"
                  />
                  <span className="w-24 text-right text-sm font-semibold text-foreground">
                    ${(denomination.value * (counts[denomination.id] ?? 0)).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5 space-y-2 border-t border-border pt-4">
          <Label htmlFor="motivo-ajuste-auxiliar">
            Motivo del ajuste
            <span className="ml-1 font-normal text-muted-foreground">
              (obligatorio al cambiar cantidades o restablecer)
            </span>
          </Label>
          <Textarea
            id="motivo-ajuste-auxiliar"
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            disabled={busy}
            placeholder="Ej. Reposición de monedas desde caja principal"
            className="min-h-20"
          />
          {hayCambios && !motivoValido ? (
            <p className="text-xs font-medium text-amber-700">
              Hay cambios sin guardar: escribe el motivo para poder guardarlos.
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="rounded-2xl bg-sky-50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Total (habilitadas)</p>
            <p className="font-display text-2xl font-bold text-sky-700">${total.toFixed(2)}</p>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={busy || denominations.length === 0 || (hayCambios && !motivoValido)}
            className="h-11 rounded-2xl"
          >
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar caja auxiliar
          </Button>
        </div>
      </div>

      <div className="rounded-[28px] border border-sky-200 bg-white/90 p-5 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-black text-foreground">Historial de ajustes</h3>
            <p className="text-sm text-muted-foreground">
              Ajustes manuales hechos desde esta pantalla (últimos 30).
            </p>
          </div>
        </div>

        {historialQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : historialQuery.isError ? (
          <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            No se pudo cargar el historial de ajustes.
          </p>
        ) : historial.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-muted-foreground">
            Todavía no hay ajustes registrados.
          </p>
        ) : (
          <ul className="space-y-3">
            {historial.map((ajuste) => {
              const diferencia = ajuste.total_despues - ajuste.total_antes;
              return (
                <li key={ajuste.id} className="rounded-2xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {formatDateTime(ajuste.created_at)} · {ajuste.ajustado_por_nombre}
                    </p>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-bold",
                        ajuste.tipo === "RESTABLECER"
                          ? "bg-violet-100 text-violet-800"
                          : "bg-sky-100 text-sky-800",
                      )}
                    >
                      {ajuste.tipo === "RESTABLECER" ? "Restablecer" : "Ajuste"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Motivo: {ajuste.motivo}</p>
                  <ul className="mt-2 space-y-0.5 text-sm text-foreground">
                    {ajuste.detalle.map((linea) => (
                      <li key={linea.denomination_id}>{describirLinea(linea)}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    Total: ${ajuste.total_antes.toFixed(2)} → ${ajuste.total_despues.toFixed(2)}
                    <span className={cn("ml-2", diferencia < 0 ? "text-destructive" : "text-emerald-700")}>
                      ({diferencia >= 0 ? "+" : "-"}${Math.abs(diferencia).toFixed(2)})
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
