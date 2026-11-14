/**
 * Con empaquetador habilitado en el turno, Recaudar (caja principal)
 * solo muestra para llevar y Express.
 */
export function filterPayableOrdersWhenPackerPresent<T extends { order_type: string }>(
  orders: T[],
  hasEnabledPacker: boolean,
): T[] {
  if (!hasEnabledPacker) return orders;
  return orders.filter(
    (order) => order.order_type === "TAKEOUT" || order.order_type === "EXPRESS",
  );
}
