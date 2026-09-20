import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Loader2, RotateCcw, Save, Shield } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { generateUUID } from "@/lib/uuid";
import { Button } from "@/components/ui/button";
import { NumericInput } from "@/components/ui/numeric-input";
import { Switch } from "@/components/ui/switch";
import DenominationVisual from "@/components/caja/DenominationVisual";
import { cn } from "@/lib/utils";

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

async function upsertBranchStock(
  branchId: string,
  denominations: Denomination[],
  rows: AuxiliaryDenomRow[],
) {
  const byId = new Map(rows.map((item) => [item.denomination_id, item]));
  const payload = denominations.map((item) => {
    const row = byId.get(item.id);
    return {
      branch_id: branchId,
      denomination_id: item.id,
      qty: Math.max(0, Math.trunc(row?.qty ?? 0)),
      is_enabled: row ? row.is_enabled !== false : true,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: ensureError } = await supabase.rpc("ensure_branch_auxiliary_cash" as any, {
    p_branch_id: branchId,
  } as any);
  if (ensureError) throw ensureError;

  const { error } = await supabase
    .from("branch_auxiliary_cash_denoms" as any)
    .upsert(payload, { onConflict: "branch_id,denomination_id" });
  if (error) throw error;

  const { error: headerError } = await supabase
    .from("branch_auxiliary_cash" as any)
    .upsert({
      branch_id: branchId,
      updated_at: new Date().toISOString(),
    });
  if (headerError) throw headerError;
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

  const denominations = denominationsQuery.data ?? [];
  const stockRows = stockQuery.data ?? [];
  const isLoading = denominationsQuery.isLoading || stockQuery.isLoading;

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

      const { templateId } = await loadAuxiliaryTemplateRows(activeBranchId);
      await upsertBranchStock(activeBranchId, denominations, rows);
      await syncAuxiliaryTemplate(activeBranchId, denominations, counts, enabled, templateId);
    },
    onSuccess: () => {
      invalidateAuxiliary();
      toast.success("Caja auxiliar de la sucursal guardada");
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

      await upsertBranchStock(activeBranchId, denominations, rows);
      return rows;
    },
    onSuccess: (rows) => {
      setCounts(buildCountsMap(denominations, rows));
      invalidateAuxiliary();
      toast.success("Cantidades restablecidas a la plantilla");
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

        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="rounded-2xl bg-sky-50 px-4 py-3">
            <p className="text-xs text-muted-foreground">Total (habilitadas)</p>
            <p className="font-display text-2xl font-bold text-sky-700">${total.toFixed(2)}</p>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={busy || denominations.length === 0}
            className="h-11 rounded-2xl"
          >
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar caja auxiliar
          </Button>
        </div>
      </div>
    </div>
  );
}
