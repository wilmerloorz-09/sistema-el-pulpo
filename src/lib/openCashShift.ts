import { dbSelect, dbSelectStrict } from "@/services/DatabaseService";
import { supabase } from "@/integrations/supabase/client";

export interface OpenCashShift {
  id: string;
  opened_at: string;
}

/**
 * Turno operativo abierto de la sucursal (el mas reciente por opened_at).
 * Con `strict: true` la lectura no cae al cache local en fallo de red: lanza
 * para que React Query reintente (evita mostrar "sin turno" o un turno viejo).
 */
export async function getOpenCashShiftForBranch(
  branchId: string,
  opts?: { strict?: boolean },
): Promise<OpenCashShift | null> {
  const read = opts?.strict ? dbSelectStrict : dbSelect;
  const rows = await read<OpenCashShift>("cash_shifts", {
    select: "id, opened_at",
    branchId,
    filters: [{ column: "status", op: "eq", value: "OPEN" }],
    orderBy: { column: "opened_at", ascending: false },
  });
  const row = rows[0];
  if (!row?.id) return null;
  return { id: row.id, opened_at: row.opened_at };
}

export async function getOpenCashShiftIdForBranch(branchId: string): Promise<string | null> {
  const shift = await getOpenCashShiftForBranch(branchId);
  return shift?.id ?? null;
}

const repairThrottleMs = 60_000;
const lastRepairAtByBranch = new Map<string, number>();

/**
 * Completa `orders.cash_shift_id` NULL de órdenes activas del turno OPEN.
 * Throttle por sucursal para no saturar al refrescar listas.
 * Retorna cuántas filas reparó (0 si throttle / error / nada que hacer).
 * El throttle solo se marca tras éxito: si el RPC falla, el próximo refresh reintenta.
 */
export async function repairOpenShiftOrderCashShiftIds(branchId: string): Promise<number> {
  if (!branchId) return 0;
  const now = Date.now();
  const last = lastRepairAtByBranch.get(branchId) ?? 0;
  if (now - last < repairThrottleMs) return 0;

  try {
    const { data, error } = await (supabase as any).rpc("repair_open_shift_order_cash_shift_ids", {
      p_branch_id: branchId,
    });
    if (error) {
      console.warn("[openCashShift] repair_open_shift_order_cash_shift_ids falló:", error.message ?? error);
      return 0;
    }
    lastRepairAtByBranch.set(branchId, now);
    return Number(data ?? 0);
  } catch (err) {
    console.warn("[openCashShift] repair_open_shift_order_cash_shift_ids excepción:", err);
    return 0;
  }
}

/**
 * Evita mostrar en el turno abierto ordenes creadas antes de su apertura
 * (p. ej. re-etiquetadas por un trigger antiguo al actualizar status).
 */
export function orderBelongsToOpenCashShift(
  order: { created_at?: string | null; sent_to_kitchen_at?: string | null; cash_shift_id?: string | null },
  openShift: OpenCashShift,
): boolean {
  if (order.cash_shift_id && order.cash_shift_id !== openShift.id) return false;
  // Etiqueta explícita del turno abierto: confiar en cash_shift_id (misma regla que mesas / cierre).
  if (order.cash_shift_id && order.cash_shift_id === openShift.id) return true;
  const anchor = order.sent_to_kitchen_at ?? order.created_at;
  if (!anchor || !openShift.opened_at) return false;
  return new Date(anchor).getTime() >= new Date(openShift.opened_at).getTime();
}

/** Valida si una orden pertenece al turno abierto de su sucursal. */
export async function orderBelongsToOpenCashShiftForBranch(
  branchId: string,
  order: { created_at?: string | null; sent_to_kitchen_at?: string | null; cash_shift_id?: string | null },
): Promise<boolean> {
  const openShift = await getOpenCashShiftForBranch(branchId);
  if (!openShift) return false;
  return orderBelongsToOpenCashShift(order, openShift);
}

/** True si la orden pertenece al turno abierto de la sucursal (p. ej. antes de abrir mesa ocupada en UI). */
export async function orderIdBelongsToOpenBranchShift(
  branchId: string,
  orderId: string,
  fetchGateFields: (id: string) => Promise<{
    cash_shift_id: string | null;
    created_at: string | null;
    sent_to_kitchen_at: string | null;
  } | null>,
): Promise<boolean> {
  const openShift = await getOpenCashShiftForBranch(branchId);
  if (!openShift) return false;
  try {
    const fields = await fetchGateFields(orderId);
    if (!fields) return false;
    return orderBelongsToOpenCashShift(fields, openShift);
  } catch {
    return false;
  }
}
