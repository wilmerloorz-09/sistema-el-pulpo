export type DispatchModuleRoute = "dispatch" | "servir" | "packing";

export type DispatchRouteOrder = {
  order_type?: string | null;
  is_special?: boolean | null;
};

export function isPackingOrderType(orderType: string | null | undefined): boolean {
  return orderType === "TAKEOUT" || orderType === "EXPRESS";
}

export function shouldReserveOrderForPacking(
  order: DispatchRouteOrder,
  hasEnabledPacker: boolean,
): boolean {
  return hasEnabledPacker && isPackingOrderType(order.order_type) && !order.is_special;
}

export function orderMatchesDispatchModuleRoute(
  order: DispatchRouteOrder,
  moduleRoute: DispatchModuleRoute,
  hasEnabledPacker: boolean,
): boolean {
  if (moduleRoute === "packing") {
    return isPackingOrderType(order.order_type) && !order.is_special;
  }

  if (moduleRoute === "dispatch") {
    return !shouldReserveOrderForPacking(order, hasEnabledPacker);
  }

  return true;
}
