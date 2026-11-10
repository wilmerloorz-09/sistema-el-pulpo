import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChefHat,
  FilePlus2,
  Fish,
  Hash,
  Layers,
  Loader2,
  Lock,
  LockOpen,
  Minus,
  MoreHorizontal,
  Plus,
  Save,
  Scale,
  Sigma,
  Sparkles,
  Weight,
} from "lucide-react";
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

export type GestionPescadoSection = "sucursales" | "preparacion" | "ingreso-salida" | "movimientos" | "historial";

const GRAMOS_POR_LIBRA = 453.59237;
const PESO_BANDEJA_LB = 0.78;
type Unidad = "LIBRAS" | "GRAMOS";
type BandejaPeso = { id: string; numero: string; peso: string };

type PreparacionBorrador = {
  origenIngreso: string;
  unidadMedida: Unidad;
  cantBonito: string;
  cantAlbacora: string;
  obsIngreso: string;
  bandejasPeso: Array<{ numero: string; peso: string }>;
  preparacionTerminada: boolean;
  ingresoId?: string | null;
  firmaGuardada?: string | null;
  bonitoGuardadoLb?: number;
  albacoraGuardadoLb?: number;
};

const PREPARACION_BORRADOR_KEY = "pescado-preparacion-ultima-v1";

function nuevaBandejaPeso(partial?: Partial<Omit<BandejaPeso, "id">>): BandejaPeso {
  return {
    id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    numero: partial?.numero ?? "",
    peso: partial?.peso ?? "",
  };
}

function leerBorradorPreparacion(): PreparacionBorrador | null {
  try {
    const raw = localStorage.getItem(PREPARACION_BORRADOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreparacionBorrador;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function guardarBorradorPreparacion(draft: PreparacionBorrador) {
  try {
    localStorage.setItem(PREPARACION_BORRADOR_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota / private mode
  }
}

function limpiarBorradorPreparacion() {
  try {
    localStorage.removeItem(PREPARACION_BORRADOR_KEY);
  } catch {
    // ignore
  }
}

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
function formatEnUnidad(valueLb: number | string | null | undefined, unidad: Unidad): string {
  return unidad === "GRAMOS" ? formatG(valueLb) : formatLb(valueLb);
}
function etiquetaUnidad(unidad: Unidad): string {
  return unidad === "GRAMOS" ? "gramos" : "libras";
}
function fecha(value: string) {
  return new Date(value).toLocaleString("es-EC");
}

type StockRow = { ambito: string; sucursal_id: string | null; sucursal_nombre: string; cantidad_libras: number };

const ORIGEN_OPCIONES = [
  {
    value: "PREPARACION_INICIAL",
    label: "Preparación inicial",
    icon: ChefHat,
    iconClass: "text-orange-600",
  },
  {
    value: "PREPARACION_EXTRA",
    label: "Preparación extra",
    icon: Sparkles,
    iconClass: "text-amber-600",
  },
  {
    value: "OTROS",
    label: "Otros",
    icon: MoreHorizontal,
    iconClass: "text-slate-600",
  },
] as const;

const UNIDAD_OPCIONES = [
  {
    value: "LIBRAS" as const,
    label: "Libras",
    icon: Scale,
    iconClass: "text-sky-600",
  },
  {
    value: "GRAMOS" as const,
    label: "Gramos",
    icon: Weight,
    iconClass: "text-violet-600",
  },
];

function SelectOptionRow({
  icon: Icon,
  iconClass,
  label,
}: {
  icon: typeof Scale;
  iconClass: string;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted/80", iconClass)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="truncate font-medium">{label}</span>
    </span>
  );
}

function UnidadSelect({
  value,
  onChange,
  className,
  disabled,
}: {
  value: Unidad;
  onChange: (v: Unidad) => void;
  className?: string;
  disabled?: boolean;
}) {
  const selected = UNIDAD_OPCIONES.find((o) => o.value === value) ?? UNIDAD_OPCIONES[0];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Unidad)} disabled={disabled}>
      <SelectTrigger className={cn("h-9 rounded-xl text-xs", className)}>
        <SelectValue>
          <SelectOptionRow icon={selected.icon} iconClass={selected.iconClass} label={selected.label} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {UNIDAD_OPCIONES.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="py-2">
            <SelectOptionRow icon={opt.icon} iconClass={opt.iconClass} label={opt.label} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const fieldLabelClass = "text-xs font-semibold leading-none text-foreground";
const compactInputClass = "h-10 rounded-xl px-2.5 text-base shadow-none";
const compactSelectClass = "h-10 rounded-xl text-sm";

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

  // Preparación (cocina)
  const isPreparacionSection = section === "preparacion" || section === "ingreso-salida";
  const borradorInicial = useMemo(() => (isPreparacionSection ? leerBorradorPreparacion() : null), [isPreparacionSection]);
  const [origenIngreso, setOrigenIngreso] = useState(
    () => borradorInicial?.origenIngreso ?? "PREPARACION_INICIAL",
  );
  const [bandejasPeso, setBandejasPeso] = useState<BandejaPeso[]>(() => {
    const rows = borradorInicial?.bandejasPeso;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((row) => nuevaBandejaPeso({ numero: String(row.numero ?? ""), peso: String(row.peso ?? "") }));
    }
    return [nuevaBandejaPeso()];
  });
  const [obsIngreso, setObsIngreso] = useState(() => borradorInicial?.obsIngreso ?? "");
  const [unidadMedida, setUnidadMedida] = useState<Unidad>(
    () => (borradorInicial?.unidadMedida === "GRAMOS" ? "GRAMOS" : "LIBRAS"),
  );
  const [cantBonito, setCantBonito] = useState(() => borradorInicial?.cantBonito ?? "");
  const [cantAlbacora, setCantAlbacora] = useState(() => borradorInicial?.cantAlbacora ?? "");
  const [preparacionTerminada, setPreparacionTerminada] = useState(
    () => Boolean(borradorInicial?.preparacionTerminada),
  );
  const [ingresoIdGuardado, setIngresoIdGuardado] = useState<string | null>(
    () => borradorInicial?.ingresoId ?? null,
  );
  const [firmaGuardada, setFirmaGuardada] = useState<string | null>(
    () => borradorInicial?.firmaGuardada ?? null,
  );
  const [bonitoGuardadoLb, setBonitoGuardadoLb] = useState(
    () => Number(borradorInicial?.bonitoGuardadoLb ?? 0),
  );
  const [albacoraGuardadoLb, setAlbacoraGuardadoLb] = useState(
    () => Number(borradorInicial?.albacoraGuardadoLb ?? 0),
  );

  const requierePescadoCrudo =
    origenIngreso === "PREPARACION_INICIAL" || origenIngreso === "PREPARACION_EXTRA";

  const reiniciarPreparacion = () => {
    limpiarBorradorPreparacion();
    setOrigenIngreso("PREPARACION_INICIAL");
    setBandejasPeso([nuevaBandejaPeso()]);
    setObsIngreso("");
    setUnidadMedida("LIBRAS");
    setCantBonito("");
    setCantAlbacora("");
    setPreparacionTerminada(false);
    setIngresoIdGuardado(null);
    setFirmaGuardada(null);
    setBonitoGuardadoLb(0);
    setAlbacoraGuardadoLb(0);
  };

  useEffect(() => {
    if (!isPreparacionSection) return;
    guardarBorradorPreparacion({
      origenIngreso,
      unidadMedida,
      cantBonito,
      cantAlbacora,
      obsIngreso,
      bandejasPeso: bandejasPeso.map((b) => ({ numero: b.numero, peso: b.peso })),
      preparacionTerminada,
      ingresoId: ingresoIdGuardado,
      firmaGuardada,
      bonitoGuardadoLb,
      albacoraGuardadoLb,
    });
  }, [
    isPreparacionSection,
    origenIngreso,
    unidadMedida,
    cantBonito,
    cantAlbacora,
    obsIngreso,
    bandejasPeso,
    preparacionTerminada,
    ingresoIdGuardado,
    firmaGuardada,
    bonitoGuardadoLb,
    albacoraGuardadoLb,
  ]);

  const stockFrescoQuery = useQuery({
    queryKey: ["stock-pescado-fresco"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("listar_stock_pescado_fresco" as any);
      if (error) throw error;
      return ((data as Array<{ producto_id: string; codigo: string; nombre: string; cantidad_lb: number }>) ?? [])
        .map((r) => ({ ...r, cantidad_lb: Number(r.cantidad_lb ?? 0) }));
    },
    enabled: isPreparacionSection,
  });

  const stockBonitoLb = useMemo(
    () => Number(stockFrescoQuery.data?.find((r) => r.codigo === "BONITO")?.cantidad_lb ?? 0),
    [stockFrescoQuery.data],
  );
  const stockAlbacoraLb = useMemo(
    () => Number(stockFrescoQuery.data?.find((r) => r.codigo === "ALBACORA")?.cantidad_lb ?? 0),
    [stockFrescoQuery.data],
  );
  // Si ya guardamos esta misma preparación, el stock actual ya descontó ese crudo:
  // para re-guardar/actualizar se considera disponible = stock actual + lo ya usado en esta prep.
  const stockBonitoDisponibleLb = stockBonitoLb + (ingresoIdGuardado ? Math.max(0, bonitoGuardadoLb) : 0);
  const stockAlbacoraDisponibleLb = stockAlbacoraLb + (ingresoIdGuardado ? Math.max(0, albacoraGuardadoLb) : 0);

  const bonitoLb = useMemo(
    () => aLibras(parseCantidad(cantBonito) || 0, unidadMedida),
    [cantBonito, unidadMedida],
  );
  const albacoraLb = useMemo(
    () => aLibras(parseCantidad(cantAlbacora) || 0, unidadMedida),
    [cantAlbacora, unidadMedida],
  );
  const crudoTotalLb = Math.round((bonitoLb + albacoraLb) * 1000) / 1000;
  const pesosBandejasLb = useMemo(
    () => bandejasPeso.map((b) => aLibras(parseCantidad(b.peso), unidadMedida)),
    [bandejasPeso, unidadMedida],
  );
  const bandejasCount = pesosBandejasLb.filter((n) => n > 0).length;
  const cantidadTotalLb = useMemo(
    () => Math.round(pesosBandejasLb.reduce((s, n) => s + n, 0) * 1000) / 1000,
    [pesosBandejasLb],
  );

  const preparacionFirmaActual = useMemo(
    () =>
      JSON.stringify({
        origenIngreso,
        unidadMedida,
        cantBonito: cantBonito.trim(),
        cantAlbacora: cantAlbacora.trim(),
        obsIngreso: obsIngreso.trim(),
        bandejas: bandejasPeso.map((b) => ({ numero: b.numero.trim(), peso: b.peso.trim() })),
      }),
    [origenIngreso, unidadMedida, cantBonito, cantAlbacora, obsIngreso, bandejasPeso],
  );

  // Si el borrador ya tiene datos pero no el id del ingreso (versión anterior),
  // intenta enlazar con el último ingreso coincidente para no descontar de nuevo.
  useEffect(() => {
    if (!isPreparacionSection || ingresoIdGuardado) return;
    if (!cantBonito.trim() && !cantAlbacora.trim()) return;
    if (cantidadTotalLb <= 0) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("pescado_ingresos" as any)
        .select("id, origen, bonito_lb, albacora_lb, cantidad_total_lb")
        .order("creado_en", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const row = data as {
        id: string;
        origen: string;
        bonito_lb: number | null;
        albacora_lb: number | null;
        cantidad_total_lb: number | null;
      };
      if (row.origen !== origenIngreso) return;
      const b = Math.round(Number(row.bonito_lb ?? 0) * 1000) / 1000;
      const a = Math.round(Number(row.albacora_lb ?? 0) * 1000) / 1000;
      const total = Math.round(Number(row.cantidad_total_lb ?? 0) * 1000) / 1000;
      if (b !== Math.round(bonitoLb * 1000) / 1000) return;
      if (a !== Math.round(albacoraLb * 1000) / 1000) return;
      if (total !== Math.round(cantidadTotalLb * 1000) / 1000) return;
      setIngresoIdGuardado(row.id);
      setBonitoGuardadoLb(b);
      setAlbacoraGuardadoLb(a);
      setFirmaGuardada(preparacionFirmaActual);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    isPreparacionSection,
    ingresoIdGuardado,
    origenIngreso,
    cantBonito,
    cantAlbacora,
    bonitoLb,
    albacoraLb,
    cantidadTotalLb,
    preparacionFirmaActual,
  ]);

  const ingresoMut = useMutation({
    mutationFn: async () => {
      if (preparacionTerminada) {
        throw new Error("La preparación está terminada. Edítala para guardar cambios.");
      }
      if (bandejasExistentesTotal <= 0) {
        throw new Error("Configura primero la cantidad de bandejas existentes en Sucursales");
      }
      if (bandejasPeso.some((b) => !b.numero.trim() || !parseCantidad(b.peso))) {
        throw new Error("Todas las bandejas deben tener número y peso mayor a 0");
      }
      const numeros = bandejasPeso.map((b) => b.numero.trim());
      if (new Set(numeros).size !== numeros.length) {
        throw new Error("Hay números de bandeja repetidos");
      }
      if (numeros.some((n) => !numerosBandejaCatalogo.includes(n))) {
        throw new Error("Hay bandejas fuera del catálogo configurado en Sucursales");
      }
      if (bandejasCount <= 0 || cantidadTotalLb <= 0) {
        throw new Error("Agrega al menos una bandeja con número y peso");
      }

      let bonito = 0;
      let albacora = 0;
      if (requierePescadoCrudo) {
        bonito = Math.round(bonitoLb * 1000) / 1000;
        albacora = Math.round(albacoraLb * 1000) / 1000;
        const crudo = Math.round((bonito + albacora) * 1000) / 1000;
        if (crudo <= 0) {
          throw new Error("Ingresa la cantidad de pescado crudo (Bonito y/o Albacora)");
        }
        if (bonito > stockBonitoDisponibleLb) {
          throw new Error(
            `Stock insuficiente de Bonito: hay ${formatLb(stockBonitoDisponibleLb)} lb y se solicitan ${formatLb(bonito)} lb`,
          );
        }
        if (albacora > stockAlbacoraDisponibleLb) {
          throw new Error(
            `Stock insuficiente de Albacora: hay ${formatLb(stockAlbacoraDisponibleLb)} lb y se solicitan ${formatLb(albacora)} lb`,
          );
        }
        if (crudo <= cantidadTotalLb) {
          throw new Error(
            `El pescado crudo (${formatLb(crudo)} lb) debe ser mayor que el total de bandejas (${formatLb(cantidadTotalLb)} lb)`,
          );
        }
      }

      // Misma preparación sin cambios: no volver a descontar stock.
      if (ingresoIdGuardado && firmaGuardada === preparacionFirmaActual) {
        return { id: ingresoIdGuardado, modo: "noop" as const, bonito, albacora };
      }

      const detalleBandejas = bandejasPeso
        .map((b) => `#${b.numero.trim()} ${formatLb(aLibras(parseCantidad(b.peso), unidadMedida))} lb`)
        .join(", ");
      const observacion = [obsIngreso.trim() || null, detalleBandejas ? `Bandejas: ${detalleBandejas}` : null]
        .filter(Boolean)
        .join(" | ");

      const payload = {
        p_origen: origenIngreso,
        p_cantidad_entregada_lb: cantidadTotalLb,
        p_cantidad_verificada_lb: cantidadTotalLb,
        p_observacion: observacion || null,
        p_cantidad_bandejas: bandejasCount,
        p_bonito_lb: requierePescadoCrudo ? bonito : 0,
        p_albacora_lb: requierePescadoCrudo ? albacora : 0,
        p_pesos_bandejas_lb: pesosBandejasLb,
      };

      if (ingresoIdGuardado) {
        const { data, error } = await supabase.rpc("actualizar_ingreso_pescado" as any, {
          p_ingreso_id: ingresoIdGuardado,
          ...payload,
        });
        if (error) throw error;
        return { id: String(data ?? ingresoIdGuardado), modo: "update" as const, bonito, albacora };
      }

      const { data, error } = await supabase.rpc("registrar_ingreso_pescado" as any, payload);
      if (error) throw error;
      return { id: String(data), modo: "create" as const, bonito, albacora };
    },
    onSuccess: async (result) => {
      if (result?.id) setIngresoIdGuardado(result.id);
      setFirmaGuardada(preparacionFirmaActual);
      setBonitoGuardadoLb(Number(result?.bonito ?? 0));
      setAlbacoraGuardadoLb(Number(result?.albacora ?? 0));
      if (result?.modo !== "noop") {
        await invalidateAll();
        await qc.invalidateQueries({ queryKey: ["stock-pescado-fresco"] });
        await qc.invalidateQueries({ queryKey: ["historial-pescado-fresco"] });
      }
    },
    onError: (e: any) => mostrarError(e, "No se pudo guardar la preparación. Revisa los datos e inténtalo de nuevo."),
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

  const bandejasExistentesQuery = useQuery({
    queryKey: ["pescado-bandejas-existentes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obtener_bandejas_existentes_pescado" as any);
      if (error) throw error;
      return Number(data ?? 0);
    },
    enabled: section === "sucursales" || isPreparacionSection,
  });
  const bandejasExistentesTotal = useMemo(() => {
    const n = Number(bandejasExistentesQuery.data ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }, [bandejasExistentesQuery.data]);
  const numerosBandejaCatalogo = useMemo(
    () => Array.from({ length: bandejasExistentesTotal }, (_, i) => String(i + 1)),
    [bandejasExistentesTotal],
  );
  const numerosBandejaUsados = useMemo(
    () => new Set(bandejasPeso.map((b) => b.numero.trim()).filter(Boolean)),
    [bandejasPeso],
  );
  const opcionesBandejaParaFila = (filaId: string, numeroActual: string) =>
    numerosBandejaCatalogo.filter((n) => n === numeroActual.trim() || !numerosBandejaUsados.has(n));
  const [bandejasExistentesInput, setBandejasExistentesInput] = useState("");
  useEffect(() => {
    if (bandejasExistentesQuery.data == null || !Number.isFinite(bandejasExistentesQuery.data)) return;
    setBandejasExistentesInput(String(bandejasExistentesQuery.data));
  }, [bandejasExistentesQuery.data]);

  const guardarBandejasExistentesMut = useMutation({
    mutationFn: async () => {
      const n = Number.parseInt(String(bandejasExistentesInput ?? "").trim(), 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error("Ingresa un número de bandejas válido (0 o más)");
      }
      const { data, error } = await supabase.rpc("actualizar_bandejas_existentes_pescado" as any, {
        p_cantidad: n,
      });
      if (error) throw error;
      return Number(data ?? n);
    },
    onSuccess: async (n) => {
      toast.success(`Bandejas existentes actualizadas: ${n}`);
      setBandejasExistentesInput(String(n));
      await qc.invalidateQueries({ queryKey: ["pescado-bandejas-existentes"] });
    },
    onError: (e: any) => mostrarError(e, "No se pudo guardar la cantidad de bandejas."),
  });

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

  const motivoBloqueoGuardar = useMemo(() => {
    if (!isPreparacionSection || !canOperateFull) return "Sin permiso para guardar preparación.";
    if (preparacionTerminada) return "La preparación está terminada. Edítala para guardar.";
    if (bandejasExistentesTotal <= 0) return "Configura la cantidad de bandejas en Sucursales.";
    if (bandejasPeso.length === 0) return "Agrega al menos una bandeja.";
    if (bandejasPeso.some((b) => !b.numero.trim() || !parseCantidad(b.peso))) {
      return "Completa bandeja y peso en todas las filas.";
    }
    const numeros = bandejasPeso.map((b) => b.numero.trim());
    if (new Set(numeros).size !== numeros.length) return "Hay números de bandeja repetidos.";
    if (numeros.some((n) => !numerosBandejaCatalogo.includes(n))) {
      return "Hay bandejas fuera del catálogo configurado.";
    }
    if (bandejasCount <= 0 || cantidadTotalLb <= 0) return "El peso total de bandejas debe ser mayor a 0.";
    if (requierePescadoCrudo) {
      if (crudoTotalLb <= 0) return "Ingresa pescado crudo (Bonito y/o Albacora).";
      if (bonitoLb > stockBonitoDisponibleLb) {
        return `Stock insuficiente de Bonito: hay ${formatEnUnidad(stockBonitoDisponibleLb, unidadMedida)} ${etiquetaUnidad(unidadMedida)} y pediste ${formatEnUnidad(bonitoLb, unidadMedida)}.`;
      }
      if (albacoraLb > stockAlbacoraDisponibleLb) {
        return `Stock insuficiente de Albacora: hay ${formatEnUnidad(stockAlbacoraDisponibleLb, unidadMedida)} ${etiquetaUnidad(unidadMedida)} y pediste ${formatEnUnidad(albacoraLb, unidadMedida)}.`;
      }
      if (crudoTotalLb <= cantidadTotalLb) {
        return `El pescado crudo (${formatEnUnidad(crudoTotalLb, unidadMedida)}) debe ser mayor que el total de bandejas (${formatEnUnidad(cantidadTotalLb, unidadMedida)}).`;
      }
    }
    return null;
  }, [
    isPreparacionSection,
    canOperateFull,
    preparacionTerminada,
    bandejasExistentesTotal,
    bandejasPeso,
    numerosBandejaCatalogo,
    bandejasCount,
    cantidadTotalLb,
    requierePescadoCrudo,
    crudoTotalLb,
    bonitoLb,
    albacoraLb,
    stockBonitoDisponibleLb,
    stockAlbacoraDisponibleLb,
    unidadMedida,
  ]);

  if (section === "sucursales") {
    return (
      <div className="space-y-4">
        {errorDialogNode}
        <Card className="rounded-[24px] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Bodega General</p>
              <p className="mt-1 font-display text-3xl font-black text-sky-950">
                {stockQuery.isLoading ? "…" : formatLb(stockCentral?.cantidad_libras)} <span className="text-base font-semibold text-sky-700">lb</span>
                <span className="ml-2 text-base font-semibold text-muted-foreground">({formatG(stockCentral?.cantidad_libras)} g)</span>
              </p>
            </div>
            <div className="w-[7.25rem] shrink-0 space-y-1">
              <Label className="inline-flex items-center gap-1 text-[10px] font-semibold leading-none text-sky-900">
                <Hash className="h-3 w-3" />
                Bandejas
              </Label>
              <div className="flex items-center gap-1">
                <Input
                  inputMode="numeric"
                  value={bandejasExistentesInput}
                  disabled={!canOperateFull || bandejasExistentesQuery.isLoading || guardarBandejasExistentesMut.isPending}
                  onChange={(e) => setBandejasExistentesInput(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="0"
                  className="h-8 w-14 rounded-lg border-sky-200 bg-white/90 px-2 text-center text-sm"
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 rounded-lg bg-sky-600 text-white shadow-sm hover:bg-sky-700"
                  disabled={!canOperateFull || guardarBandejasExistentesMut.isPending || bandejasExistentesQuery.isLoading}
                  onClick={() => guardarBandejasExistentesMut.mutate()}
                  aria-label="Guardar bandejas existentes"
                  title="Guardar"
                >
                  {guardarBandejasExistentesMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  )}
                </Button>
              </div>
            </div>
          </div>
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

  if (isPreparacionSection) {
    if (!canOperateFull) {
      return (
        <p className="text-xs text-muted-foreground">
          Solo bodega general / administrador puede registrar la preparación.
        </p>
      );
    }
    const origenSeleccionado = ORIGEN_OPCIONES.find((o) => o.value === origenIngreso) ?? ORIGEN_OPCIONES[0];
    const formulariosBloqueados = preparacionTerminada;
    return (
      <>
        {errorDialogNode}
        <Card className="space-y-2.5 rounded-xl border p-3">
          {formulariosBloqueados ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">
              <Lock className="h-3.5 w-3.5" />
              Preparación terminada: sin cambios hasta editarla o crear una nueva.
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className={fieldLabelClass}>Origen</Label>
              <Select
                value={origenIngreso}
                disabled={formulariosBloqueados}
                onValueChange={(v) => {
                  setOrigenIngreso(v);
                  if (v === "OTROS") {
                    setCantBonito("");
                    setCantAlbacora("");
                  }
                }}
              >
                <SelectTrigger className={compactSelectClass}>
                  <SelectValue>
                    <SelectOptionRow
                      icon={origenSeleccionado.icon}
                      iconClass={origenSeleccionado.iconClass}
                      label={origenSeleccionado.label}
                    />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ORIGEN_OPCIONES.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="py-2">
                      <SelectOptionRow icon={opt.icon} iconClass={opt.iconClass} label={opt.label} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className={fieldLabelClass}>Unidad de medida</Label>
              <UnidadSelect value={unidadMedida} onChange={setUnidadMedida} disabled={formulariosBloqueados} />
            </div>
          </div>

          <div
            className={cn(
              "space-y-2.5 rounded-xl border p-2.5",
              requierePescadoCrudo ? "border-cyan-200 bg-cyan-50/60" : "border-border/60 bg-muted/20 opacity-70",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-100 text-cyan-700">
                <Fish className="h-4 w-4" />
              </span>
              <Label className="text-sm font-semibold text-foreground">Pescado crudo</Label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="inline-flex flex-wrap items-center gap-1 text-xs font-semibold leading-snug text-foreground">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700">
                    <Fish className="h-3 w-3" />
                  </span>
                  <span>
                    Bonito{" "}
                    <span className="font-medium text-sky-700">
                      ({formatEnUnidad(stockBonitoDisponibleLb, unidadMedida)}{" "}
                      {unidadMedida === "GRAMOS" ? "g" : "lb"})
                    </span>
                  </span>
                </Label>
                <Input
                  inputMode="decimal"
                  value={cantBonito}
                  disabled={formulariosBloqueados || !requierePescadoCrudo}
                  onChange={(e) => setCantBonito(e.target.value)}
                  placeholder="0"
                  className={compactInputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="inline-flex flex-wrap items-center gap-1 text-xs font-semibold leading-snug text-foreground">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-700">
                    <Fish className="h-3 w-3" />
                  </span>
                  <span>
                    Albacora{" "}
                    <span className="font-medium text-teal-700">
                      ({formatEnUnidad(stockAlbacoraDisponibleLb, unidadMedida)}{" "}
                      {unidadMedida === "GRAMOS" ? "g" : "lb"})
                    </span>
                  </span>
                </Label>
                <Input
                  inputMode="decimal"
                  value={cantAlbacora}
                  disabled={formulariosBloqueados || !requierePescadoCrudo}
                  onChange={(e) => setCantAlbacora(e.target.value)}
                  placeholder="0"
                  className={compactInputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="inline-flex items-center gap-1 text-xs font-semibold leading-snug text-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">
                    <Sigma className="h-3 w-3" />
                  </span>
                  Total
                </Label>
                <div
                  className={cn(
                    compactInputClass,
                    "flex items-center justify-center border border-indigo-200 bg-indigo-50/80 font-semibold text-indigo-900",
                  )}
                  aria-live="polite"
                >
                  {requierePescadoCrudo && crudoTotalLb > 0
                    ? formatEnUnidad(crudoTotalLb, unidadMedida)
                    : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl border border-orange-200/80 bg-gradient-to-br from-orange-50/80 via-amber-50/30 to-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-100 text-orange-700">
                  <Layers className="h-3.5 w-3.5" />
                </span>
                <Label className={fieldLabelClass}>Bandejas cocinadas</Label>
              </div>
              <span className="rounded-full border border-orange-200 bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-orange-900">
                {bandejasPeso.length}/{bandejasExistentesTotal || "—"}
              </span>
            </div>

            {bandejasExistentesTotal <= 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                Configura la cantidad de bandejas existentes en la pestaña Sucursales.
              </p>
            ) : null}

            <div className="grid grid-cols-[8.75rem_minmax(0,1fr)] items-start gap-2.5">
              <div className="space-y-2">
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                  <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50/90 px-2.5 py-1.5">
                    <Scale className="h-3.5 w-3.5 text-slate-500" />
                    <p className="text-[10px] font-semibold tracking-wide text-slate-600">Peso total</p>
                  </div>
                  <div className="px-2.5 py-2.5 text-center">
                    <p className="font-display text-xl font-black leading-none tracking-tight text-slate-900">
                      {cantidadTotalLb > 0 ? formatEnUnidad(cantidadTotalLb, unidadMedida) : "—"}
                    </p>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                      {etiquetaUnidad(unidadMedida)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  className="h-9 w-full gap-1.5 rounded-xl bg-orange-500 text-xs font-semibold text-white shadow-sm hover:bg-orange-600 disabled:bg-orange-200"
                  disabled={
                    formulariosBloqueados
                    || bandejasExistentesTotal <= 0
                    || bandejasPeso.length >= bandejasExistentesTotal
                  }
                  onClick={() => {
                    if (formulariosBloqueados) return;
                    if (bandejasExistentesTotal <= 0) {
                      toast.error("Configura primero las bandejas en Sucursales");
                      return;
                    }
                    if (bandejasPeso.length >= bandejasExistentesTotal) {
                      toast.error("Ya agregaste todas las bandejas disponibles");
                      return;
                    }
                    setBandejasPeso((rows) => [...rows, nuevaBandejaPeso()]);
                  }}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                  Agregar
                </Button>
              </div>

              <div className="min-w-0 space-y-1.5 rounded-2xl border border-orange-200/70 bg-white/90 p-2 shadow-sm">
                <div className="grid grid-cols-[minmax(9.5rem,1.25fr)_minmax(4.5rem,0.75fr)_2rem] items-center gap-1.5 px-0.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                    <Hash className="h-3 w-3 text-orange-600" />
                    Bandeja
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                    <Scale className="h-3 w-3 text-orange-600" />
                    Peso
                  </span>
                  <span />
                </div>
                {bandejasPeso.map((bandeja) => {
                  const opciones = opcionesBandejaParaFila(bandeja.id, bandeja.numero);
                  return (
                    <div
                      key={bandeja.id}
                      className="grid grid-cols-[minmax(9.5rem,1.25fr)_minmax(4.5rem,0.75fr)_2rem] items-center gap-1.5"
                    >
                      <Select
                        value={bandeja.numero || undefined}
                        onValueChange={(value) => {
                          setBandejasPeso((rows) =>
                            rows.map((row) => (row.id === bandeja.id ? { ...row, numero: value } : row)),
                          );
                        }}
                        disabled={formulariosBloqueados || bandejasExistentesTotal <= 0}
                      >
                        <SelectTrigger className="h-9 rounded-xl px-2 text-xs" aria-label="Bandeja">
                          <SelectValue placeholder="Elegir bandeja" />
                        </SelectTrigger>
                        <SelectContent>
                          {opciones.map((n) => (
                            <SelectItem key={n} value={n} className="py-2">
                              <span className="flex items-center gap-2">
                                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-orange-100 text-[10px] font-bold text-orange-800">
                                  {n}
                                </span>
                                Bandeja {n}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        value={bandeja.peso}
                        disabled={formulariosBloqueados}
                        onChange={(e) => {
                          const value = e.target.value;
                          setBandejasPeso((rows) =>
                            rows.map((row) => (row.id === bandeja.id ? { ...row, peso: value } : row)),
                          );
                        }}
                        placeholder="0"
                        className="h-9 rounded-xl px-2 text-sm shadow-none"
                        aria-label="Peso de bandeja"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-8 rounded-xl border-orange-200 text-orange-700 hover:bg-orange-50"
                        disabled={formulariosBloqueados || bandejasPeso.length <= 1}
                        onClick={() => setBandejasPeso((rows) => rows.filter((row) => row.id !== bandeja.id))}
                        aria-label={`Quitar bandeja ${bandeja.numero || ""}`}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className={fieldLabelClass}>Observación</Label>
            <Textarea
              value={obsIngreso}
              disabled={formulariosBloqueados}
              onChange={(e) => setObsIngreso(e.target.value)}
              rows={2}
              className="min-h-[52px] rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button
              className="h-10 gap-1.5 rounded-xl text-sm"
              disabled={preparacionTerminada || ingresoMut.isPending}
              onClick={() => {
                if (motivoBloqueoGuardar) {
                  const esStock = /stock insuficiente/i.test(motivoBloqueoGuardar);
                  setErrorDialog({
                    title: esStock ? "Stock insuficiente" : "No se puede guardar",
                    description: motivoBloqueoGuardar,
                  });
                  return;
                }
                ingresoMut.mutate(undefined, {
                  onSuccess: (result) => {
                    toast.success(
                      result?.modo === "noop"
                        ? "Esta preparación ya estaba guardada."
                        : result?.modo === "update"
                          ? "Preparación actualizada."
                          : "Preparación guardada.",
                    );
                  },
                });
              }}
            >
              {ingresoMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-10 gap-1.5 rounded-xl text-sm",
                preparacionTerminada
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
                  : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100",
              )}
              disabled={!preparacionTerminada && ingresoMut.isPending}
              onClick={() => {
                if (preparacionTerminada) {
                  setPreparacionTerminada(false);
                  return;
                }
                if (motivoBloqueoGuardar) {
                  const esStock = /stock insuficiente/i.test(motivoBloqueoGuardar);
                  setErrorDialog({
                    title: esStock ? "Stock insuficiente" : "No se puede terminar",
                    description: motivoBloqueoGuardar,
                  });
                  return;
                }
                ingresoMut.mutate(undefined, {
                  onSuccess: (result) => {
                    setPreparacionTerminada(true);
                    toast.success(
                      result?.modo === "noop"
                        ? "Preparación terminada."
                        : "Preparación guardada y terminada.",
                    );
                  },
                });
              }}
            >
              {preparacionTerminada ? (
                <>
                  <LockOpen className="h-4 w-4" />
                  Editar preparación
                </>
              ) : ingresoMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Terminar preparación
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 gap-1.5 rounded-xl border-sky-300 bg-sky-50 text-sm text-sky-900 hover:bg-sky-100 disabled:opacity-50"
              disabled={!preparacionTerminada}
              onClick={() => {
                reiniciarPreparacion();
                toast.success("Nueva preparación lista.");
              }}
            >
              <FilePlus2 className="h-4 w-4" />
              Nueva preparación
            </Button>
          </div>
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
