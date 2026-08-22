import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import {
  estadoInventarioDesdeCantidad,
  etiquetaEstadoInventario,
  etiquetaTipoProducto,
  normalizarCantidadInventario,
  type TipoProducto,
} from "@/lib/inventarioProductos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ProductoInventarioRow = {
  productoId: string;
  nombre: string;
  tipoProducto: TipoProducto;
  inventarioId: string | null;
  cantidadDisponible: number;
  activoInventario: boolean;
  activoCatalogo: boolean;
  displayOrder: number;
};

type ProductSnapshot = {
  id: string;
  description: string;
  tipo_producto: TipoProducto | null;
  is_active: boolean;
  display_order: number | null;
};

function mapProductoRow(
  product: ProductSnapshot,
  inv: {
    id: string;
    cantidad_disponible: number | string;
    activo: boolean;
  } | null,
): ProductoInventarioRow {
  return {
    productoId: product.id,
    nombre: product.description,
    tipoProducto: (product.tipo_producto === "PREPARADO" ? "PREPARADO" : "COMPRADO") as TipoProducto,
    inventarioId: inv?.id ?? null,
    cantidadDisponible: Number(inv?.cantidad_disponible ?? 0),
    activoInventario: inv?.activo ?? true,
    activoCatalogo: product.is_active,
    displayOrder: product.display_order ?? 0,
  };
}

function sortInventarioRows(rows: ProductoInventarioRow[]) {
  return [...rows].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.nombre.localeCompare(b.nombre);
  });
}

async function fetchCatalogProductsForBranch(branchId: string): Promise<ProductSnapshot[]> {
  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id")
    .eq("branch_id", branchId);
  if (catError) throw catError;

  const categoryIds = (categories ?? []).map((c) => c.id);
  if (categoryIds.length === 0) return [];

  const { data: subs, error: subError } = await supabase
    .from("subcategories")
    .select("id")
    .in("category_id", categoryIds);
  if (subError) throw subError;

  const subIds = (subs ?? []).map((s) => s.id);
  if (subIds.length === 0) return [];

  const { data: products, error: prodError } = await supabase
    .from("products")
    .select("id, description, tipo_producto, is_active, display_order")
    .in("subcategory_id", subIds);
  if (prodError) throw prodError;

  return (products ?? []) as ProductSnapshot[];
}

const InventarioProductosAdmin = () => {
  const { activeBranchId, activeBranch, isGlobalAdmin, permissions } = useBranch();
  const canEditInventario =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [draftCantidad, setDraftCantidad] = useState<Record<string, string>>({});
  const [draftTipo, setDraftTipo] = useState<Record<string, TipoProducto>>({});

  const inventarioQuery = useQuery({
    queryKey: ["admin-inventario-productos", activeBranchId],
    enabled: Boolean(activeBranchId),
    queryFn: async (): Promise<ProductoInventarioRow[]> => {
      if (!activeBranchId) return [];

      const { data: inventoryRows, error: invError } = await supabase
        .from("inventario_productos")
        .select(`
          id,
          producto_id,
          cantidad_disponible,
          activo,
          products (
            id,
            description,
            tipo_producto,
            is_active,
            display_order
          )
        `)
        .eq("sucursal_id", activeBranchId);
      if (invError) throw invError;

      const rowsByProductId = new Map<string, ProductoInventarioRow>();

      for (const row of inventoryRows ?? []) {
        const product = row.products as ProductSnapshot | null;
        if (!product) continue;
        rowsByProductId.set(row.producto_id, mapProductoRow(product, {
          id: row.id,
          cantidad_disponible: row.cantidad_disponible,
          activo: row.activo,
        }));
      }

      const catalogProducts = await fetchCatalogProductsForBranch(activeBranchId);
      for (const product of catalogProducts) {
        if (!rowsByProductId.has(product.id)) {
          rowsByProductId.set(product.id, mapProductoRow(product, null));
        }
      }

      return sortInventarioRows(Array.from(rowsByProductId.values()));
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (row: ProductoInventarioRow) => {
      if (!canEditInventario) {
        throw new Error("No tienes permiso para modificar el inventario");
      }
      if (!activeBranchId) throw new Error("Selecciona una sucursal activa");

      const cantidadRaw = draftCantidad[row.productoId] ?? String(row.cantidadDisponible);
      const cantidad = normalizarCantidadInventario(cantidadRaw);
      const tipo = draftTipo[row.productoId] ?? row.tipoProducto;

      const { error: tipoError } = await supabase
        .from("products")
        .update({ tipo_producto: tipo })
        .eq("id", row.productoId);
      if (tipoError) throw tipoError;

      const { error: invError } = await supabase
        .from("inventario_productos")
        .upsert(
          {
            producto_id: row.productoId,
            sucursal_id: activeBranchId,
            cantidad_disponible: cantidad,
            activo: row.activoInventario,
          },
          { onConflict: "producto_id,sucursal_id" },
        );
      if (invError) throw invError;
    },
    onSuccess: (_data, row) => {
      setDraftCantidad((prev) => {
        const next = { ...prev };
        delete next[row.productoId];
        return next;
      });
      setDraftTipo((prev) => {
        const next = { ...prev };
        delete next[row.productoId];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["admin-inventario-productos", activeBranchId] });
      toast.success("Inventario actualizado");
    },
    onError: (error: Error) => {
      toast.error(error?.message || "No se pudo guardar el inventario");
    },
  });

  const rows = useMemo(() => {
    const list = inventarioQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => row.nombre.toLowerCase().includes(q));
  }, [inventarioQuery.data, search]);

  const savingProductoId = saveMutation.isPending ? saveMutation.variables?.productoId : null;

  const gridCols = canEditInventario
    ? "sm:grid-cols-[minmax(0,1.4fr)_7rem_6.5rem_7rem_6.5rem_5rem]"
    : "sm:grid-cols-[minmax(0,1.4fr)_7rem_6.5rem_7rem_6.5rem]";

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/60 p-6 text-sm text-muted-foreground">
        Selecciona una sucursal activa para administrar su inventario.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white text-primary shadow-sm">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Inventario</h2>
            <p className="text-xs text-muted-foreground">
              Sucursal activa: <span className="font-semibold text-foreground">{activeBranch?.name ?? activeBranchId}</span>
            </p>
          </div>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto..."
            className="h-10 rounded-xl pl-9"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Activo en catálogo = visibilidad del producto en el menú. Cantidad disponible = stock operativo por sucursal.
        Cantidad 0 = Agotado en este módulo; no desactiva el catálogo ni afecta ventas todavía.
        {!canEditInventario ? " Modo solo lectura." : null}
        {isGlobalAdmin ? " (Admin global)" : null}
      </p>

      {inventarioQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : inventarioQuery.isError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {(inventarioQuery.error as Error)?.message || "No se pudo cargar el inventario"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border/80 bg-card/60 p-8 text-center text-sm text-muted-foreground">
          No hay productos para esta sucursal.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/60">
          <div
            className={cn(
              "hidden gap-2 border-b border-border/70 bg-muted/40 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:grid",
              gridCols,
            )}
          >
            <span>Producto</span>
            <span>Tipo</span>
            <span>Activo catálogo</span>
            <span>Cantidad</span>
            <span>Estado</span>
            {canEditInventario ? <span /> : null}
          </div>
          <div className="divide-y divide-border/60">
            {rows.map((row) => {
              const cantidadEdit = draftCantidad[row.productoId] ?? String(row.cantidadDisponible);
              const tipoEdit = draftTipo[row.productoId] ?? row.tipoProducto;
              const cantidadNum = normalizarCantidadInventario(cantidadEdit);
              const estado = estadoInventarioDesdeCantidad(cantidadNum);
              const dirty =
                draftCantidad[row.productoId] !== undefined
                || draftTipo[row.productoId] !== undefined;
              const saving = savingProductoId === row.productoId;

              return (
                <div
                  key={row.productoId}
                  className={cn("grid grid-cols-1 gap-3 px-4 py-3 sm:items-center sm:gap-2", gridCols)}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{row.nombre}</p>
                    <p className="text-[11px] text-muted-foreground sm:hidden">
                      {etiquetaTipoProducto(tipoEdit)} · Catálogo: {row.activoCatalogo ? "Sí" : "No"} · {etiquetaEstadoInventario(estado)}
                    </p>
                  </div>

                  <Select
                    value={tipoEdit}
                    disabled={!canEditInventario}
                    onValueChange={(value) =>
                      setDraftTipo((prev) => ({ ...prev, [row.productoId]: value as TipoProducto }))
                    }
                  >
                    <SelectTrigger className="h-9 rounded-xl text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COMPRADO">Comprado</SelectItem>
                      <SelectItem value="PREPARADO">Preparado</SelectItem>
                    </SelectContent>
                  </Select>

                  <div>
                    <Badge
                      className={cn(
                        "rounded-lg text-[10px] font-bold",
                        row.activoCatalogo
                          ? "border-slate-200 bg-slate-50 text-slate-700"
                          : "border-amber-200 bg-amber-50 text-amber-800",
                      )}
                      variant="outline"
                    >
                      {row.activoCatalogo ? "Sí" : "No"}
                    </Badge>
                  </div>

                  <Input
                    type="number"
                    min={0}
                    step="0.001"
                    value={cantidadEdit}
                    readOnly={!canEditInventario}
                    disabled={!canEditInventario}
                    onChange={(e) =>
                      setDraftCantidad((prev) => ({ ...prev, [row.productoId]: e.target.value }))
                    }
                    className="h-9 rounded-xl text-xs tabular-nums"
                  />

                  <div>
                    <Badge
                      className={cn(
                        "rounded-lg text-[10px] font-bold",
                        estado === "DISPONIBLE"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800",
                      )}
                      variant="outline"
                    >
                      {etiquetaEstadoInventario(estado)}
                    </Badge>
                  </div>

                  {canEditInventario ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!dirty || saving}
                        onClick={() => saveMutation.mutate(row)}
                        className="h-9 rounded-xl px-3 text-xs font-bold"
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Save className="mr-1.5 h-3.5 w-3.5" />
                            Guardar
                          </>
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default InventarioProductosAdmin;
