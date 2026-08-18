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

/**
 * Cantidad despachada que debe mostrar el editor temporal.
 * `quantity` representa el total activo objetivo; la parte aun en despacho permanece fija.
 */
export function getDispatchedEditQuantity(item: OrderItemEditSurface): number {
  const targetQuantity = Math.max(0, Number(item.quantity ?? 0));
  const remainingQuantity = Math.max(0, Number(item.quantity_remaining ?? 0));
  return Math.max(0, targetQuantity - remainingQuantity);
}

/** Convierte la cantidad despachada editada al total activo objetivo de la linea. */
export function getDispatchedEditTargetQuantity(
  item: OrderItemEditSurface,
  dispatchedQuantity: number,
): number {
  const remainingQuantity = Math.max(0, Number(item.quantity_remaining ?? 0));
  return remainingQuantity + Math.max(0, Number(dispatchedQuantity ?? 0));
}

/**
 * Vista normal (En despacho): el UI puede pasar la cantidad visible de la seccion
 * (solo remanente si la linea es parcial). Devuelve total activo + remanente objetivo.
 */
export function resolveInDispatchStagingQuantities(
  item: OrderItemEditSurface,
  sectionVisibleQty: number,
): { quantity: number; quantity_remaining: number } {
  const dispatchedQty = Math.max(0, Number(item.quantity_dispatched ?? 0));
  const remainingQty = Math.max(0, Number(item.quantity_remaining ?? 0));
  const visibleQty = Math.max(0, Number(sectionVisibleQty ?? 0));
  const isPartial = dispatchedQty > 0 && remainingQty > 0;

  if (isPartial) {
    return {
      quantity: dispatchedQty + visibleQty,
      quantity_remaining: visibleQty,
    };
  }

  return {
    quantity: visibleQty,
    quantity_remaining: Math.max(0, visibleQty - dispatchedQty),
  };
}

/**
 * Varias lineas iguales se consolidan en UI (p.ej. 1+1 tras subir y enviar).
 * Redistribuye la cantidad objetivo entre esas lineas (baja desde el final).
 */
export function redistributeGroupedItemQuantities(
  itemIds: string[],
  currentQuantities: number[],
  targetTotal: number,
): Array<{ id: string; quantity: number }> {
  if (itemIds.length === 0) return [];

  const qtys = itemIds.map((_, index) => Math.max(0, Number(currentQuantities[index] ?? 0)));
  const target = Math.max(0, Number(targetTotal ?? 0));

  if (itemIds.length === 1) {
    return [{ id: itemIds[0], quantity: target }];
  }

  const currentTotal = qtys.reduce((sum, qty) => sum + qty, 0);
  let diff = target - currentTotal;
  const next = [...qtys];

  if (diff < 0) {
    let remaining = -diff;
    for (let i = next.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const take = Math.min(next[i], remaining);
      next[i] -= take;
      remaining -= take;
    }
  } else if (diff > 0) {
    next[next.length - 1] += diff;
  }

  return itemIds.map((id, index) => ({ id, quantity: next[index] }));
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

/** Total a cobrar: manual en orden especial si está definido; si no, suma de ítems.
 *  Orden especial MIXTA: special_group_total + precio real de unidades no especiales. */
export function resolveOrderChargeTotal(params: {
  is_special?: boolean | null;
  special_total_manual?: number | null;
  special_group_total?: number | null;
  items?: Array<{
    quantity?: number | null;
    unit_price?: number | null;
    cantidad_especial?: number | null;
  }> | null;
  itemsTotal: number;
}): number {
  if (params.is_special && params.special_group_total != null && params.items) {
    const rest = params.items.reduce((sum, item) => {
      const qty = Math.max(0, Number(item.quantity ?? 0));
      const especial = Math.min(Math.max(0, Number(item.cantidad_especial ?? 0)), qty);
      const normal = Math.max(0, qty - especial);
      return sum + normal * Number(item.unit_price ?? 0);
    }, 0);
    return Math.round((Number(params.special_group_total) + rest) * 100) / 100;
  }
  if (params.is_special && params.special_total_manual != null) {
    return Number(params.special_total_manual);
  }
  return params.itemsTotal;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Catálogo de una línea para despacho/servir (precio × cantidad + tarrina si aplica). */
export function computeDispatchItemCatalogTotal(
  item: {
    tray_item_type?: string | null;
    total?: number | null;
    unit_price?: number | null;
    tray_container_cost?: number | null;
  },
  qty: number,
): number {
  const safeQty = Math.max(0, qty);
  if (safeQty <= 0) return 0;
  if (item.tray_item_type === "C") {
    return roundMoney(Number(item.total ?? 0));
  }
  return roundMoney(
    Number(item.unit_price ?? 0) * safeQty
    + (item.tray_item_type === "B" ? Number(item.tray_container_cost ?? 0) : 0),
  );
}

export function prorateOrderChargeAmount(
  chargeTotal: number,
  catalogAmount: number,
  catalogWhole: number,
): number {
  if (catalogWhole <= 0 || catalogAmount <= 0) return 0;
  return roundMoney(chargeTotal * (catalogAmount / catalogWhole));
}

export function resolveDispatchPendingChargeTotal(params: {
  is_special?: boolean | null;
  special_total_manual?: number | null;
  special_group_total?: number | null;
  items: Array<{
    tray_item_type?: string | null;
    total?: number | null;
    unit_price?: number | null;
    tray_container_cost?: number | null;
    quantity_paid?: number | null;
    quantity_dispatchable?: number | null;
    cantidad_especial?: number | null;
    quantity?: number | null;
  }>;
}): {
  pendingTotal: number;
  chargeTotal: number | null;
  catalogOrderTotal: number;
  catalogPendingTotal: number;
} {
  const catalogOrderTotal = params.items.reduce(
    (sum, item) => sum + computeDispatchItemCatalogTotal(
      item,
      Math.max(0, Number(item.quantity_paid ?? item.quantity ?? 0)),
    ),
    0,
  );
  const catalogPendingTotal = params.items.reduce((sum, item) => {
    const qty = Math.max(0, Number(item.quantity_dispatchable ?? 0));
    if (qty <= 0) return sum;
    return sum + computeDispatchItemCatalogTotal(item, qty);
  }, 0);

  const chargeTotal = resolveOrderChargeTotal({
    is_special: params.is_special,
    special_total_manual: params.special_total_manual,
    special_group_total: params.special_group_total,
    items: params.items.map((item) => ({
      quantity: item.quantity_paid ?? item.quantity,
      unit_price: item.unit_price,
      cantidad_especial: item.cantidad_especial,
    })),
    itemsTotal: catalogOrderTotal,
  });

  const hasSpecialCharge = Boolean(params.is_special)
    && (params.special_total_manual != null || params.special_group_total != null);

  const pendingTotal = hasSpecialCharge
    ? prorateOrderChargeAmount(chargeTotal, catalogPendingTotal, catalogOrderTotal)
    : catalogPendingTotal;

  return {
    pendingTotal,
    chargeTotal: hasSpecialCharge ? chargeTotal : null,
    catalogOrderTotal,
    catalogPendingTotal,
  };
}
