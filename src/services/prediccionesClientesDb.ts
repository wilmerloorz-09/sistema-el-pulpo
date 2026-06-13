import { supabase } from "@/integrations/supabase/client";
import { dbInsert, dbSelect } from "@/services/DatabaseService";
import { cleanOrderCode } from "@/lib/orderPresentation";
import {
  calcularConsumoOrdenPromocion,
  cumpleConsumoMinimoPromocion,
  esPagoActivoParaConsumo,
} from "@/lib/promocionesElegibilidad";
import type { OrdenElegiblePromocion, PrediccionCliente } from "@/types/campanaPromocional";
import type { CampanaPromocional } from "@/types/campanaPromocional";
import { generateUUID } from "@/lib/uuid";
import { roundMoney } from "@/lib/paymentQuantity";

const TABLA_PREDICCIONES = "predicciones_clientes" as const;

const COLUMNAS_PREDICCION =
  "id, campana_id, orden_id, cliente_id, oferta_seleccionada_id, estado_prediccion, monto_descuento_ganado, codigo_cupon, cupon_usado_el, fecha_caducidad_cupon, registrado_por, creado_el";

function agregarPagoActivo(
  mapa: Record<string, number>,
  orderId: string,
  amount: number,
) {
  mapa[orderId] = roundMoney((mapa[orderId] ?? 0) + Number(amount ?? 0));
}

export async function listarOrdenesElegiblesPromociones(
  campana: CampanaPromocional,
  shiftId: string,
  branchId?: string | null,
): Promise<OrdenElegiblePromocion[]> {
  const { data: pagosTurno, error: pagosError } = await supabase
    .from("payments")
    .select("order_id, amount, notes")
    .eq("shift_id", shiftId);

  if (pagosError) throw pagosError;

  const pagosActivosPorOrden: Record<string, number> = {};
  const ordenIdsConPagoEnTurno = new Set<string>();
  for (const pago of pagosTurno ?? []) {
    if (!pago.order_id || !esPagoActivoParaConsumo(pago.notes)) continue;
    ordenIdsConPagoEnTurno.add(pago.order_id);
    agregarPagoActivo(pagosActivosPorOrden, pago.order_id, Number(pago.amount));
  }

  const selectOrden =
    "id, order_number, order_code, order_type, total, cliente_id, is_special, special_total_manual, paid_at, status";

  let ordenesQuery = supabase
    .from("orders")
    .select(selectOrden)
    .not("paid_at", "is", null)
    .neq("status", "CANCELLED");

  if (branchId) {
    ordenesQuery = ordenesQuery.eq("branch_id", branchId);
  }

  if (ordenIdsConPagoEnTurno.size > 0) {
    const ids = Array.from(ordenIdsConPagoEnTurno);
    ordenesQuery = ordenesQuery.or(`cash_shift_id.eq.${shiftId},id.in.(${ids.join(",")})`);
  } else {
    ordenesQuery = ordenesQuery.eq("cash_shift_id", shiftId);
  }

  const { data: ordenes, error: ordenesError } = await ordenesQuery.order("updated_at", {
    ascending: false,
  });

  if (ordenesError) throw ordenesError;

  const lista = (ordenes ?? []).filter((o) =>
    cumpleConsumoMinimoPromocion(
      calcularConsumoOrdenPromocion(o, pagosActivosPorOrden),
      campana.consumo_minimo,
    ),
  );
  if (lista.length === 0) return [];

  const ordenIds = lista.map((o) => o.id);
  const { data: predicciones, error: predError } = await supabase
    .from(TABLA_PREDICCIONES)
    .select("orden_id")
    .eq("campana_id", campana.id)
    .in("orden_id", ordenIds);

  if (predError) throw predError;
  const conPrediccion = new Set((predicciones ?? []).map((p) => p.orden_id));
  const sinPrediccion = lista.filter((o) => !conPrediccion.has(o.id));

  const clienteIds = Array.from(
    new Set(sinPrediccion.map((o) => o.cliente_id).filter(Boolean)),
  ) as string[];

  let clientesMap: Record<string, { id: string; cedula: string; nombres: string; apellidos: string }> = {};
  if (clienteIds.length > 0) {
    const clientes = await dbSelect<{ id: string; cedula: string; nombres: string; apellidos: string }>("clientes", {
      select: "id, cedula, nombres, apellidos",
      filters: [{ column: "id", op: "in", value: clienteIds }],
      skipLocalCache: true,
    });
    clientesMap = Object.fromEntries(clientes.map((c) => [c.id, c]));
  }

  return sinPrediccion.map((o) => ({
    id: o.id,
    order_number: o.order_number,
    order_code: cleanOrderCode(o.order_code) ?? null,
    order_type: o.order_type,
    total: calcularConsumoOrdenPromocion(o, pagosActivosPorOrden),
    cliente_id: o.cliente_id,
    cliente: o.cliente_id ? (clientesMap[o.cliente_id] ?? null) : null,
  }));
}

export type RegistrarPrediccionPayload = {
  campana_id: string;
  orden_id: string;
  cliente_id: string;
  oferta_seleccionada_id: string;
  registrado_por: string;
  prediccion_marcador_local?: number | null;
  prediccion_marcador_visitante?: number | null;
};

export async function registrarPrediccionCliente(payload: RegistrarPrediccionPayload): Promise<PrediccionCliente> {
  const id = generateUUID();
  await dbInsert(
    TABLA_PREDICCIONES,
    {
      id,
      ...payload,
      prediccion_marcador_local: payload.prediccion_marcador_local ?? null,
      prediccion_marcador_visitante: payload.prediccion_marcador_visitante ?? null,
      estado_prediccion: "PENDIENTE",
      monto_descuento_ganado: null,
      codigo_cupon: null,
      cupon_usado_el: null,
      fecha_caducidad_cupon: null,
      creado_el: new Date().toISOString(),
    },
    { hotPath: true },
  );
  return {
    id,
    ...payload,
    prediccion_marcador_local: payload.prediccion_marcador_local ?? null,
    prediccion_marcador_visitante: payload.prediccion_marcador_visitante ?? null,
    estado_prediccion: "PENDIENTE",
    monto_descuento_ganado: null,
    codigo_cupon: null,
    cupon_usado_el: null,
    fecha_caducidad_cupon: null,
    creado_el: new Date().toISOString(),
  };
}

export async function usuarioPuedeRegistrarPromociones(): Promise<boolean> {
  const { data, error } = await supabase.rpc("usuario_puede_registrar_promociones");
  if (error) throw error;
  return Boolean(data);
}
