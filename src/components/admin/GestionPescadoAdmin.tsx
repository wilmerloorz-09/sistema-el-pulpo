import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate, canView } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type GestionPescadoSection = "sucursales" | "ingreso-salida" | "movimientos" | "historial";

const GRAMOS_POR_LIBRA = 453.59237;
const PESO_BANDEJA_LB = 0.78;
type Unidad = "LIBRAS" | "GRAMOS";

function parseCantidad(raw: string): number {
  const n = Number(String(raw ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function aLibras(cantidad: number, unidad: Unidad): number {
  const lb = unidad === "GRAMOS" ? cantidad / GRAMOS_POR_LIBRA : cantidad;
  return Math.round(lb * 1000) / 1000;
}
function formatLb(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 3 }) : "0";
}
function formatG(valueLb: number | string | null | undefined): string {
  const n = Number(valueLb ?? 0) * GRAMOS_POR_LIBRA;
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 0 }) : "0";
}
function fecha(value: string) {
  return new Date(value).toLocaleString("es-EC");
}

type StockRow = { ambito: string; sucursal_id: string | null; sucursal_nombre: string; cantidad_libras: number };

function UnidadSelect({ value, onChange }: { value: Unidad; onChange: (v: Unidad) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Unidad)}>
      <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="LIBRAS">Libras</SelectItem>
        <SelectItem value="GRAMOS">Gramos</SelectItem>
      </SelectContent>
    </Select>
  );
}

export default function GestionPescadoAdmin({ section }: { section: GestionPescadoSection }) {
  const { branches, activeBranchId, permissions, isGlobalAdmin } = useBranch();
  const qc = useQueryClient();
  const [errorDialog, setErrorDialog] = useState<{ title: string; description: string } | null>(null);

  const mostrarError = (error: any, fallback: string) => {
    const raw = String(error?.message ?? "");
    if (raw.includes("__DIALOG_SHOWN__")) return;
    if (/STOCK_INSUFICIENTE|stock insuficiente|insuficiente en origen/i.test(raw)) {
      setErrorDialog({
        title: "Stock insuficiente",
        description: "No hay suficiente pescado en el origen para realizar este movimiento. Revisa el stock disponible e intenta con un peso menor.",
      });
      return;
    }
    if (/cantidad total debe ser mayor|peso total debe ser mayor/i.test(raw)) {
      setErrorDialog({
        title: "Peso no válido",
        description: "El peso total quedó en cero o negativo después de descontar las bandejas. Revisa el peso y el número de bandejas.",
      });
      return;
    }
    setErrorDialog({ title: "No se pudo completar", description: fallback });
  };

  const errorDialogNode = (
    <AlertDialog open={Boolean(errorDialog)} onOpenChange={(open) => { if (!open) setErrorDialog(null); }}>
      <AlertDialogContent className="rounded-[24px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{errorDialog?.title ?? "Aviso"}</AlertDialogTitle>
          <AlertDialogDescription>{errorDialog?.description ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction className="rounded-2xl" onClick={() => setErrorDialog(null)}>
            Entendido
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const canOperateFull = isGlobalAdmin || canOperate(permissions, "gestion_pescado") || canOperate(permissions, "bodega_general") || canManage(permissions, "admin_global");
  const canMoveFromBranch = canOperateFull || canManage(permissions, "admin_sucursal") || canView(permissions, "gestion_pescado");

  const stockQuery = useQuery({
    queryKey: ["pescado-stock"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("listar_stock_pescado" as any);
      if (error) throw error;
      return ((data as unknown as StockRow[]) ?? []).map((r) => ({ ...r, cantidad_libras: Number(r.cantidad_libras ?? 0) }));
    },
  });

  const historialQuery = useQuery({
    queryKey: ["pescado-historial-completo"],
    queryFn: async () => {
      const [ing, sal, tra, mov] = await Promise.all([
        supabase.from("pescado_ingresos" as any).select("id, origen, cantidad_entregada_lb, cantidad_verificada_lb, merma_lb, cantidad_bandejas, descuento_bandejas_lb, cantidad_total_lb, registrado_por_nombre, observacion, creado_en").order("creado_en", { ascending: false }).limit(60),
        supabase.from("pescado_salidas" as any).select("id, cantidad_lb, motivo, registrado_por_nombre, observacion, creado_en").order("creado_en", { ascending: false }).limit(60),
        supabase.from("pescado_traslados" as any).select("id, desde_ambito, desde_sucursal_id, hasta_ambito, hasta_sucursal_id, cantidad_lb, cantidad_bruta_lb, cantidad_bandejas, descuento_bandejas_lb, cantidad_total_lb, registrado_por_nombre, observacion, creado_en").order("creado_en", { ascending: false }).limit(60),
        supabase.from("pescado_movimientos" as any).select("id, tipo_movimiento, ambito, sucursal_id, cantidad_lb, cantidad_anterior, cantidad_nueva, registrado_por_nombre, notas, creado_en").order("creado_en", { ascending: false }).limit(100),
      ]);
      if (ing.error) throw ing.error;
      if (sal.error) throw sal.error;
      if (tra.error) throw tra.error;
      if (mov.error) throw mov.error;
      return {
        ingresos: (ing.data as unknown as any[]) ?? [],
        salidas: (sal.data as unknown as any[]) ?? [],
        traslados: (tra.data as unknown as any[]) ?? [],
        movimientos: (mov.data as unknown as any[]) ?? [],
      };
    },
    enabled: section === "historial",
  });

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["pescado-stock"] }),
      qc.invalidateQueries({ queryKey: ["pescado-historial-completo"] }),
    ]);
  };

  const branchName = (id: string | null | undefined) => branches.find((b) => b.id === id)?.name ?? "—";
  const ubicacionLabel = (ambito: string, sucursalId: string | null) => ambito === "CENTRAL" ? "Bodega General" : branchName(sucursalId);

  // Ingreso / Salida
  const [tipo, setTipo] = useState<"INGRESO" | "SALIDA">("INGRESO");
  const [origenIngreso, setOrigenIngreso] = useState("PREPARACION_INICIAL");
  const [cantEntregada, setCantEntregada] = useState("");
  const [unidadEntregada, setUnidadEntregada] = useState<Unidad>("LIBRAS");
  const [cantVerificada, setCantVerificada] = useState("");
  const [unidadVerificada, setUnidadVerificada] = useState<Unidad>("LIBRAS");
  const [cantBandejas, setCantBandejas] = useState("");
  const [obsIngreso, setObsIngreso] = useState("");

  const bandejasCount = useMemo(() => {
    const n = Number.parseInt(String(cantBandejas ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [cantBandejas]);
  const verificadaLb = useMemo(
    () => aLibras(parseCantidad(cantVerificada), unidadVerificada),
    [cantVerificada, unidadVerificada],
  );
  const descuentoBandejasLb = Math.round(bandejasCount * PESO_BANDEJA_LB * 1000) / 1000;
  const cantidadTotalLb = Math.round((verificadaLb - descuentoBandejasLb) * 1000) / 1000;
  const [cantSalida, setCantSalida] = useState("");
  const [unidadSalida, setUnidadSalida] = useState<Unidad>("LIBRAS");
  const [motivoSalida, setMotivoSalida] = useState("DANO_PRODUCTO");
  const [obsSalida, setObsSalida] = useState("");

  const ingresoMut = useMutation({
    mutationFn: async () => {
      const entregadaRaw = parseCantidad(cantEntregada);
      const verificadaRaw = parseCantidad(cantVerificada);
      if (!entregadaRaw) throw new Error("Ingresa el peso entregado");
      if (!verificadaRaw) throw new Error("Ingresa el peso verificado");
      if (cantidadTotalLb <= 0) {
        throw new Error(`El peso total debe ser mayor a 0 (verificado ${formatLb(verificadaLb)} lb - bandejas ${formatLb(descuentoBandejasLb)} lb)`);
      }
      const { error } = await supabase.rpc("registrar_ingreso_pescado" as any, {
        p_origen: origenIngreso,
        p_cantidad_entregada_lb: aLibras(entregadaRaw, unidadEntregada),
        p_cantidad_verificada_lb: aLibras(verificadaRaw, unidadVerificada),
        p_observacion: obsIngreso.trim() || null,
        p_cantidad_bandejas: bandejasCount,
      });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Ingreso registrado en Bodega General."); setCantEntregada(""); setCantVerificada(""); setCantBandejas(""); setObsIngreso(""); await invalidateAll(); },
    onError: (e: any) => mostrarError(e, "No se pudo registrar el ingreso. Revisa los datos e inténtalo de nuevo."),
  });

  const salidaMut = useMutation({
    mutationFn: async () => {
      const raw = parseCantidad(cantSalida);
      if (!raw) throw new Error("Ingresa el peso");
      const qtyLb = aLibras(raw, unidadSalida);
      const stockCentralLb = Number(
        (stockQuery.data ?? []).find((r) => r.ambito === "CENTRAL")?.cantidad_libras ?? 0,
      );
      if (qtyLb > stockCentralLb) {
        const dispTxt = unidadSalida === "GRAMOS" ? `${formatG(stockCentralLb)} gramos` : `${formatLb(stockCentralLb)} Libras`;
        const solTxt = unidadSalida === "GRAMOS" ? `${formatG(qtyLb)} gramos` : `${formatLb(qtyLb)} Libras`;
        setErrorDialog({
          title: "Stock insuficiente",
          description: `En Bodega General solo hay ${dispTxt} disponibles y estás intentando retirar ${solTxt}. Ingresa un peso menor.`,
        });
        throw new Error("__DIALOG_SHOWN__");
      }
      const { error } = await supabase.rpc("registrar_salida_pescado" as any, {
        p_cantidad_lb: aLibras(raw, unidadSalida),
        p_motivo: motivoSalida,
        p_observacion: obsSalida.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Salida registrada."); setCantSalida(""); setObsSalida(""); await invalidateAll(); },
    onError: (e: any) => mostrarError(e, "No se pudo registrar la salida. Revisa los datos e inténtalo de nuevo."),
  });

  // Movimientos
  const p1Default = useMemo(() => {
    const p1 = branches.find((b) => /pulpo 1 - ma[ñn]ana/i.test(b.name)) ?? branches.find((b) => /pulpo 1/i.test(b.name)) ?? branches[0];
    return p1?.id ?? "";
  }, [branches]);
  const [desde, setDesde] = useState("CENTRAL");
  const [hasta, setHasta] = useState("");
  const [cantMov, setCantMov] = useState("");
  const [unidadMov, setUnidadMov] = useState<Unidad>("GRAMOS");
  const [cantBandejasMov, setCantBandejasMov] = useState("");
  const [obsMov, setObsMov] = useState("");

  const bandejasMovCount = useMemo(() => {
    const n = Number.parseInt(String(cantBandejasMov ?? "").trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [cantBandejasMov]);
  const movLb = useMemo(() => aLibras(parseCantidad(cantMov), unidadMov), [cantMov, unidadMov]);
  const descuentoBandejasMovLb = Math.round(bandejasMovCount * PESO_BANDEJA_LB * 1000) / 1000;
  const cantidadTotalMovLb = Math.round((movLb - descuentoBandejasMovLb) * 1000) / 1000;

  useEffect(() => {
    if (!hasta && p1Default) setHasta(p1Default);
  }, [hasta, p1Default]);

  const parseUbicacion = (value: string): { ambito: string; sucursalId: string | null } =>
    value === "CENTRAL" ? { ambito: "CENTRAL", sucursalId: null } : { ambito: "SUCURSAL", sucursalId: value };

  const trasladoMut = useMutation({
    mutationFn: async () => {
      if (!desde || !hasta) throw new Error("Selecciona desde y hasta");
      if (desde === hasta) throw new Error("El origen y el destino deben ser diferentes");
      const raw = parseCantidad(cantMov);
      if (!raw) throw new Error("Ingresa el peso");
      if (cantidadTotalMovLb <= 0) {
        throw new Error(`El peso total debe ser mayor a 0 (peso ${formatLb(movLb)} lb - bandejas ${formatLb(descuentoBandejasMovLb)} lb)`);
      }
      const stockOrigenLb = stockDeUbicacion(desde);
      if (cantidadTotalMovLb > stockOrigenLb) {
        const nombreOrigen = ubicaciones.find((u) => u.value === desde)?.label ?? "el origen";
        const dispTxt = unidadMov === "GRAMOS" ? `${formatG(stockOrigenLb)} gramos` : `${formatLb(stockOrigenLb)} Libras`;
        const solTxt = unidadMov === "GRAMOS" ? `${formatG(cantidadTotalMovLb)} gramos` : `${formatLb(cantidadTotalMovLb)} Libras`;
        setErrorDialog({
          title: "Stock insuficiente",
          description: `En ${nombreOrigen} solo hay ${dispTxt} disponibles y estás intentando mover ${solTxt}. Ingresa un peso menor.`,
        });
        throw new Error("__DIALOG_SHOWN__");
      }
      const d = parseUbicacion(desde);
      const h = parseUbicacion(hasta);
      const { error } = await supabase.rpc("trasladar_pescado" as any, {
        p_desde_ambito: d.ambito,
        p_desde_sucursal_id: d.sucursalId,
        p_hasta_ambito: h.ambito,
        p_hasta_sucursal_id: h.sucursalId,
        p_cantidad_lb: aLibras(raw, unidadMov),
        p_observacion: obsMov.trim() || null,
        p_cantidad_bandejas: bandejasMovCount,
      });
      if (error) throw error;
    },
    onSuccess: async () => { toast.success("Movimiento registrado. Stocks actualizados."); setCantMov(""); setCantBandejasMov(""); setObsMov(""); await invalidateAll(); },
    onError: (e: any) => mostrarError(e, "No se pudo registrar el movimiento. Revisa los datos e inténtalo de nuevo."),
  });

  const stockCentral = (stockQuery.data ?? []).find((r) => r.ambito === "CENTRAL");
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data ?? []) {
      if (row.sucursal_id) map.set(row.sucursal_id, row.cantidad_libras);
    }
    return map;
  }, [stockQuery.data]);

  const ubicaciones = useMemo(() => [
    {
      value: "CENTRAL",
      label: "Bodega General",
      stockLb: Number(stockCentral?.cantidad_libras ?? 0),
    },
    ...branches.map((b) => ({
      value: b.id,
      label: b.name,
      stockLb: Number(stockMap.get(b.id) ?? 0),
    })),
  ], [branches, stockCentral?.cantidad_libras, stockMap]);

  const stockDeUbicacion = (value: string): number =>
    ubicaciones.find((u) => u.value === value)?.stockLb ?? 0;

  if (section === "sucursales") {
    return (
      <div className="space-y-4">
        {errorDialogNode}
        <Card className="rounded-[24px] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-4 shadow-sm sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Bodega General</p>
          <p className="mt-1 font-display text-3xl font-black text-sky-950">
            {stockQuery.isLoading ? "…" : formatLb(stockCentral?.cantidad_libras)} <span className="text-base font-semibold text-sky-700">lb</span>
            <span className="ml-2 text-base font-semibold text-muted-foreground">({formatG(stockCentral?.cantidad_libras)} g)</span>
          </p>
        </Card>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Sucursal</th><th className="px-3 py-2">Stock (lb)</th><th className="px-3 py-2">Stock (g)</th><th className="px-3 py-2">Estado</th></tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const qty = stockMap.get(b.id) ?? 0;
                return (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2 font-semibold">{formatLb(qty)}</td>
                    <td className="px-3 py-2">{formatG(qty)}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className={cn(qty > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600")}>{qty > 0 ? "Con stock" : "Sin stock"}</Badge></td>
                  </tr>
                );
              })}
              {branches.length === 0 && <tr><td className="px-3 py-4 text-muted-foreground" colSpan={4}>Sin sucursales.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === "ingreso-salida") {
    if (!canOperateFull) return <p className="text-sm text-muted-foreground">Solo bodega general / administrador puede registrar ingresos y salidas.</p>;
    return (
      <>
        {errorDialogNode}
      <Card className="rounded-[24px] border p-4 space-y-4">
        <div className="space-y-2">
          <Label>Tipo de movimiento</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as "INGRESO" | "SALIDA")}>
            <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="INGRESO">Ingreso</SelectItem><SelectItem value="SALIDA">Salida</SelectItem></SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Aplica a Bodega General.</p>
        </div>

        {tipo === "INGRESO" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Origen</Label>
              <Select value={origenIngreso} onValueChange={setOrigenIngreso}>
                <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="PREPARACION_INICIAL">Preparación inicial</SelectItem><SelectItem value="PREPARACION_EXTRA">Preparación extra</SelectItem><SelectItem value="OTROS">Otros</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Peso entregado</Label><Input inputMode="decimal" value={cantEntregada} onChange={(e) => setCantEntregada(e.target.value)} placeholder="Ej. 25.5" /></div>
              <div className="space-y-2"><Label>Unidad</Label><UnidadSelect value={unidadEntregada} onChange={setUnidadEntregada} /></div>
              <div className="space-y-2"><Label>Peso verificado</Label><Input inputMode="decimal" value={cantVerificada} onChange={(e) => setCantVerificada(e.target.value)} placeholder="Ej. 24.8" /></div>
              <div className="space-y-2"><Label>Unidad</Label><UnidadSelect value={unidadVerificada} onChange={setUnidadVerificada} /></div>
            </div>
            <p className="text-xs text-muted-foreground">El stock de Bodega General aumenta con el peso total (verificado menos bandejas). La diferencia entregado-verificado queda registrada como merma.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cantidad de bandejas</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    disabled={bandejasCount <= 0}
                    onClick={() => setCantBandejas(String(Math.max(0, bandejasCount - 1)))}
                    aria-label="Disminuir bandejas"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    inputMode="numeric"
                    value={cantBandejas}
                    onChange={(e) => setCantBandejas(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="0"
                    className="text-center"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    onClick={() => setCantBandejas(String(bandejasCount + 1))}
                    aria-label="Aumentar bandejas"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Cada bandeja pesa {formatLb(PESO_BANDEJA_LB)} lb (descuento: {formatLb(descuentoBandejasLb)} lb).</p>
              </div>
              <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50 p-3">
                <Label className="text-blue-900">Peso Total</Label>
                <div className="py-1 text-center">
                  {verificadaLb > 0 ? (
                    <span className="font-display text-3xl font-black leading-none text-blue-700">
                      {unidadVerificada === "GRAMOS"
                        ? `${formatG(cantidadTotalLb)} gramos`
                        : `${formatLb(cantidadTotalLb)} Libras`}
                    </span>
                  ) : (
                    <span className="text-lg font-bold text-blue-300">Automático</span>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2"><Label>Observación</Label><Textarea value={obsIngreso} onChange={(e) => setObsIngreso(e.target.value)} rows={2} /></div>
            <Button className="rounded-2xl" disabled={ingresoMut.isPending} onClick={() => ingresoMut.mutate()}>{ingresoMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Registrar ingreso</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Peso</Label><Input inputMode="decimal" value={cantSalida} onChange={(e) => setCantSalida(e.target.value)} /></div>
              <div className="space-y-2"><Label>Unidad</Label><UnidadSelect value={unidadSalida} onChange={setUnidadSalida} /></div>
            </div>
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Select value={motivoSalida} onValueChange={setMotivoSalida}>
                <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="DANO_PRODUCTO">Daño del producto</SelectItem><SelectItem value="OTROS">Otros</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Observación</Label><Textarea value={obsSalida} onChange={(e) => setObsSalida(e.target.value)} rows={2} /></div>
            <Button className="rounded-2xl" disabled={salidaMut.isPending} onClick={() => salidaMut.mutate()}>{salidaMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Registrar salida</Button>
          </div>
        )}
      </Card>
      </>
    );
  }

  if (section === "movimientos") {
    if (!canMoveFromBranch) return <p className="text-sm text-muted-foreground">No tienes permiso para registrar movimientos.</p>;
    return (
      <>
        {errorDialogNode}
      <Card className="rounded-[24px] border p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Desde</Label>
            <Select value={desde} onValueChange={setDesde}><SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger><SelectContent>{ubicaciones.map((u) => (
              <SelectItem key={u.value} value={u.value} disabled={u.stockLb <= 0}>
                {u.label} ({formatLb(u.stockLb)} lb){u.stockLb <= 0 ? " — Sin stock" : ""}
              </SelectItem>
            ))}</SelectContent></Select>
            {stockDeUbicacion(desde) <= 0 && (
              <p className="text-xs text-amber-700">La ubicación seleccionada no tiene stock. Elige otra en “Desde”.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Hasta</Label>
            <Select value={hasta} onValueChange={setHasta}><SelectTrigger className="rounded-2xl"><SelectValue placeholder="Destino…" /></SelectTrigger><SelectContent>{ubicaciones.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-2"><Label>Peso</Label><Input inputMode="decimal" value={cantMov} onChange={(e) => setCantMov(e.target.value)} placeholder="Ej. 500" /></div>
          <div className="space-y-2"><Label>Unidad de medida</Label><UnidadSelect value={unidadMov} onChange={setUnidadMov} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Cantidad de bandejas</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                disabled={bandejasMovCount <= 0}
                onClick={() => setCantBandejasMov(String(Math.max(0, bandejasMovCount - 1)))}
                aria-label="Disminuir bandejas"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                inputMode="numeric"
                value={cantBandejasMov}
                onChange={(e) => setCantBandejasMov(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="0"
                className="text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-xl"
                onClick={() => setCantBandejasMov(String(bandejasMovCount + 1))}
                aria-label="Aumentar bandejas"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Cada bandeja pesa {formatLb(PESO_BANDEJA_LB)} lb (descuento: {formatLb(descuentoBandejasMovLb)} lb).</p>
          </div>
          <div className="space-y-2 rounded-2xl border border-blue-200 bg-blue-50 p-3">
            <Label className="text-blue-900">Peso Total</Label>
            <div className="py-1 text-center">
              {movLb > 0 ? (
                <span className="font-display text-3xl font-black leading-none text-blue-700">
                  {unidadMov === "GRAMOS"
                    ? `${formatG(cantidadTotalMovLb)} gramos`
                    : `${formatLb(cantidadTotalMovLb)} Libras`}
                </span>
              ) : (
                <span className="text-lg font-bold text-blue-300">Automático</span>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-2"><Label>Observación</Label><Textarea value={obsMov} onChange={(e) => setObsMov(e.target.value)} rows={2} /></div>
        <p className="text-xs text-muted-foreground">Se descuenta del origen y se suma al destino. No se permite dejar el origen en negativo.</p>
        {!canOperateFull && <p className="text-xs text-amber-700">Como sucursal, solo puedes mover desde tu sucursal hacia Bodega General (devolución).</p>}
        <Button className="rounded-2xl" disabled={trasladoMut.isPending || stockDeUbicacion(desde) <= 0} onClick={() => trasladoMut.mutate()}>{trasladoMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Registrar movimiento</Button>
      </Card>
      </>
    );
  }

  // historial
  const h = historialQuery.data;
  return (
    <div className="space-y-6">
      {errorDialogNode}
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Ingresos</h3>
        <div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-muted/50 text-xs uppercase"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Origen</th><th className="px-3 py-2">Entregada lb</th><th className="px-3 py-2">Verificada lb</th><th className="px-3 py-2">Bandejas</th><th className="px-3 py-2">Total lb</th><th className="px-3 py-2">Merma lb</th><th className="px-3 py-2">Quién / Obs.</th></tr></thead><tbody>
          {(h?.ingresos ?? []).map((r) => <tr key={r.id} className="border-t"><td className="px-3 py-2">{fecha(r.creado_en)}</td><td className="px-3 py-2">{r.origen === "PREPARACION_INICIAL" ? "Preparación inicial" : r.origen === "PREPARACION_EXTRA" ? "Preparación extra" : "Otros"}</td><td className="px-3 py-2">{formatLb(r.cantidad_entregada_lb)}</td><td className="px-3 py-2">{formatLb(r.cantidad_verificada_lb)}</td><td className="px-3 py-2">{r.cantidad_bandejas ?? 0} ({formatLb(r.descuento_bandejas_lb)} lb)</td><td className="px-3 py-2 font-semibold">{formatLb(r.cantidad_total_lb ?? r.cantidad_verificada_lb)}</td><td className="px-3 py-2">{formatLb(r.merma_lb)}</td><td className="px-3 py-2 text-muted-foreground">{r.registrado_por_nombre ?? "—"}{r.observacion ? ` · ${r.observacion}` : ""}</td></tr>)}
          {(h?.ingresos ?? []).length === 0 && <tr><td className="px-3 py-4 text-muted-foreground" colSpan={8}>Sin ingresos aún.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Salidas</h3>
        <div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-muted/50 text-xs uppercase"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Cantidad lb</th><th className="px-3 py-2">Motivo</th><th className="px-3 py-2">Quién / Obs.</th></tr></thead><tbody>
          {(h?.salidas ?? []).map((r) => <tr key={r.id} className="border-t"><td className="px-3 py-2">{fecha(r.creado_en)}</td><td className="px-3 py-2 font-semibold">{formatLb(r.cantidad_lb)}</td><td className="px-3 py-2">{r.motivo === "DANO_PRODUCTO" ? "Daño del producto" : "Otros"}</td><td className="px-3 py-2 text-muted-foreground">{r.registrado_por_nombre ?? "—"}{r.observacion ? ` · ${r.observacion}` : ""}</td></tr>)}
          {(h?.salidas ?? []).length === 0 && <tr><td className="px-3 py-4 text-muted-foreground" colSpan={4}>Sin salidas aún.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Movimientos entre ubicaciones</h3>
        <div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/50 text-xs uppercase"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Desde</th><th className="px-3 py-2">Hasta</th><th className="px-3 py-2">Bandejas</th><th className="px-3 py-2">Total lb</th><th className="px-3 py-2">Quién / Obs.</th></tr></thead><tbody>
          {(h?.traslados ?? []).map((r) => <tr key={r.id} className="border-t"><td className="px-3 py-2">{fecha(r.creado_en)}</td><td className="px-3 py-2">{ubicacionLabel(r.desde_ambito, r.desde_sucursal_id)}</td><td className="px-3 py-2">{ubicacionLabel(r.hasta_ambito, r.hasta_sucursal_id)}</td><td className="px-3 py-2">{r.cantidad_bandejas ?? 0}</td><td className="px-3 py-2 font-semibold">{formatLb(r.cantidad_total_lb ?? r.cantidad_lb)}</td><td className="px-3 py-2 text-muted-foreground">{r.registrado_por_nombre ?? "—"}{r.observacion ? ` · ${r.observacion}` : ""}</td></tr>)}
          {(h?.traslados ?? []).length === 0 && <tr><td className="px-3 py-4 text-muted-foreground" colSpan={6}>Sin movimientos aún.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Bitácora de stock</h3>
        <div className="overflow-x-auto rounded-2xl border"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/50 text-xs uppercase"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Ámbito</th><th className="px-3 py-2">lb</th><th className="px-3 py-2">Antes → Nueva</th><th className="px-3 py-2">Detalle</th></tr></thead><tbody>
          {(h?.movimientos ?? []).map((m) => <tr key={m.id} className="border-t"><td className="px-3 py-2">{fecha(m.creado_en)}</td><td className="px-3 py-2 font-medium">{m.tipo_movimiento}</td><td className="px-3 py-2">{m.ambito}</td><td className="px-3 py-2">{formatLb(m.cantidad_lb)}</td><td className="px-3 py-2">{formatLb(m.cantidad_anterior)} → {formatLb(m.cantidad_nueva)}</td><td className="px-3 py-2 text-muted-foreground">{m.notas ?? "—"}</td></tr>)}
          {(h?.movimientos ?? []).length === 0 && <tr><td className="px-3 py-4 text-muted-foreground" colSpan={6}>Sin movimientos aún.</td></tr>}
        </tbody></table></div>
      </section>
      {historialQuery.isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando historial…</div>}
    </div>
  );
}
