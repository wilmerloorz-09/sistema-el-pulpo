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
  if (String(item.status ?? "") === "DISPATCHED") return true;
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
 * Cambios que sí deben confirmarse con "Enviar a cocina".
 * Reducir/eliminar líneas ya despachadas NO aplica: eso va por "Editar orden".
 */
export function hasKitchenPendingSendChanges(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): boolean {
  const pendingById = new Map(pending.map((item) => [item.id, item]));
  const baselineById = new Map(baseline.map((item) => [item.id, item]));

  for (const [id, base] of baselineById) {
    const pend = pendingById.get(id);
    const baseQty = effectiveQuantity(base);
    const pendQty = pend ? effectiveQuantity(pend) : 0;
    if (pendQty === baseQty) continue;

    // Baja o baja a 0 de una línea despachada: ignorar para Enviar a cocina.
    if (pendQty < baseQty && isDispatchedLine(base)) {
      continue;
    }

    return true;
  }

  for (const [id, pend] of pendingById) {
    if (baselineById.has(id)) continue;
    if (effectiveQuantity(pend) > 0) return true;
  }

  return false;
}

/** Delta monetario solo de cambios que aplican a Enviar a cocina. */
export function computeKitchenSendMoneyDeltaForSend(
  baseline: KitchenPendingItem[],
  pending: KitchenPendingItem[],
): number {
  const pendingById = new Map(pending.map((item) => [item.id, item]));
  let delta = 0;

  for (const base of baseline) {
    const pend = pendingById.get(base.id);
    const baseQty = effectiveQuantity(base);
    const pendQty = pend ? effectiveQuantity(pend) : 0;
    if (pendQty === baseQty) continue;
    if (pendQty < baseQty && isDispatchedLine(base)) continue;

    const baseCharge = computeItemChargeTotal(base);
    const pendCharge = pend ? computeItemChargeTotal({ ...pend, quantity: pendQty }) : 0;
    delta += pendCharge - baseCharge;
  }

  for (const pend of pending) {
    if (baseline.some((b) => b.id === pend.id)) continue;
    delta += computeItemChargeTotal(pend);
  }

  return Math.round(delta * 100) / 100;
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
