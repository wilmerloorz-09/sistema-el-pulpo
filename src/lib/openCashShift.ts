import { dbSelect } from "@/services/DatabaseService";

export interface OpenCashShift {
  id: string;
  opened_at: string;
}

/** Turno operativo abierto de la sucursal (el mas reciente por opened_at). */
export async function getOpenCashShiftForBranch(branchId: string): Promise<OpenCashShift | null> {
  const rows = await dbSelect<OpenCashShift>("cash_shifts", {
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
