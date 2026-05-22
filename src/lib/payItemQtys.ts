import type { PayableOrder } from "@/hooks/useCaja";

/** Todas las unidades pendientes seleccionadas para cobrar (cobro total por defecto). */
export function buildPayItemQtysAllPending(order: PayableOrder): Record<string, number> {
  const next: Record<string, number> = {};
  for (const item of order.items ?? []) {
    const pending = Math.floor(Number(item.quantity_pending ?? 0));
    if (pending > 0) next[item.id] = pending;
  }
  return next;
}

/** Ninguna unidad seleccionada: todo queda en la columna izquierda del diálogo de división. */
export function buildPayItemQtysNoneSelected(order: PayableOrder): Record<string, number> {
  const next: Record<string, number> = {};
  for (const item of order.items ?? []) {
    const pending = Math.floor(Number(item.quantity_pending ?? 0));
    if (pending > 0) next[item.id] = 0;
  }
  return next;
}

export function hasPayItemQtySelection(
  order: PayableOrder,
  qtyByItemId: Record<string, number>,
): boolean {
  return (order.items ?? []).some((item) => (qtyByItemId[item.id] ?? 0) > 0);
}
