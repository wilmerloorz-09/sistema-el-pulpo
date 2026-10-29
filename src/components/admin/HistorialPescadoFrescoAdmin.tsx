import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Scale,
  Search,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type HistorialDetalle = {
  id: string;
  cantidadLb: number;
  productoNombre: string;
};

type HistorialRow = {
  id: string;
  tipo: "compra" | "movimiento";
  titulo: string;
  subtitulo: string;
  fecha: string;
  totalLabel: string;
  registradoPorNombre: string;
  creadoEn: string;
  observaciones: string | null;
  detalle: HistorialDetalle[];
  tipoMovimiento?: string;
};

function formatFecha(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatFechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLb(value: number): string {
  return value.toLocaleString("es-EC", { maximumFractionDigits: 3 });
}

function etiquetaTipo(tipo?: string) {
  if (tipo === "COMPRA") return "Compra";
  if (tipo === "INGRESO") return "Ingreso";
  if (tipo === "SALIDA") return "Salida";
  if (tipo === "AJUSTE") return "Ajuste";
  return tipo ?? "Movimiento";
}

const HistorialPescadoFrescoAdmin = () => {
  const [busqueda, setBusqueda] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const historialQuery = useQuery({
    queryKey: ["historial-pescado-fresco"],
    queryFn: async (): Promise<HistorialRow[]> => {
      const [comprasRes, movsRes] = await Promise.all([
        supabase
          .from("pescado_fresco_compras" as any)
          .select(`
            id,
            numero_comprobante,
            fecha_compra,
            observaciones,
            registrado_por_nombre,
            creado_en,
            proveedores ( nombre, ruc_cedula ),
            pescado_fresco_compras_detalle (
              id,
              cantidad_lb,
              pescado_fresco_productos ( nombre )
            )
          `)
          .order("fecha_compra", { ascending: false })
          .order("creado_en", { ascending: false })
          .limit(100),
        supabase
          .from("pescado_fresco_movimientos" as any)
          .select(`
            id,
            tipo_movimiento,
            cantidad_lb,
            cantidad_anterior,
            cantidad_nueva,
            motivo,
            compra_id,
            registrado_por_nombre,
            creado_en,
            pescado_fresco_productos ( nombre )
          `)
          .neq("tipo_movimiento", "COMPRA")
          .order("creado_en", { ascending: false })
          .limit(100),
      ]);

      if (comprasRes.error) throw comprasRes.error;
      if (movsRes.error) throw movsRes.error;

      const compras: HistorialRow[] = ((comprasRes.data as any[]) ?? []).map((row) => {
        const detalle = ((row.pescado_fresco_compras_detalle as any[]) ?? []).map((d) => ({
          id: d.id,
          cantidadLb: Number(d.cantidad_lb ?? 0),
          productoNombre:
            (d.pescado_fresco_productos as { nombre: string } | null)?.nombre ?? "Producto",
        }));
        const totalLb = detalle.reduce((acc, d) => acc + d.cantidadLb, 0);
        return {
          id: `compra-${row.id}`,
          tipo: "compra" as const,
          titulo: (row.proveedores as { nombre: string } | null)?.nombre ?? "Proveedor",
          subtitulo: `Factura ${row.numero_comprobante}${
            (row.proveedores as { ruc_cedula: string } | null)?.ruc_cedula
              ? ` · RUC ${(row.proveedores as { ruc_cedula: string }).ruc_cedula}`
              : ""
          }`,
          fecha: row.fecha_compra,
          totalLabel: `${formatLb(totalLb)} lb`,
          registradoPorNombre: row.registrado_por_nombre,
          creadoEn: row.creado_en,
          observaciones: row.observaciones,
          detalle,
        };
      });

      const movimientos: HistorialRow[] = ((movsRes.data as any[]) ?? []).map((row) => ({
        id: `mov-${row.id}`,
        tipo: "movimiento" as const,
        tipoMovimiento: row.tipo_movimiento,
        titulo: (row.pescado_fresco_productos as { nombre: string } | null)?.nombre ?? "Producto",
        subtitulo: row.motivo || etiquetaTipo(row.tipo_movimiento),
        fecha: String(row.creado_en).slice(0, 10),
        totalLabel: `${formatLb(Number(row.cantidad_lb ?? 0))} lb`,
        registradoPorNombre: row.registrado_por_nombre ?? "Usuario",
        creadoEn: row.creado_en,
        observaciones: `Antes ${formatLb(Number(row.cantidad_anterior ?? 0))} → ${formatLb(Number(row.cantidad_nueva ?? 0))} lb`,
        detalle: [
          {
            id: row.id,
            cantidadLb: Number(row.cantidad_lb ?? 0),
            productoNombre:
              (row.pescado_fresco_productos as { nombre: string } | null)?.nombre ?? "Producto",
          },
        ],
      }));

      return [...compras, ...movimientos].sort((a, b) => {
        const fechaCmp = b.fecha.localeCompare(a.fecha);
        if (fechaCmp !== 0) return fechaCmp;
        return b.creadoEn.localeCompare(a.creadoEn);
      });
    },
  });

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const rows = historialQuery.data ?? [];
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.titulo.toLowerCase().includes(q)
        || row.subtitulo.toLowerCase().includes(q)
        || row.detalle.some((d) => d.productoNombre.toLowerCase().includes(q)),
    );
  }, [busqueda, historialQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-200 bg-white text-indigo-700 shadow-sm">
          <History className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Historial de movimientos</h2>
          <p className="text-xs text-muted-foreground">
            Compras y ajustes de pescado fresco
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por proveedor, factura o producto..."
          className="h-10 rounded-xl border-border/80 pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60">
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold text-foreground">Movimientos registrados</h3>
          <span className="text-[11px] text-muted-foreground">({filas.length})</span>
        </div>

        {historialQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : historialQuery.isError ? (
          <div className="p-4 text-sm text-destructive">
            {(historialQuery.error as Error)?.message || "No se pudo cargar el historial"}
          </div>
        ) : filas.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No hay compras ni ajustes registrados todavía.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filas.map((row) => {
              const isOpen = Boolean(expanded[row.id]);
              return (
                <div key={row.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-muted/20"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [row.id]: !prev[row.id] }))
                    }
                  >
                    {isOpen ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{row.titulo}</p>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-lg text-[10px] font-bold",
                            row.tipo === "compra"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : row.tipoMovimiento === "AJUSTE"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : row.tipoMovimiento === "SALIDA"
                                  ? "border-rose-200 bg-rose-50 text-rose-800"
                                  : "border-sky-200 bg-sky-50 text-sky-800",
                          )}
                        >
                          {row.tipo === "compra" ? (
                            <span className="inline-flex items-center gap-1">
                              <ShoppingCart className="h-3 w-3" /> Compra
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Scale className="h-3 w-3" /> {etiquetaTipo(row.tipoMovimiento)}
                            </span>
                          )}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{row.subtitulo}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {formatFecha(row.fecha)} · {formatFechaHora(row.creadoEn)} ·{" "}
                        {row.registradoPorNombre}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                      {row.totalLabel}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="space-y-2 bg-muted/10 px-4 pb-3 pl-10">
                      {row.observaciones ? (
                        <p className="text-xs text-muted-foreground">{row.observaciones}</p>
                      ) : null}
                      <ul className="space-y-1">
                        {row.detalle.map((d) => (
                          <li
                            key={d.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-foreground">{d.productoNombre}</span>
                            <span className="font-semibold tabular-nums">
                              {formatLb(d.cantidadLb)} lb
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistorialPescadoFrescoAdmin;
