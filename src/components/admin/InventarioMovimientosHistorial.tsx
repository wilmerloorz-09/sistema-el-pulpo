import { useQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  etiquetaCantidadMovimiento,
  etiquetaTipoMovimientoInventario,
  type TipoMovimientoInventario,
} from "@/lib/inventarioProductos";
import { cn } from "@/lib/utils";

type MovimientoHistorialRow = {
  id: string;
  tipoMovimiento: TipoMovimientoInventario;
  cantidadMovimiento: number;
  cantidadAnterior: number;
  cantidadNueva: number;
  motivo: string;
  registradoPorNombre: string;
  creadoEn: string;
  productoNombre: string;
};

function formatFechaMovimiento(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type InventarioMovimientosHistorialProps = {
  sucursalId: string | null;
  filtroProducto?: string;
};

const InventarioMovimientosHistorial = ({
  sucursalId,
  filtroProducto = "",
}: InventarioMovimientosHistorialProps) => {
  const historialQuery = useQuery({
    queryKey: ["admin-inventario-movimientos", sucursalId],
    enabled: Boolean(sucursalId),
    queryFn: async (): Promise<MovimientoHistorialRow[]> => {
      if (!sucursalId) return [];

      const { data, error } = await supabase
        .from("movimientos_inventario")
        .select(`
          id,
          tipo_movimiento,
          cantidad_movimiento,
          cantidad_anterior,
          cantidad_nueva,
          motivo,
          registrado_por_nombre,
          creado_en,
          products ( description )
        `)
        .eq("sucursal_id", sucursalId)
        .order("creado_en", { ascending: false })
        .limit(100);

      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id,
        tipoMovimiento: row.tipo_movimiento as TipoMovimientoInventario,
        cantidadMovimiento: Number(row.cantidad_movimiento),
        cantidadAnterior: Number(row.cantidad_anterior),
        cantidadNueva: Number(row.cantidad_nueva),
        motivo: row.motivo,
        registradoPorNombre: row.registrado_por_nombre,
        creadoEn: row.creado_en,
        productoNombre: (row.products as { description: string } | null)?.description ?? "Producto",
      }));
    },
  });

  const rows = (historialQuery.data ?? []).filter((row) => {
    const q = filtroProducto.trim().toLowerCase();
    if (!q) return true;
    return row.productoNombre.toLowerCase().includes(q) || row.motivo.toLowerCase().includes(q);
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-bold text-foreground">Historial de movimientos</h3>
        <span className="text-[11px] text-muted-foreground">(últimos 100)</span>
      </div>

      {historialQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : historialQuery.isError ? (
        <div className="p-4 text-sm text-destructive">
          {(historialQuery.error as Error)?.message || "No se pudo cargar el historial"}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          No hay movimientos registrados todavía.
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_6rem_7rem_minmax(0,1fr)] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{row.productoNombre}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatFechaMovimiento(row.creadoEn)} · {row.registradoPorNombre}
                </p>
              </div>

              <Badge
                variant="outline"
                className={cn(
                  "w-fit rounded-lg text-[10px] font-bold",
                  row.tipoMovimiento === "INGRESO" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                  row.tipoMovimiento === "SALIDA" && "border-rose-200 bg-rose-50 text-rose-800",
                  row.tipoMovimiento === "AJUSTE" && "border-amber-200 bg-amber-50 text-amber-800",
                )}
              >
                {etiquetaTipoMovimientoInventario(row.tipoMovimiento)}
              </Badge>

              <p className="text-xs font-semibold tabular-nums text-foreground">
                {etiquetaCantidadMovimiento(
                  row.tipoMovimiento,
                  row.cantidadMovimiento,
                  row.cantidadAnterior,
                  row.cantidadNueva,
                )}
              </p>

              <p className="text-xs text-muted-foreground sm:truncate">{row.motivo}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default InventarioMovimientosHistorial;
