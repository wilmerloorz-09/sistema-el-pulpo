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

/** Para llevar operativo: TAKEOUT sin bandeja ni orden especial. */
export function isPureTakeoutOrder(order: {
  order_type?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
} | null | undefined): boolean {
  return (
    order?.order_type === "TAKEOUT"
    && !order?.is_tray_order
    && !order?.is_special
  );
}

export function getSentItemStageLabel(orderType?: string | null, workflowMode?: string | null): string {
  const isExpress = orderType === "EXPRESS";
  const isDispatchFirst = isExpress || (workflowMode === "DISPATCH_THEN_CASH" && orderType !== "TAKEOUT");
  return isDispatchFirst ? "En despacho" : "En caja";
}

export function getOrderStatusLabel(
  status: string | null | undefined,
  orderType?: string | null,
  closedAt?: string | null,
  paidAt?: string | null,
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
        return paidAt ? "Despachada" : "Despachada — por cobrar";
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

export type OrderItemEditSurface = {
  status?: string | null;
  quantity_dispatched?: number | null;
  quantity_remaining?: number | null;
  quantity_requested?: number | null;
  quantity_ordered?: number | null;
  quantity?: number | null;
};

/** Linea totalmente despachada (etiqueta "Despachado"). */
export function isOrderItemFullyDispatched(item: OrderItemEditSurface): boolean {
  const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
  const remainingQty = Math.max(0, Number(item.quantity_remaining ?? 0));
  return dispatchedQty > 0 && remainingQty <= 0;
}

/**
 * Despacho primero: lineas "En despacho" / parciales / borrador editables en vista normal
 * sin entrar a "Editar orden".
 */
export function isOrderItemFreelyEditableInDispatchFirst(item: OrderItemEditSurface): boolean {
  if (String(item.status ?? "") === "DRAFT") return true;

  const requestedQty = Math.max(0, Number(item.quantity_requested ?? 0));
  if (
    item.status === "ITEM_PENDING_CANCELLATION" ||
    item.status === "PENDING_CANCELLATION" ||
    requestedQty > 0
  ) {
    return false;
  }

  if (item.status === "PAID") return false;
  if (isOrderItemFullyDispatched(item)) return false;

  return true;
}

/** Despacho primero + modo "Editar orden": solo lineas ya despachadas (y nuevas en buffer). */
export function isOrderItemEditableInDispatchFirstEditMode(item: OrderItemEditSurface): boolean {
  if (String(item.status ?? "") === "DRAFT") return true;
  return Number(item.quantity_dispatched ?? 0) > 0 || item.status === "DISPATCHED";
}

export function isDispatchFirstOrder(
  order: {
    order_type?: string | null;
    is_tray_order?: boolean | null;
    is_special?: boolean | null;
  } | null | undefined,
  workflowMode: string,
): boolean {
  return isExpressOrder(order)
    || (workflowMode === "DISPATCH_THEN_CASH" && !isPureTakeoutOrder(order));
}

/**
 * Despacho primero: lineas enviadas sin despachar se eliminan directo (sin dialogo de anulacion).
 */
export function isPureDraftOrderItem(
  item: OrderItemEditSurface & {
    quantity_cancellable?: number | null;
    quantity_ready_available?: number | null;
  },
): boolean {
  if (String(item.status ?? "") !== "DRAFT") return false;

  const cancellableQty = Math.max(0, Number(item.quantity_cancellable ?? 0));
  const readyQty = Math.max(0, Number(item.quantity_ready_available ?? 0));
  const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
  const sentQty = Math.max(0, Number((item as { quantity_sent?: number }).quantity_sent ?? 0));

  return cancellableQty <= 0 && readyQty <= 0 && dispatchedQty <= 0 && sentQty <= 0;
}

export function shouldDirectRemoveSentItemInDispatchFirst(
  item: OrderItemEditSurface & {
    quantity_paid?: number | null;
    quantity_cancellable?: number | null;
    quantity_ready_available?: number | null;
    quantity_sent?: number | null;
  },
  order: { order_type?: string | null; is_tray_order?: boolean | null; is_special?: boolean | null } | null | undefined,
  workflowMode: string,
): boolean {
  if (!order || !isDispatchFirstOrder(order, workflowMode)) return false;
  if (Number(item.quantity_paid ?? 0) > 0) return false;
  if (!isOrderItemFreelyEditableInDispatchFirst(item)) return false;
  return !isPureDraftOrderItem(item);
}

export function resolveDispatchFirstItemCancelQuantity(
  item: OrderItemEditSurface & { quantity_cancellable?: number | null },
  targetQuantity: number,
): number {
  const visibleQty = Math.max(0, Number(item.quantity ?? 0));
  const cancellableQty = Math.max(
    0,
    Number(item.quantity_cancellable ?? 0),
    visibleQty,
  );

  if (targetQuantity <= 0) {
    return cancellableQty;
  }

  return Math.min(cancellableQty, Math.max(0, visibleQty - targetQuantity));
}

export function isSentItemRemovalBlockedError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("flujo de anulacion")
    || message.includes("flujo de anulación")
    || message.includes("requiere autorizacion")
    || message.includes("requiere autorización")
    || message.includes("no hay cantidades pendientes")
  );
}

/** Solo ordenes que deben aparecer en Caja > Por cobrar. */
export function orderIsPayableInCaja(order: {
  order_type?: string | null;
  status?: string | null;
  is_tray_order?: boolean | null;
  is_special?: boolean | null;
}): boolean {
  return ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"].includes(String(order.status ?? ""));
}

/** Orden especial con total manual explícito en $0 (no aplica si special_total_manual es null). */
export function isSpecialOrderExplicitZeroTotal(order: {
  is_special?: boolean | null;
  special_total_manual?: number | null;
} | null | undefined): boolean {
  if (!order?.is_special) return false;
  if (order.special_total_manual == null) return false;
  return Number(order.special_total_manual) === 0;
}

/** Total a cobrar: manual en orden especial si está definido; si no, suma de ítems. */
export function resolveOrderChargeTotal(params: {
  is_special?: boolean | null;
  special_total_manual?: number | null;
  itemsTotal: number;
}): number {
  if (params.is_special && params.special_total_manual != null) {
    return Number(params.special_total_manual);
  }
  return params.itemsTotal;
}
