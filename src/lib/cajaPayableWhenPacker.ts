/**
 * Con empaquetador habilitado en el turno:
 * - Caja principal: solo para llevar y Express
 * - Caja secundaria: todas excepto para llevar y Express
 * Sin empaquetador: sin filtro extra (todas las por cobrar).
 */
export function filterPayableOrdersWhenPackerPresent<T extends { order_type: string }>(
  orders: T[],
  hasEnabledPacker: boolean,
  isSecondaryCashier = false,
): T[] {
  if (!hasEnabledPacker) return orders;

  if (isSecondaryCashier) {
    return orders.filter(
      (order) => order.order_type !== "TAKEOUT" && order.order_type !== "EXPRESS",
    );
  }

  return orders.filter(
    (order) => order.order_type === "TAKEOUT" || order.order_type === "EXPRESS",
  );
}
