export type DispatchModuleRoute = "dispatch" | "servir" | "packing";

export type DispatchRouteOrder = {
  order_type?: string | null;
  is_special?: boolean | null;
};

export type DispatchRouteItem = {
  tray_item_type?: string | null;
};

export function isPackingOrderType(orderType: string | null | undefined): boolean {
  return orderType === "TAKEOUT" || orderType === "EXPRESS";
}

/** Órdenes de mesa/extra que pueden traer líneas “Con envase” (tray B). */
export function isTableLikeOrderType(orderType: string | null | undefined): boolean {
  return orderType === "DINE_IN" || orderType === "TABLE" || orderType === "EXTRA";
}

/** Ítem agregado desde pestaña Con envase (o bandeja tipo B). */
export function isPackingEnvaseItem(item: DispatchRouteItem): boolean {
  return String(item.tray_item_type ?? "").toUpperCase() === "B";
}

export function shouldReserveOrderForPacking(
  order: DispatchRouteOrder,
  hasEnabledPacker: boolean,
): boolean {
  // Especiales siguen el tipo (para llevar/express → empaquetador si hay empacador).
  return hasEnabledPacker && isPackingOrderType(order.order_type);
}

/**
 * La orden puede aparecer en Empaquetador:
 * - Para llevar / Express (incl. especial), siempre.
 * - Mesa/extra (incl. especial) si hay empaquetador (luego se filtran solo líneas Con envase).
 */
export function orderMayAppearInPackingModule(
  order: DispatchRouteOrder,
  hasEnabledPacker: boolean,
): boolean {
  if (isPackingOrderType(order.order_type)) return true;
  return hasEnabledPacker && isTableLikeOrderType(order.order_type);
}

/** Línea que Empaquetador debe mostrar / Despacho-Servir deben ocultar si hay packer. */
export function itemBelongsToPackingRoute(
  order: DispatchRouteOrder,
  item: DispatchRouteItem,
  hasEnabledPacker: boolean,
): boolean {
  if (isPackingOrderType(order.order_type)) return true;
  return hasEnabledPacker && isTableLikeOrderType(order.order_type) && isPackingEnvaseItem(item);
}

export function orderMatchesDispatchModuleRoute(
  order: DispatchRouteOrder,
  moduleRoute: DispatchModuleRoute,
  hasEnabledPacker: boolean,
): boolean {
  if (moduleRoute === "packing") {
    return orderMayAppearInPackingModule(order, hasEnabledPacker);
  }

  if (moduleRoute === "dispatch" || moduleRoute === "servir") {
    // Con empaquetador activo, Para llevar/Express van a Empaquetador.
    // Mesas siguen en Despacho/Servir (líneas Con envase se excluyen a nivel ítem).
    return !shouldReserveOrderForPacking(order, hasEnabledPacker);
  }

  return true;
}

/**
 * Filtro de ítems por módulo.
 * - packing: solo líneas de empaque
 * - dispatch/servir: ocultar líneas Con envase de mesa cuando hay packer
 */
export function itemMatchesDispatchModuleRoute(
  order: DispatchRouteOrder,
  item: DispatchRouteItem,
  moduleRoute: DispatchModuleRoute,
  hasEnabledPacker: boolean,
): boolean {
  const packingLine = itemBelongsToPackingRoute(order, item, hasEnabledPacker);
  if (moduleRoute === "packing") return packingLine;
  // Con empacador: Para llevar/Express y Con envase de mesa solo en Empaquetador.
  if (hasEnabledPacker && packingLine) return false;
  return true;
}
