import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage, canOperate } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ProductoGlobalSearchCombobox, {
  type ProductoGlobalOption,
} from "@/components/admin/ProductoGlobalSearchCombobox";
import { cn } from "@/lib/utils";

type LineaTraslado = {
  key: string;
  productoGlobalId: string;
  productoNombre: string;
  cantidad: string;
};

const todayLocal = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const newLinea = (): LineaTraslado => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  productoGlobalId: "",
  productoNombre: "",
  cantidad: "",
});

function parseCantidadEntera(raw: string): number {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function fetchStockMap(sucursalId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select("producto_global_id, cantidad_disponible")
    .eq("sucursal_id", sucursalId);
  if (error) throw error;

  const map: Record<string, number> = {};
  for (const row of (data as any[]) ?? []) {
    const id = String(row.producto_global_id ?? "");
    if (!id) continue;
    const qty = Number(row.cantidad_disponible ?? 0);
    map[id] = Number.isFinite(qty) ? Math.max(0, Math.trunc(qty)) : 0;
  }
  return map;
}

const MovimientoSucursalANeveraAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const canRegistrar =
    isGlobalAdmin
    || canOperate(permissions, "bodega_sucursal")
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const qc = useQueryClient();

  const [fechaTraslado, setFechaTraslado] = useState(todayLocal());
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaTraslado[]>([newLinea()]);
  const [error, setError] = useState<string | null>(null);

  const stockQuery = useQuery({
    queryKey: ["inventario-bodega-sucursal-stock-traslado", activeBranchId],
    enabled: Boolean(activeBranchId),
    queryFn: async () => {
      if (!activeBranchId) return {};
      return fetchStockMap(activeBranchId);
    },
  });

  const productosQuery = useQuery({
    queryKey: ["productos-globales-traslado-nevera", stockQuery.dataUpdatedAt],
    queryFn: async (): Promise<ProductoGlobalOption[]> => {
      const { data, error: qError } = await supabase
        .from("productos_globales" as any)
        .select("id, nombre_principal, codigo")
        .eq("activo", true)
        .order("nombre_principal");
      if (qError) throw qError;
      const stock = stockQuery.data ?? {};
      return ((data as any[]) ?? []).map((row) => ({
        id: String(row.id),
        nombre_principal: String(row.nombre_principal ?? ""),
        codigo: row.codigo ?? null,
        stock: Number(stock[String(row.id)] ?? 0),
      }));
    },
    enabled: stockQuery.isSuccess || stockQuery.isError,
  });

  const stockByProducto = stockQuery.data ?? {};

  const productosConStock = useMemo(() => {
    const stock = stockByProducto;
    const seleccionados = new Set(lineas.map((l) => l.productoGlobalId).filter(Boolean));
    return (productosQuery.data ?? [])
      .map((p) => ({
        ...p,
        stock: Number(stock[p.id] ?? p.stock ?? 0),
      }))
      .filter((p) => p.stock > 0 || seleccionados.has(p.id))
      .sort((a, b) => a.nombre_principal.localeCompare(b.nombre_principal, "es"));
  }, [productosQuery.data, stockByProducto, lineas]);

  const productosById = useMemo(() => {
    const map = new Map<string, ProductoGlobalOption>();
    for (const p of productosQuery.data ?? []) {
      map.set(p.id, p);
    }
    for (const p of productosConStock) {
      map.set(p.id, p);
    }
    return map;
  }, [productosQuery.data, productosConStock]);

  const productosUsados = useMemo(
    () => new Set(lineas.map((l) => l.productoGlobalId).filter(Boolean)),
    [lineas],
  );

  const erroresLinea = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const linea of lineas) {
      if (!linea.productoGlobalId) continue;
      const cantidad = parseCantidadEntera(linea.cantidad);
      if (cantidad <= 0) continue;
      const stock = Number(stockByProducto[linea.productoGlobalId] ?? 0);
      if (cantidad > stock) {
        errors[linea.key] = `La cantidad (${cantidad}) no puede ser mayor que el stock (${stock}).`;
      }
    }
    return errors;
  }, [lineas, stockByProducto]);

  const hayErrorValidacion = Object.keys(erroresLinea).length > 0;

  useEffect(() => {
    if (!hayErrorValidacion) {
      setError((prev) =>
        prev
          && (prev.includes("stock") || prev.includes("producto"))
          ? null
          : prev,
      );
      return;
    }
    setError(Object.values(erroresLinea)[0] ?? null);
  }, [erroresLinea, hayErrorValidacion]);

  const resetForm = () => {
    setFechaTraslado(todayLocal());
    setObservaciones("");
    setLineas([newLinea()]);
    setError(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!canRegistrar) throw new Error("No tienes permiso para enviar productos a nevera");
      if (!activeBranchId) throw new Error("Selecciona una sucursal activa");
      if (!fechaTraslado) throw new Error("Ingresa la fecha del traslado");

      const stockFresh = await fetchStockMap(activeBranchId);
      const productosMap = new Map(
        [...productosById.values()].map((p) => [p.id, p.nombre_principal]),
      );

      const detalle = lineas
        .map((linea) => {
          const producto = productosById.get(linea.productoGlobalId);
          const nombre =
            linea.productoNombre
            || producto?.nombre_principal
            || productosMap.get(linea.productoGlobalId)
            || "";
          return {
            producto_global_id: linea.productoGlobalId,
            producto_nombre: nombre,
            cantidad: parseCantidadEntera(linea.cantidad),
          };
        })
        .filter((row) => row.producto_global_id);

      if (detalle.length === 0) throw new Error("Agrega al menos un producto");
      if (detalle.some((row) => !row.producto_nombre)) {
        throw new Error("Hay un producto sin nombre válido; vuelve a seleccionarlo");
      }
      if (detalle.some((row) => row.cantidad <= 0)) {
        throw new Error("La cantidad debe ser un número entero mayor a 0");
      }

      const ids = detalle.map((d) => d.producto_global_id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("No puedes repetir el mismo producto en el traslado");
      }

      for (const row of detalle) {
        const disponible = Number(stockFresh[row.producto_global_id] ?? 0);
        if (row.cantidad > disponible) {
          throw new Error(
            `La cantidad de "${row.producto_nombre}" (${row.cantidad}) no puede ser mayor que el stock (${disponible}).`,
          );
        }
      }

      const resumen = detalle
        .map((d) => `• ${d.producto_nombre}: ${d.cantidad}`)
        .join("\n");
      const ok = window.confirm(
        `Confirmar envío a nevera (${activeBranch?.name ?? "sucursal"}):\n\n${resumen}\n\n¿Registrar movimiento?`,
      );
      if (!ok) throw new Error("Movimiento cancelado");

      const { data, error: rpcError } = await supabase.rpc(
        "registrar_traslado_bodega_sucursal_nevera" as any,
        {
          p_sucursal_id: activeBranchId,
          p_fecha_traslado: fechaTraslado,
          p_detalle: detalle.map((d) => ({
            producto_global_id: d.producto_global_id,
            cantidad: d.cantidad,
          })),
          p_observaciones: observaciones.trim() || null,
        } as any,
      );

      if (rpcError) throw rpcError;
      return data as string;
    },
    onSuccess: () => {
      toast.success("Productos enviados a nevera");
      resetForm();
      void qc.invalidateQueries({
        queryKey: ["inventario-bodega-sucursal-stock-traslado", activeBranchId],
      });
      void qc.invalidateQueries({ queryKey: ["productos-globales-traslado-nevera"] });
      void qc.invalidateQueries({
        queryKey: ["inventario-producto-map", activeBranchId, "bodega_sucursal"],
      });
      void qc.invalidateQueries({
        queryKey: ["inventario-producto-map", activeBranchId, "nevera"],
      });
      void qc.invalidateQueries({
        queryKey: ["inventario-producto-map", activeBranchId],
      });
      void qc.invalidateQueries({
        queryKey: ["admin-inventario-movimientos", activeBranchId],
      });
    },
    onError: (err: Error) => {
      if (err.message === "Movimiento cancelado") {
        toast.message("Movimiento cancelado");
        return;
      }
      setError(err.message || "No se pudo registrar el movimiento a nevera");
      toast.error(err.message || "No se pudo registrar el movimiento a nevera");
    },
  });

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para enviar productos a nevera.
      </div>
    );
  }

  if (!canRegistrar) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Solo lectura: no tienes permiso para enviar productos a nevera.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-200 bg-white text-cyan-700 shadow-sm">
          <ArrowRightLeft className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Movimiento a nevera</h2>
          <p className="text-xs text-muted-foreground">
            Envía productos de bodega sucursal a la nevera de{" "}
            <span className="font-semibold text-foreground">
              {activeBranch?.name ?? activeBranchId}
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border/80 bg-card/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Encabezado</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Destino</Label>
            <div className="flex h-10 items-center rounded-xl border border-border/70 bg-muted/30 px-3 text-sm font-semibold text-foreground">
              Nevera · {activeBranch?.name ?? activeBranchId}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Hay una sola nevera por sucursal; no es necesario seleccionarla.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Fecha de traslado *</Label>
            <Input
              type="date"
              value={fechaTraslado}
              onChange={(e) => setFechaTraslado(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Observaciones</Label>
            <Textarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="min-h-[72px] rounded-xl"
              placeholder="Opcional"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/80 bg-card/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Detalle</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-xl"
            onClick={() => setLineas((prev) => [...prev, newLinea()])}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar producto
          </Button>
        </div>

        {stockQuery.isError ? (
          <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
            No se pudo cargar el stock de bodega sucursal.
          </p>
        ) : null}

        <div className="space-y-3">
          {lineas.map((linea, index) => {
            const stockDisponible = linea.productoGlobalId
              ? Number(stockByProducto[linea.productoGlobalId] ?? 0)
              : null;
            const mensajeError = erroresLinea[linea.key] ?? null;
            const nombreMostrado =
              linea.productoNombre
              || productosById.get(linea.productoGlobalId)?.nombre_principal
              || null;

            return (
              <div
                key={linea.key}
                className={cn(
                  "grid gap-2 rounded-xl border bg-muted/10 p-3 sm:grid-cols-[minmax(0,1.6fr)_7rem_7rem_auto]",
                  mensajeError ? "border-destructive/50" : "border-border/70",
                )}
              >
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">
                    Producto {index + 1}
                  </Label>
                  <ProductoGlobalSearchCombobox
                    productos={productosConStock}
                    value={linea.productoGlobalId}
                    usedIds={productosUsados}
                    showStock
                    onChange={(productoGlobalId) => {
                      const producto = productosById.get(productoGlobalId)
                        ?? productosConStock.find((p) => p.id === productoGlobalId);
                      setLineas((prev) =>
                        prev.map((row) =>
                          row.key === linea.key
                            ? {
                                ...row,
                                productoGlobalId,
                                productoNombre: producto?.nombre_principal ?? "",
                                cantidad: "",
                              }
                            : row,
                        ),
                      );
                    }}
                  />
                  {nombreMostrado ? (
                    <p className="truncate text-[11px] font-semibold text-foreground">
                      Seleccionado: {nombreMostrado}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">Stock</Label>
                  <div
                    className={cn(
                      "flex h-10 items-center rounded-xl border border-border/70 bg-muted/40 px-3 text-sm font-semibold tabular-nums",
                      stockDisponible === 0 && linea.productoGlobalId
                        ? "text-destructive"
                        : "text-foreground",
                    )}
                  >
                    {linea.productoGlobalId
                      ? (stockQuery.isLoading ? "…" : String(stockDisponible ?? 0))
                      : "—"}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase text-muted-foreground">Cantidad</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    max={stockDisponible ?? undefined}
                    inputMode="numeric"
                    disabled={!linea.productoGlobalId}
                    value={linea.productoGlobalId ? linea.cantidad : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setLineas((prev) =>
                        prev.map((row) =>
                          row.key === linea.key ? { ...row, cantidad: raw } : row,
                        ),
                      );
                    }}
                    className={cn(
                      "h-10 rounded-xl tabular-nums",
                      mensajeError && "border-destructive focus-visible:ring-destructive",
                      !linea.productoGlobalId && "bg-muted/40 text-muted-foreground",
                    )}
                    placeholder={linea.productoGlobalId ? "0" : "—"}
                  />
                </div>

                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-10 rounded-xl text-destructive"
                    disabled={lineas.length <= 1}
                    onClick={() => setLineas((prev) => prev.filter((row) => row.key !== linea.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {mensajeError ? (
                  <p className="sm:col-span-4 text-[11px] font-semibold text-destructive">
                    {mensajeError}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          disabled={saveMutation.isPending}
          onClick={resetForm}
        >
          Limpiar
        </Button>
        <Button
          type="button"
          className="rounded-xl"
          disabled={saveMutation.isPending || hayErrorValidacion}
          onClick={() => {
            if (hayErrorValidacion) {
              const msg = Object.values(erroresLinea)[0]
                ?? "La cantidad no puede ser mayor que el stock disponible.";
              setError(msg);
              toast.error(msg);
              return;
            }
            setError(null);
            saveMutation.mutate();
          }}
        >
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Enviar a nevera
        </Button>
      </div>
    </div>
  );
};

export default MovimientoSucursalANeveraAdmin;
