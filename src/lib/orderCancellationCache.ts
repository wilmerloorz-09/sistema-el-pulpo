export function applyCancellationToOrderCache(
  current: any,
  selections: Array<{ order_item_id: string; quantity_cancelled: number }>,
  cancellationType: "partial" | "total",
) {
  if (!current) return current;

  const cancelledMap = Object.fromEntries(
    selections.map((selection) => [selection.order_item_id, Number(selection.quantity_cancelled) || 0]),
  );

  const nextItems = (current.items ?? [])
    .map((item: any) => {
      const cancelled = cancelledMap[item.id] ?? 0;
      if (!cancelled) return item;

      const originalQuantity = Number(item.original_quantity ?? item.quantity ?? 0);
      const previousCancelled = Number(item.cancelled_quantity ?? 0);
      const totalCancelled = Math.min(originalQuantity, previousCancelled + cancelled);
      const activeQuantity = Math.max(0, originalQuantity - totalCancelled);

      return {
        ...item,
        quantity: activeQuantity,
        cancelled_quantity: totalCancelled,
        total: Math.round(activeQuantity * Number(item.unit_price ?? 0) * 100) / 100,
        status: activeQuantity <= 0 ? "CANCELLED" : item.status,
      };
    })
    .filter((item: any) => item.quantity > 0);

  return {
    ...current,
    status: cancellationType === "total" || nextItems.length === 0 ? "CANCELLED" : current.status,
    items: nextItems,
  };
}
