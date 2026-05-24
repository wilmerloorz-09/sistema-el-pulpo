/** Reglas de visibilidad en Caja > Por cobrar para cajeros secundarios. */

export interface SecondaryCajaPayableScope {
  userId: string;
  takeoutEnabled: boolean;
  expressEnabled: boolean;
}

export function orderVisibleToSecondaryCashier(
  order: {
    order_type?: string | null;
    created_by?: string | null;
    is_tray_order?: boolean | null;
    is_special?: boolean | null;
  },
  scope: SecondaryCajaPayableScope,
): boolean {
  if (!scope.userId || order.created_by !== scope.userId) {
    return false;
  }

  const orderType = String(order.order_type ?? "");

  if (orderType === "EXTRA" && !order.is_tray_order && !order.is_special) {
    return true;
  }

  if (orderType === "TAKEOUT" && scope.takeoutEnabled) {
    return true;
  }

  if (orderType === "EXPRESS" && scope.expressEnabled) {
    return true;
  }

  return false;
}
