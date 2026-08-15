export type PackingSplitModule = "dispatch" | "servir" | "packing";

export function isPackingQueueOrderType(orderType?: string | null) {
  return orderType === "TAKEOUT" || orderType === "EXPRESS";
}

export function shouldExcludeOrderFromDispatchForPackingSplit(
  order: { order_type?: string | null },
  options: { module: PackingSplitModule; hasEnabledPackers: boolean },
) {
  return (
    options.module === "dispatch"
    && options.hasEnabledPackers
    && isPackingQueueOrderType(order.order_type)
  );
}
