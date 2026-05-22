export function isExpressOrder(order: {
  order_type?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
} | null | undefined): boolean {
  return order?.order_type === "EXPRESS" && !order?.is_tray_order && !order?.is_special;
}

export function isExtraOrder(order: {
  order_type?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
} | null | undefined): boolean {
  return order?.order_type === "EXTRA" && !order?.is_tray_order && !order?.is_special;
}

/** Express enviado y pendiente en modulo Despacho (aun no cobrado). */
export function expressOrderAwaitingDispatch(order: {
  order_type?: string | null;
  status?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
} | null | undefined): boolean {
  if (!isExpressOrder(order)) return false;
  const st = String(order?.status ?? "");
  return st === "SENT_TO_KITCHEN" || st === "READY";
}

/** Express ya despachada; debe cobrarse en caja (cobro total). */
export function expressOrderAwaitingPayment(order: {
  order_type?: string | null;
  status?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
} | null | undefined): boolean {
  return isExpressOrder(order) && String(order?.status ?? "") === "KITCHEN_DISPATCHED";
}

export function getSentItemStageLabel(orderType?: string | null): string {
  return orderType === "EXPRESS" ? "En despacho" : "En caja";
}

export function getOrderStatusLabel(
  status: string | null | undefined,
  orderType?: string | null,
  closedAt?: string | null,
): string {
  const st = String(status ?? "");
  if (orderType === "EXTRA") {
    if (closedAt) return "Cerrada";
    if (st === "PAID") return "Pagada";
    if (st === "KITCHEN_DISPATCHED") return "Despachada";
  }
  if (orderType === "EXPRESS") {
    switch (st) {
      case "DRAFT":
        return "Borrador";
      case "SENT_TO_KITCHEN":
        return "En despacho";
      case "READY":
        return "Lista para despachar";
      case "KITCHEN_DISPATCHED":
        return "Despachada — por cobrar";
      case "PAID":
        return "Pagada";
      case "CANCELLED":
        return "Cancelada";
      default:
        return st;
    }
  }

  switch (st) {
    case "DRAFT":
      return "Borrador";
    case "SENT_TO_KITCHEN":
      return "En caja";
    case "READY":
      return "Lista para despachar";
    case "KITCHEN_DISPATCHED":
      return "Despachada";
    case "PAID":
      return "Pagada";
    case "CANCELLED":
      return "Cancelada";
    default:
      return st;
  }
}

/** Solo ordenes que deben aparecer en Caja > Por cobrar. */
export function orderIsPayableInCaja(order: {
  order_type?: string | null;
  status?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
}): boolean {
  if (isExpressOrder(order)) {
    return String(order.status ?? "") === "KITCHEN_DISPATCHED";
  }
  return ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"].includes(String(order.status ?? ""));
}
