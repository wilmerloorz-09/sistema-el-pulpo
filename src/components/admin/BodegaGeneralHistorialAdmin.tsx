import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Search,
  ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type HistorialDetalle = {
  id: string;
  cantidad: number;
  precioUnitario?: number;
  subtotal?: number;
  productoNombre: string;
};

type HistorialRow = {
  id: string;
  tipo: "compra" | "traslado";
  titulo: string;
  subtitulo: string;
  fecha: string;
  totalLabel: string;
  registradoPorNombre: string;
  creadoEn: string;
  observaciones: string | null;
  detalle: HistorialDetalle[];
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

const BodegaGeneralHistorialAdmin = () => {
  const [busqueda, setBusqueda] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const historialQuery = useQuery({
    queryKey: ["historial-bodega-general"],
    queryFn: async (): Promise<HistorialRow[]> => {
      const [comprasRes, trasladosRes] = await Promise.all([
        supabase
          .from("compras_bodega_general" as any)
          .select(`
            id,
            numero_comprobante,
            fecha_compra,
            total,
            observaciones,
            registrado_por_nombre,
            creado_en,
            proveedores ( nombre, ruc_cedula ),
            compras_bodega_general_detalle (
              id,
              cantidad,
              precio_unitario,
              subtotal,
              productos_globales ( nombre_principal )
            )
          `)
          .order("fecha_compra", { ascending: false })
          .order("creado_en", { ascending: false })
          .limit(100),
        supabase
          .from("traslados_bodega_general" as any)
          .select(`
            id,
            fecha_traslado,
            observaciones,
            registrado_por_nombre,
            creado_en,
            branches ( name ),
            traslados_bodega_general_detalle (
              id,
              cantidad,
              productos_globales ( nombre_principal )
            )
          `)
          .order("fecha_traslado", { ascending: false })
          .order("creado_en", { ascending: false })
          .limit(100),
      ]);

      if (comprasRes.error) throw comprasRes.error;
      if (trasladosRes.error) throw trasladosRes.error;

      const compras: HistorialRow[] = ((comprasRes.data as any[]) ?? []).map((row) => ({
        id: `compra-${row.id}`,
        tipo: "compra",
        titulo: (row.proveedores as { nombre: string } | null)?.nombre ?? "Proveedor",
        subtitulo: `Factura ${row.numero_comprobante}${
          (row.proveedores as { ruc_cedula: string } | null)?.ruc_cedula
            ? ` · RUC ${(row.proveedores as { ruc_cedula: string }).ruc_cedula}`
            : ""
        }`,
        fecha: row.fecha_compra,
        totalLabel: `$${Number(row.total ?? 0).toFixed(2)}`,
        registradoPorNombre: row.registrado_por_nombre,
        creadoEn: row.creado_en,
        observaciones: row.observaciones,
        detalle: ((row.compras_bodega_general_detalle as any[]) ?? []).map((d) => ({
          id: d.id,
          cantidad: Number(d.cantidad ?? 0),
          precioUnitario: Number(d.precio_unitario ?? 0),
          subtotal: Number(d.subtotal ?? 0),
          productoNombre:
            (d.productos_globales as { nombre_principal: string } | null)?.nombre_principal
            ?? "Producto",
        })),
      }));

      const traslados: HistorialRow[] = ((trasladosRes.data as any[]) ?? []).map((row) => {
        const detalle = ((row.traslados_bodega_general_detalle as any[]) ?? []).map((d) => ({
          id: d.id,
          cantidad: Number(d.cantidad ?? 0),
          productoNombre:
            (d.productos_globales as { nombre_principal: string } | null)?.nombre_principal
            ?? "Producto",
        }));
        const totalCantidad = detalle.reduce((acc, d) => acc + d.cantidad, 0);
        return {
          id: `traslado-${row.id}`,
          tipo: "traslado" as const,
          titulo: (row.branches as { name: string } | null)?.name ?? "Sucursal",
          subtitulo: `${detalle.length} producto${detalle.length === 1 ? "" : "s"}`,
          fecha: row.fecha_traslado,
          totalLabel: `${totalCantidad} uds`,
          registradoPorNombre: row.registrado_por_nombre,
          creadoEn: row.creado_en,
          observaciones: row.observaciones,
          detalle,
        };
      });

      return [...compras, ...traslados].sort((a, b) => {
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
    return rows.filter((row) =>
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
          <h2 className="font-display text-lg font-bold text-foreground">Historial</h2>
          <p className="text-xs text-muted-foreground">
            Compras y movimientos a sucursal de bodega general
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por proveedor, sucursal, factura o producto..."
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
            No hay compras ni envíos registrados todavía.
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
                              : "border-orange-200 bg-orange-50 text-orange-800",
                          )}
                        >
                          {row.tipo === "compra" ? (
                            <span className="inline-flex items-center gap-1">
                              <ShoppingCart className="h-3 w-3" /> Compra
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <ArrowRightLeft className="h-3 w-3" /> A sucursal
                            </span>
                          )}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {formatFecha(row.fecha)} · {row.subtitulo} · {row.registradoPorNombre}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Registrado: {formatFechaHora(row.creadoEn)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">
                      {row.totalLabel}
                    </p>
                  </button>

                  <div className={cn(!isOpen && "hidden")}>
                    <div className="space-y-1 border-t border-border/50 bg-muted/10 px-4 py-3 pl-10">
                      {row.detalle.map((d) => (
                        <div
                          key={d.id}
                          className={cn(
                            "grid gap-1 text-xs sm:items-center",
                            row.tipo === "compra"
                              ? "sm:grid-cols-[minmax(0,1fr)_5rem_6rem_6rem]"
                              : "sm:grid-cols-[minmax(0,1fr)_5rem]",
                          )}
                        >
                          <p className="truncate font-medium text-foreground">{d.productoNombre}</p>
                          <p className="tabular-nums text-muted-foreground">Cant. {d.cantidad}</p>
                          {row.tipo === "compra" ? (
                            <>
                              <p className="tabular-nums text-muted-foreground">
                                ${(d.precioUnitario ?? 0).toFixed(4)}
                              </p>
                              <p className="tabular-nums font-semibold text-foreground">
                                ${(d.subtotal ?? 0).toFixed(2)}
                              </p>
                            </>
                          ) : null}
                        </div>
                      ))}
                      {row.observaciones ? (
                        <p className="pt-1 text-[11px] text-muted-foreground">
                          Obs.: {row.observaciones}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default BodegaGeneralHistorialAdmin;
