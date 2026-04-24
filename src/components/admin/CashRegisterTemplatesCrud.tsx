import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileStack, Loader2, Pencil, Plus, Save, Shield, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { generateUUID } from "@/lib/uuid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import DenominationVisual from "@/components/caja/DenominationVisual";

interface Denomination {
  id: string;
  label: string;
  denomination_type?: "coin" | "bill";
  value: number;
  display_order: number;
  image_url?: string | null;
  is_active?: boolean;
}

interface CashRegisterTemplate {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  counts: { denomination_id: string; qty: number }[];
}

const buildCountsMap = (
  denominations: Denomination[],
  counts?: { denomination_id: string; qty: number }[],
) => {
  const countMap = new Map((counts ?? []).map((item) => [item.denomination_id, Math.max(0, Math.trunc(item.qty || 0))]));
  return Object.fromEntries(denominations.map((item) => [item.id, countMap.get(item.id) ?? 0]));
};

export default function CashRegisterTemplatesCrud() {
  const qc = useQueryClient();
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const canManageTemplates = isGlobalAdmin || permissions?.admin_sucursal === "MANAGE" || permissions?.admin_global === "MANAGE";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

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

  const templatesQuery = useQuery({
    queryKey: ["admin-cash-register-templates", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async (): Promise<CashRegisterTemplate[]> => {
      if (!activeBranchId) return [];
      const { data, error } = await supabase
        .from("cash_register_templates" as any)
        .select(`
          id,
          name,
          is_active,
          created_at,
          updated_at,
          cash_register_template_denoms (
            denomination_id,
            qty
          )
        `)
        .eq("branch_id", activeBranchId)
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        name: row.name,
        is_active: Boolean(row.is_active),
        created_at: row.created_at,
        updated_at: row.updated_at,
        counts: Array.isArray(row.cash_register_template_denoms)
          ? row.cash_register_template_denoms.map((item: any) => ({
              denomination_id: String(item.denomination_id),
              qty: Math.max(0, Math.trunc(Number(item.qty ?? 0))),
            }))
          : [],
      }));
    },
  });

  const denominations = denominationsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const isLoading = denominationsQuery.isLoading || templatesQuery.isLoading;
  const total = useMemo(
    () => denominations.reduce((sum, denomination) => sum + denomination.value * (counts[denomination.id] ?? 0), 0),
    [counts, denominations],
  );

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setIsActive(true);
    setCounts(buildCountsMap(denominations));
  };

  const startAdd = () => {
    setEditingId("new");
    setName("");
    setIsActive(true);
    setCounts(buildCountsMap(denominations));
  };

  const startEdit = (template: CashRegisterTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setIsActive(template.is_active);
    setCounts(buildCountsMap(denominations, template.counts));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId) throw new Error("No hay sucursal activa seleccionada.");
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("El nombre de la plantilla es obligatorio.");
      if (denominations.length === 0) throw new Error("No hay denominaciones activas configuradas.");

      const positiveCounts = denominations
        .map((item) => ({
          denomination_id: item.id,
          qty: Math.max(0, Math.trunc(counts[item.id] ?? 0)),
        }))
        .filter((item) => item.qty > 0);

      if (positiveCounts.length === 0) {
        throw new Error("Debes asignar al menos una cantidad mayor a 0.");
      }

      const templateId = editingId && editingId !== "new" ? editingId : generateUUID();
      const { error: templateError } = await supabase.from("cash_register_templates" as any).upsert({
        id: templateId,
        branch_id: activeBranchId,
        name: trimmedName,
        is_active: isActive,
      });
      if (templateError) throw templateError;

      const { error: deleteError } = await supabase
        .from("cash_register_template_denoms" as any)
        .delete()
        .eq("template_id", templateId);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from("cash_register_template_denoms" as any)
        .insert(positiveCounts.map((item) => ({
          id: generateUUID(),
          template_id: templateId,
          denomination_id: item.denomination_id,
          qty: item.qty,
        })));
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-cash-register-templates"] });
      qc.invalidateQueries({ queryKey: ["cash-register-templates"] });
      resetForm();
      toast.success("Plantilla guardada");
    },
    onError: (error: any) => toast.error(error?.message ?? "No se pudo guardar la plantilla"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase.from("cash_register_templates" as any).delete().eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-cash-register-templates"] });
      qc.invalidateQueries({ queryKey: ["cash-register-templates"] });
      resetForm();
      toast.success("Plantilla eliminada");
    },
    onError: (error: any) => toast.error(error?.message ?? "No se pudo eliminar la plantilla"),
  });

  if (!canManageTemplates) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-orange-200 bg-white/80 p-8 shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Shield className="h-8 w-8" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-black text-slate-900">Acceso restringido</h2>
          <p className="max-w-xs text-sm text-slate-500">Solo administracion de sucursal o administracion global puede gestionar plantillas de caja.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-orange-200 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-black text-foreground">Plantillas de caja</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Define aperturas frecuentes para <span className="font-semibold text-foreground">{activeBranch?.name ?? "la sucursal activa"}</span> y aplicalas desde Abrir Caja.
            </p>
          </div>
          {!editingId && (
            <Button onClick={startAdd} className="h-11 rounded-2xl">
              <Plus className="mr-2 h-4 w-4" />
              Nueva plantilla
            </Button>
          )}
        </div>
      </div>

      {(editingId || templates.length === 0) && (
        <div className="rounded-[28px] border border-orange-200 bg-white/90 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-black text-foreground">
                {editingId && editingId !== "new" ? "Editar plantilla" : "Nueva plantilla"}
              </h3>
              <p className="text-sm text-muted-foreground">Asigna un nombre y define cuantas unidades de cada denominacion debe sugerir la apertura.</p>
            </div>
            {editingId && (
              <Button variant="outline" onClick={resetForm} className="rounded-xl">
                <X className="mr-2 h-4 w-4" />
                Cancelar
              </Button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className="mb-2 block text-sm font-semibold text-foreground">Nombre de la plantilla</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Apertura turno manana" className="h-11 rounded-xl" />
            </div>
            <label className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <span className="text-sm font-medium text-foreground">Activa</span>
            </label>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : denominations.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
              No hay denominaciones activas para construir plantillas.
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {denominations.map((denomination) => (
                <div key={denomination.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
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
                  <NumericInput
                    value={counts[denomination.id] ?? 0}
                    onValueChange={(nextQty) => setCounts((current) => ({ ...current, [denomination.id]: nextQty }))}
                    min={0}
                    className="h-10 w-24 rounded-xl text-center"
                  />
                  <span className="w-24 text-right text-sm font-semibold text-foreground">
                    ${(denomination.value * (counts[denomination.id] ?? 0)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="rounded-2xl bg-primary/10 px-4 py-3">
              <p className="text-xs text-muted-foreground">Total sugerido</p>
              <p className="font-display text-2xl font-bold text-primary">${total.toFixed(2)}</p>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || denominations.length === 0} className="h-11 rounded-2xl">
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Guardar plantilla
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : templates.length === 0 ? (
          <div className="rounded-[28px] border border-border bg-white/90 p-6 text-center text-sm text-muted-foreground shadow-sm">
            Aun no hay plantillas de caja creadas para esta sucursal.
          </div>
        ) : (
          templates.map((template) => {
            const templateCounts = buildCountsMap(denominations, template.counts);
            const templateTotal = denominations.reduce((sum, denomination) => sum + denomination.value * (templateCounts[denomination.id] ?? 0), 0);
            const nonZeroCount = Object.values(templateCounts).filter((qty) => qty > 0).length;

            return (
              <div key={template.id} className="rounded-[28px] border border-border bg-white/90 p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-primary">
                        <FileStack className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-display text-lg font-black text-foreground">{template.name}</h3>
                        <p className="text-xs text-muted-foreground">{nonZeroCount} denominaciones con cantidad asignada</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={template.is_active ? "default" : "secondary"}>{template.is_active ? "Activa" : "Inactiva"}</Badge>
                      <Badge variant="outline">Total ${templateTotal.toFixed(2)}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => startEdit(template)} className="rounded-xl">
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                    <Button variant="outline" onClick={() => deleteMutation.mutate(template.id)} disabled={deleteMutation.isPending} className="rounded-xl text-destructive hover:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
