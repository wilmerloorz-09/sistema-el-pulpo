export type KitchenPendingItem = {
  id: string;
  quantity: number;
  unit_price: number;
  tray_container_cost?: number | null;
  total?: number;
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
  const withoutTemp = staged.filter((item) => !isTemporaryKitchenItemId(item.id));
  const stagedIds = new Set(withoutTemp.map((item) => item.id));
  const additions = server.filter((item) => !stagedIds.has(item.id));

  if (!hasTemporaryItems && additions.length === 0) {
    return staged;
  }

  return [...withoutTemp, ...additions];
}
