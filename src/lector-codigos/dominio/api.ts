import { supabase } from "@/integrations/supabase/client";
import { fetchTablesWithStatus } from "@/hooks/useTablesWithStatus";
import type {
  ItemOrden,
  MesaSucursal,
  OperacionActividad,
  OrdenAbierta,
  ProductoCatalogo,
  ResultadoAgregar,
  Sucursal,
} from "./tipos";
import { normalizarCodigo } from "./formato";

function mapSucursal(b: any): Sucursal {
  return {
    id: String(b.id),
    nombre: String(b.name ?? "Sucursal"),
    codigo: b.branch_code ?? null,
  };
}

export async function listarSucursalesAccesibles(): Promise<Sucursal[]> {
  const { data: ctx, error } = await supabase.rpc("get_my_access_context" as any);
  if (error) throw error;

  const branches = Array.isArray((ctx as any)?.branches) ? (ctx as any).branches : [];
  if (branches.length) {
    return branches
      .filter((b: any) => b?.id && b?.is_active !== false)
      .map(mapSucursal);
  }

  const { data: ub } = await supabase.from("user_branches").select("branch_id");
  const ids = (ub ?? []).map((r: any) => r.branch_id).filter(Boolean);
  if (!ids.length) return [];

  const { data, error: e2 } = await supabase
    .from("branches")
    .select("id, name, branch_code")
    .in("id", ids)
    .eq("is_active", true)
    .order("name");
  if (e2) throw e2;

  return (data ?? []).map(mapSucursal);
}

/** Sucursal ya activa en el POS (sin pedir otra ni llamar set_my_active_branch). */
export async function obtenerSucursalActiva(): Promise<Sucursal | null> {
  const { data: ctx, error } = await supabase.rpc("get_my_access_context" as any);
  if (error) throw error;

  const activeId =
    (ctx as any)?.active_branch_id
    ?? localStorage.getItem("activeBranchId");
  if (!activeId) return null;

  const branches = Array.isArray((ctx as any)?.branches) ? (ctx as any).branches : [];
  const match = branches.find(
    (b: any) => String(b?.id) === String(activeId) && b?.is_active !== false,
  );
  if (match) return mapSucursal(match);

  const { data, error: e2 } = await supabase
    .from("branches")
    .select("id, name, branch_code")
    .eq("id", activeId)
    .eq("is_active", true)
    .maybeSingle();
  if (e2) throw e2;
  if (!data) return null;
  return mapSucursal(data);
}

/** Mesas activas: misma fuente y reglas visuales que /mesas del POS. */
export async function listarMesasSucursal(idSucursal: string): Promise<MesaSucursal[]> {
  try {
    const { tables } = await fetchTablesWithStatus(idSucursal);
    return tables
      .filter((t) => t.is_active)
      .map((t) => {
        const libre = t.status === "free";
        const ordenes =
          libre
            ? []
            : t.splitTotals.length
              ? t.splitTotals
                  .filter((s) => s.splitId)
                  .map((s) => ({
                    id: String(s.splitId),
                    codigo: s.splitCode,
                    total: Math.max(0, Number(s.totalDue ?? 0)),
                    especial: Boolean(s.isSpecial) || s.splitCode === "Especial",
                  }))
              : t.activeOrderId
                ? [{ id: t.activeOrderId, codigo: null, total: Math.max(0, t.totalDue) }]
                : [];
        return {
          id: t.id,
          nombre: t.name,
          orden_visual: t.visual_order,
          // En POS, to_pay ya llega remapeado a occupied.
          estado: libre ? "libre" : t.status === "to_pay" ? "por_cobrar" : "ocupada",
          id_orden_activa: libre ? null : (ordenes[0]?.id ?? t.activeOrderId ?? null),
          total_pendiente: libre ? 0 : Math.max(0, t.totalDue),
          ordenes,
          cantidad_ordenes: libre ? 0 : Math.max(t.splitCount, ordenes.length),
          especial: !libre && t.isSpecial,
          creado_por: libre ? null : (t.created_by_name ?? null),
        } satisfies MesaSucursal;
      })
      .sort((a, b) => a.orden_visual - b.orden_visual || a.nombre.localeCompare(b.nombre));
  } catch {
    const { data, error } = await supabase
      .from("restaurant_tables")
      .select("id, name, visual_order, is_active")
      .eq("branch_id", idSucursal)
      .eq("is_active", true)
      .order("visual_order");
    if (error) throw error;
    return (data ?? []).map((t: any) => ({
      id: t.id,
      nombre: t.name,
      orden_visual: Number(t.visual_order ?? 0),
      estado: "libre" as const,
      id_orden_activa: null,
      total_pendiente: 0,
      ordenes: [],
      cantidad_ordenes: 0,
      especial: false,
      creado_por: null,
    }));
  }
}

export async function listarOrdenesAbiertas(idSucursal: string): Promise<OrdenAbierta[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() - 2);

  const { data: ordenes, error } = await supabase
    .from("orders")
    .select(
      "id, order_code, order_type, status, table_name_snapshot, created_at, paid_at, cancelled_at, is_special, table_id, closed_at",
    )
    .eq("branch_id", idSucursal)
    .is("cancelled_at", null)
    .is("closed_at", null)
    .not("status", "eq", "CANCELLED")
    .gte("created_at", desde.toISOString())
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;

  const ids = (ordenes ?? []).map((o: any) => o.id);
  if (!ids.length) return [];

  const [{ data: items }, { data: pagos }] = await Promise.all([
    supabase
      .from("order_items")
      .select("order_id, total, status, quantity")
      .in("order_id", ids),
    supabase.from("payments").select("order_id, amount, status").in("order_id", ids),
  ]);

  const totalPorOrden = new Map<string, number>();
  for (const it of items ?? []) {
    if (["DRAFT", "CANCELLED"].includes(String((it as any).status))) continue;
    totalPorOrden.set(
      (it as any).order_id,
      (totalPorOrden.get((it as any).order_id) ?? 0) + Number((it as any).total ?? 0),
    );
  }

  const pagadoPorOrden = new Map<string, number>();
  for (const p of pagos ?? []) {
    const st = String((p as any).status ?? "active").toLowerCase();
    if (st === "voided" || st === "reversed") continue;
    pagadoPorOrden.set(
      (p as any).order_id,
      (pagadoPorOrden.get((p as any).order_id) ?? 0) + Number((p as any).amount ?? 0),
    );
  }

  return (ordenes ?? []).map((o: any) => {
    const total = totalPorOrden.get(o.id) ?? 0;
    const pagado = pagadoPorOrden.get(o.id) ?? 0;
    return {
      id: o.id,
      codigo: o.order_code,
      tipo: o.order_type,
      estado: o.status,
      mesa: o.table_name_snapshot,
      id_mesa: o.table_id ? String(o.table_id) : null,
      total,
      pagado,
      saldo: Math.max(0, total - pagado),
      creada_en: o.created_at,
      cliente: null,
    } satisfies OrdenAbierta;
  });
}

export async function listarItemsOrden(idOrden: string): Promise<ItemOrden[]> {
  const { data, error } = await supabase
    .from("order_items")
    .select("id, description_snapshot, quantity, unit_price, total, product_id, status, created_at")
    .eq("order_id", idOrden)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((i: any) => !["DRAFT", "CANCELLED"].includes(String(i.status)))
    .filter((i: any) => Number(i.quantity ?? 0) > 0)
    .map((i: any) => ({
      id: i.id,
      descripcion: i.description_snapshot,
      cantidad: Number(i.quantity ?? 0),
      precio: Number(i.unit_price ?? 0),
      total: Number(i.total ?? 0),
      id_producto: i.product_id,
      creado_en: i.created_at ? String(i.created_at) : undefined,
    }));
}

type SnapshotRow = {
  order_item_id: string;
  quantity_pending_prepare?: number | null;
  quantity_ready_available?: number | null;
  quantity_dispatched_total?: number | null;
  quantity_cancelled_dispatched?: number | null;
  quantity_cancelled_total?: number | null;
  quantity_ordered?: number | null;
  unit_price?: number | null;
};

function cantidadAnulableSnapshot(snap: SnapshotRow | undefined, qtyFallback: number): number {
  if (!snap) return Math.max(0, qtyFallback);
  const pending = Math.max(0, Number(snap.quantity_pending_prepare ?? 0));
  const ready = Math.max(0, Number(snap.quantity_ready_available ?? 0));
  const dispatchedNet = Math.max(
    0,
    Number(snap.quantity_dispatched_total ?? 0) - Number(snap.quantity_cancelled_dispatched ?? 0),
  );
  const byStages = pending + ready + dispatchedNet;
  const ordered = Math.max(qtyFallback, Number(snap.quantity_ordered ?? qtyFallback));
  const cancelled = Math.max(0, Number(snap.quantity_cancelled_total ?? 0));
  const active = Math.max(0, ordered - cancelled);
  return Math.max(0, Math.min(byStages, active || byStages));
}

/**
 * Ítems vivos de la orden agregados por el lector (escaneo / atajo / menú).
 * Cantidad = unidades anulables del snapshot (no order_items.quantity cruda).
 */
export async function listarItemsLectorOrden(idOrden: string): Promise<ItemOrden[]> {
  const [{ data: ops, error: opsErr }, { data: undos, error: undosErr }, items, snapRes] =
    await Promise.all([
      supabase
        .from("operaciones_estacion_bebidas" as any)
        .select("id, id_order_item, id_producto")
        .eq("id_orden", idOrden)
        .eq("tipo", "agregar")
        .eq("estado", "confirmada"),
      supabase
        .from("operaciones_estacion_bebidas" as any)
        .select("id_operacion_origen")
        .eq("id_orden", idOrden)
        .eq("tipo", "deshacer")
        .eq("estado", "confirmada"),
      listarItemsOrden(idOrden),
      supabase.rpc("get_order_operational_snapshot" as any, { p_order_id: idOrden }),
    ]);
  if (opsErr) throw opsErr;
  if (undosErr) throw undosErr;

  const deshechas = new Set(
    (undos ?? [])
      .map((u: any) => u.id_operacion_origen)
      .filter(Boolean)
      .map(String),
  );
  const idsItem = new Set<string>();
  for (const op of ops ?? []) {
    if (deshechas.has(String((op as any).id))) continue;
    const itemId = (op as any).id_order_item;
    if (itemId) idsItem.add(String(itemId));
  }

  if (!idsItem.size) return [];

  const snapByItem = new Map<string, SnapshotRow>();
  for (const row of (snapRes.data as SnapshotRow[] | null) ?? []) {
    if (row?.order_item_id) snapByItem.set(String(row.order_item_id), row);
  }

  return items
    .filter((i) => idsItem.has(i.id))
    .map((i) => {
      const snap = snapByItem.get(i.id);
      const cantidad = cantidadAnulableSnapshot(snap, i.cantidad);
      const precio = Number(snap?.unit_price ?? i.precio);
      return {
        ...i,
        cantidad,
        precio,
        total: Math.round(cantidad * precio * 100) / 100,
      };
    })
    .filter((i) => i.cantidad > 0);
}

/** Baja unidades del lector según cantidad operativa disponible. */
export async function quitarCantidadesOrden(params: {
  idOrden: string;
  idProducto: string;
  cantidad: number;
  idOperacion?: string;
  idUsuario?: string;
}) {
  const { data, error } = await supabase.rpc("estacion_bebidas_quitar" as any, {
    p_id_orden: params.idOrden,
    p_id_producto: params.idProducto,
    p_cantidad: params.cantidad,
    p_id_operacion: params.idOperacion ?? crypto.randomUUID(),
  } as any);
  if (!error) return data;

  const missingRpc = /estacion_bebidas_quitar|could not find the function|PGRST202/i.test(
    String(error.message ?? ""),
  );
  if (!missingRpc || !params.idUsuario) throw error;

  // Fallback si la RPC aún no está desplegada: armar cancelación con snapshot.
  const vivos = await listarItemsLectorOrden(params.idOrden);
  const delProducto = vivos
    .filter((i) => i.id_producto === params.idProducto)
    .sort((a, b) => String(b.creado_en ?? "").localeCompare(String(a.creado_en ?? "")));
  let restante = Math.max(1, Math.floor(params.cantidad));
  const p_items: { order_item_id: string; quantity_cancelled: number }[] = [];
  for (const it of delProducto) {
    if (restante <= 0) break;
    const take = Math.min(it.cantidad, restante);
    if (take <= 0) continue;
    p_items.push({ order_item_id: it.id, quantity_cancelled: take });
    restante -= take;
  }
  if (!p_items.length) {
    throw new Error("No hay unidades disponibles para quitar de este producto.");
  }
  const { error: cancelErr } = await supabase.rpc("cancel_order_quantities" as any, {
    p_order_id: params.idOrden,
    p_cancelled_by: params.idUsuario,
    p_reason: "otro",
    p_notes: "Ajuste desde lector de códigos",
    p_items,
    p_cancellation_type: "partial",
    p_from_order_edit: true,
  } as any);
  if (cancelErr) throw cancelErr;
  return { fallback: true, items: p_items };
}

/** Catálogo de productos con código de barras habilitados para el lector. */
export async function listarCatalogoProductos(): Promise<ProductoCatalogo[]> {
  // Tablas creadas por la migración del lector (nombre histórico en BD).
  const { data, error } = await supabase
    .from("codigos_barras_bebidas" as any)
    .select("codigo_barras, id_producto, activo, products(description, unit_price, is_active)")
    .eq("activo", true);
  if (error) throw error;

  return (data ?? [])
    .filter((r: any) => r.products?.is_active !== false)
    .map((r: any) => ({
      id_producto: r.id_producto,
      codigo_barras: r.codigo_barras,
      nombre: r.products?.description ?? "Producto",
      precio: Number(r.products?.unit_price ?? 0),
    }));
}

export async function listarActividad(idSucursal: string): Promise<OperacionActividad[]> {
  const { data, error } = await supabase
    .from("operaciones_estacion_bebidas" as any)
    .select("id, tipo, cantidad, monto, codigo_barras, fecha_registro, id_orden, detalle, orders(order_code)")
    .eq("id_sucursal", idSucursal)
    .order("fecha_registro", { ascending: false })
    .limit(100);
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    tipo: r.tipo,
    cantidad: r.cantidad,
    monto: r.monto == null ? null : Number(r.monto),
    codigo_barras: r.codigo_barras,
    fecha_registro: r.fecha_registro,
    id_orden: r.id_orden,
    descripcion: r.detalle?.descripcion ?? null,
    orden_codigo: r.orders?.order_code ?? null,
  }));
}

export async function agregarPorCodigo(params: {
  idOperacion: string;
  idOrden: string;
  codigo?: string | null;
  idProducto?: string | null;
  cantidad?: number;
  fuente?: string;
}): Promise<ResultadoAgregar> {
  const { data, error } = await supabase.rpc("estacion_bebidas_agregar_por_codigo" as any, {
    p_id_operacion: params.idOperacion,
    p_id_orden: params.idOrden,
    p_codigo_barras: params.codigo ? normalizarCodigo(params.codigo) : null,
    p_cantidad: params.cantidad ?? 1,
    p_fuente: params.fuente ?? "lector",
    p_id_producto: params.idProducto ?? null,
  } as any);
  if (error) throw error;
  return data as ResultadoAgregar;
}

export async function deshacerUltima(params: {
  idOrden: string;
  idOperacionOrigen?: string | null;
  idOperacionNueva: string;
}) {
  const { data, error } = await supabase.rpc("estacion_bebidas_deshacer" as any, {
    p_id_operacion: params.idOperacionOrigen ?? null,
    p_id_orden: params.idOrden,
    p_id_operacion_nueva: params.idOperacionNueva,
  } as any);
  if (error) throw error;
  return data;
}
