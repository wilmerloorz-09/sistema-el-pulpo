import { supabase } from "@/integrations/supabase/client";
import type { TipoProducto } from "@/lib/inventarioProductos";
import { esInventarioVentaSoloNevera, resolverSucursalInventario } from "@/lib/inventarioSucursal";

export type InventarioProductoInfo = {
  productoId: string;
  cantidadDisponible: number;
  tipoProducto: TipoProducto;
  activoCatalogo: boolean;
  /** Por sucursal; false si no hay fila en inventario_productos. */
  integraConVentas: boolean;
  inventarioId: string | null;
  /** Por sucursal (nevera); stock de nevera menor a este valor se muestra en rojo. */
  limiteStock: number;
};

export function resolveMenuNodeProductId(node: {
  node_type: string;
  id: string;
  legacy_product_id?: string | null;
  producto_global_id?: string | null;
}): string | null {
  if (node.node_type !== "product") return null;
  const globalId = node.producto_global_id?.trim();
  if (globalId) return globalId;
  const legacyId = node.legacy_product_id?.trim();
  if (legacyId) return legacyId;
  return node.id;
}

/** IDs de productos globales de tipo COMPRADO (los PREPARADO no se manejan en inventario). */
export async function fetchProductosGlobalesCompradosIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("productos_globales" as any)
    .select("id")
    .eq("tipo_producto", "COMPRADO");
  if (error) throw error;
  return new Set(((data as unknown as { id: string }[]) ?? []).map((row) => row.id));
}

export async function fetchInventarioProductoMap(
  branchId: string,
): Promise<Map<string, InventarioProductoInfo>> {
  const map = new Map<string, InventarioProductoInfo>();
  const inventarioSucursalId = await resolverSucursalInventario(branchId);

  const { data: inventoryRows, error: invError } = await supabase
    .from("inventario_productos")
    .select(`
      id,
      producto_id,
      cantidad_disponible,
      integra_con_ventas,
      limite_stock,
      products (
        id,
        tipo_producto,
        is_active
      )
    `)
    .eq("sucursal_id", inventarioSucursalId);
  if (invError) throw invError;

  for (const row of inventoryRows ?? []) {
    const product = row.products as {
      id: string;
      tipo_producto: TipoProducto | null;
      is_active: boolean;
    } | null;
    if (!product) continue;
    map.set(row.producto_id, {
      productoId: row.producto_id,
      inventarioId: row.id,
      cantidadDisponible: Number(row.cantidad_disponible ?? 0),
      tipoProducto: product.tipo_producto === "PREPARADO" ? "PREPARADO" : "COMPRADO",
      activoCatalogo: product.is_active,
      // Se sobrescribe abajo con el flag de bodega sucursal (fuente de verdad).
      integraConVentas: Boolean(row.integra_con_ventas),
      limiteStock: Number(row.limite_stock ?? 0),
    });
  }

  // Integra ventas se configura en bodega sucursal (no mezclar cantidad de bodega aquí:
  // este mapa es stock de NEVERA para pantallas de inventario).
  const { data: bodegaRows, error: bodegaError } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select("producto_global_id, integra_con_ventas")
    .eq("sucursal_id", inventarioSucursalId);
  if (bodegaError) throw bodegaError;

  for (const row of (bodegaRows as any[]) ?? []) {
    const productoId = String(row.producto_global_id ?? "");
    if (!productoId) continue;
    const existing = map.get(productoId);
    if (existing) {
      existing.integraConVentas = Boolean(row.integra_con_ventas);
    } else if (row.integra_con_ventas) {
      map.set(productoId, {
        productoId,
        inventarioId: null,
        cantidadDisponible: 0,
        tipoProducto: "COMPRADO",
        activoCatalogo: true,
        integraConVentas: true,
        limiteStock: 0,
      });
    }
  }

  return map;
}

/**
 * Stock vendible para menú/órdenes.
 * P1: solo nevera. Resto: nevera + bodega sucursal.
 */
export async function fetchInventarioStockVendibleMap(
  branchId: string,
): Promise<Map<string, InventarioProductoInfo>> {
  const map = await fetchInventarioProductoMap(branchId);
  if (await esInventarioVentaSoloNevera(branchId)) return map;

  const inventarioSucursalId = await resolverSucursalInventario(branchId);
  const { data: bodegaRows, error } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select("producto_global_id, cantidad_disponible, integra_con_ventas")
    .eq("sucursal_id", inventarioSucursalId);
  if (error) throw error;

  for (const row of (bodegaRows as any[]) ?? []) {
    const productoId = String(row.producto_global_id ?? "");
    if (!productoId) continue;
    const stockBodega = Math.max(0, Number(row.cantidad_disponible ?? 0));
    const existing = map.get(productoId);
    if (existing) {
      if (existing.integraConVentas) {
        existing.cantidadDisponible = Number(existing.cantidadDisponible) + stockBodega;
      }
    } else if (row.integra_con_ventas) {
      map.set(productoId, {
        productoId,
        inventarioId: null,
        cantidadDisponible: stockBodega,
        tipoProducto: "COMPRADO",
        activoCatalogo: true,
        integraConVentas: true,
        limiteStock: 0,
      });
    }
  }

  return map;
}

/**
 * Stock vendible actual del producto en la sucursal.
 * P1: solo nevera. Resto: nevera + bodega sucursal.
 */
export async function fetchStockActualProducto(branchId: string, productoId: string): Promise<number> {
  const inventarioSucursalId = await resolverSucursalInventario(branchId);
  const [{ data: nevera, error: neveraError }, soloNevera] = await Promise.all([
    supabase
      .from("inventario_productos")
      .select("cantidad_disponible")
      .eq("sucursal_id", inventarioSucursalId)
      .eq("producto_id", productoId)
      .maybeSingle(),
    esInventarioVentaSoloNevera(branchId),
  ]);
  if (neveraError) throw neveraError;
  const stockNevera = Number(nevera?.cantidad_disponible ?? 0);
  if (soloNevera) return stockNevera;

  const { data: bodega, error: bodegaError } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select("cantidad_disponible")
    .eq("sucursal_id", inventarioSucursalId)
    .eq("producto_global_id", productoId)
    .maybeSingle();
  if (bodegaError) throw bodegaError;
  return stockNevera + Math.max(0, Number((bodega as any)?.cantidad_disponible ?? 0));
}

/** Stock de bodega de sucursal (recibido desde bodega general), keyed por producto_global_id. */
export async function fetchInventarioBodegaSucursalMap(
  branchId: string,
): Promise<Map<string, InventarioProductoInfo>> {
  const map = new Map<string, InventarioProductoInfo>();
  const inventarioSucursalId = await resolverSucursalInventario(branchId);

  const { data: inventoryRows, error: invError } = await supabase
    .from("inventario_bodega_sucursal" as any)
    .select(`
      id,
      producto_global_id,
      cantidad_disponible,
      integra_con_ventas,
      productos_globales (
        id,
        tipo_producto,
        activo
      )
    `)
    .eq("sucursal_id", inventarioSucursalId);
  if (invError) throw invError;

  for (const row of (inventoryRows as any[]) ?? []) {
    const product = row.productos_globales as {
      id: string;
      tipo_producto: TipoProducto | null;
      activo: boolean;
    } | null;
    const productoGlobalId = String(row.producto_global_id ?? "");
    if (!productoGlobalId) continue;
    map.set(productoGlobalId, {
      productoId: productoGlobalId,
      inventarioId: row.id ?? null,
      cantidadDisponible: Number(row.cantidad_disponible ?? 0),
      tipoProducto: product?.tipo_producto === "PREPARADO" ? "PREPARADO" : "COMPRADO",
      activoCatalogo: product?.activo ?? true,
      integraConVentas: Boolean(row.integra_con_ventas),
      limiteStock: 0,
    });
  }

  return map;
}

export function mergeInventarioInfo(
  inventarioMap: Map<string, InventarioProductoInfo>,
  productId: string,
): InventarioProductoInfo {
  return inventarioMap.get(productId) ?? {
    productoId: productId,
    inventarioId: null,
    cantidadDisponible: 0,
    tipoProducto: "COMPRADO",
    activoCatalogo: true,
    integraConVentas: false,
    limiteStock: 0,
  };
}
