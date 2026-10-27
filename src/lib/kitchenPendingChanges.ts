import { isOrderItemFullyDispatched } from "@/lib/orderFlow";

export type KitchenPendingItem = {
  id: string;
  quantity: number;
  unit_price: number;
  tray_container_cost?: number | null;
  total?: number;
  status?: string | null;
  quantity_dispatched?: number | null;
  quantity_remaining?: number | null;
};

export function computeItemChargeTotal(item: KitchenPendingItem): number {
  const qty = Math.max(0, Number(item.quantity ?? 0));
  if (qty <= 0) return 0;

  const unitPrice = Number(item.unit_price ?? 0);
  const container = Number(item.tray_container_cost ?? 0);
  return qty * unitPrice + container;
}

export function computeOrderItemsChargeTotal(items: KitchenPendingItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + computeItemChargeTotal(item), 0) * 100) / 100;
}

function effectiveQuantity(item: KitchenPendingItem): number {
  return Math.max(0, Number(item.quantity ?? 0));
}

function isDispatchedLine(item: KitchenPendingItem): boolean {
  // Solo cantidades operativas: el status legacy puede decir DISPATCHED
  // mientras la linea aun tenga remanente en EN DESPACHO.
  return isOrderItemFullyDispatched(item);
}

export function hasKitchenPendingChanges(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): boolean {
  const baselineQtyById = new Map(baseline.map((item) => [item.id, effectiveQuantity(item)]));
  const pendingQtyById = new Map(pending.map((item) => [item.id, effectiveQuantity(item)]));

  for (const [id, baselineQty] of baselineQtyById) {
    if ((pendingQtyById.get(id) ?? 0) !== baselineQty) return true;
  }

  for (const [id, pendingQty] of pendingQtyById) {
    if (!baselineQtyById.has(id) && pendingQty > 0) return true;
  }

  return false;
}

/**
 * Cambios que sí deben confirmarse con "Enviar a cocina"
 * (incluye bajas de líneas ya despachadas).
 */
export function hasKitchenPendingSendChanges(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): boolean {
  return hasKitchenPendingChanges(baseline, pending);
}

/** Bajas de líneas 100% despachadas (van por cancel_order_quantities). */
export function collectDispatchedCancellationSelections(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): Array<{ order_item_id: string; quantity_cancelled: number }> {
  const pendingById = new Map(pending.map((item) => [item.id, item]));
  const selections: Array<{ order_item_id: string; quantity_cancelled: number }> = [];

  for (const base of baseline) {
    if (!isDispatchedLine(base)) continue;
    const pend = pendingById.get(base.id);
    const baseQty = effectiveQuantity(base);
    const pendQty = pend ? effectiveQuantity(pend) : 0;
    const quantityCancelled = Math.max(0, baseQty - pendQty);
    if (quantityCancelled <= 0) continue;
    selections.push({
      order_item_id: base.id,
      quantity_cancelled: quantityCancelled,
    });
  }

  return selections;
}

/** Delta monetario de cambios que aplican a Enviar a cocina. */
export function computeKitchenSendMoneyDeltaForSend(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): number {
  return computeKitchenSendMoneyDelta(baseline, pending);
}

export function computeKitchenSendMoneyDelta(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): number {
  const baselineTotal = computeOrderItemsChargeTotal(baseline);
  const pendingTotal = computeOrderItemsChargeTotal(
    pending.filter((item) => effectiveQuantity(item) > 0),
  );
  return Math.round((pendingTotal - baselineTotal) * 100) / 100;
}

export function formatKitchenSendMoneyDelta(delta: number): string {
  if (delta === 0) return "$0.00";
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}$${delta.toFixed(2)}`;
}

export function isTemporaryKitchenItemId(itemId: string | null | undefined): boolean {
  return String(itemId ?? "").startsWith("temp-");
}

/** Elimina ids optimistas temp-* y trae líneas reales del servidor (despacho primero). */
export function reconcileKitchenStagedItems<T extends { id: string }>(
  staged: T[],
  server: T[],
): T[] {
  const hasTemporaryItems = staged.some((item) => isTemporaryKitchenItemId(item.id));
  // Sin temps no hay nada que reconciliar: no reinyectar lineas del servidor
  // (evita que un borrador eliminado localmente reaparezca tras un refetch).
  if (!hasTemporaryItems) {
    return staged;
  }

  const withoutTemp = staged.filter((item) => !isTemporaryKitchenItemId(item.id));
  const stagedIds = new Set(withoutTemp.map((item) => item.id));
  const additions = server.filter((item) => !stagedIds.has(item.id));

  return [...withoutTemp, ...additions];
}

/** Incorpora temps del servidor que el staging no tiene aún (add optimista). */
export function mergeMissingKitchenTempItems<T extends { id: string }>(
  staged: T[],
  server: T[],
): T[] {
  const seen = new Set(staged.map((item) => item.id));
  const missingTemps = server.filter(
    (item) => isTemporaryKitchenItemId(item.id) && !seen.has(item.id),
  );
  if (missingTemps.length === 0) return staged;
  return [...staged, ...missingTemps];
}
