export type DispatchSourceLine = {
  id: string;
  quantity_dispatchable: number;
  quantity_pending_prepare: number;
  quantity_ready_available: number;
  quantity_dispatched: number;
};

export type ConsolidatableDispatchItem = {
  id: string;
  description_snapshot: string;
  created_at?: string | null;
  quantity_ordered: number;
  quantity_paid: number;
  quantity_pending_prepare: number;
  quantity_ready_available: number;
  quantity_dispatchable: number;
  quantity_dispatched: number;
  quantity_cancelled: number;
  unit_price: number;
  tray_item_type?: "A" | "B" | "C" | null;
  tray_container_cost?: number;
  status: string;
  modifiers: { description: string }[];
  item_note?: string | null;
  total?: number;
  cantidad_especial?: number;
  sent_to_kitchen_at: string | null;
  paid_at: string | null;
  group_item_ids?: string[];
  source_lines?: DispatchSourceLine[];
};

export function buildDispatchItemGroupKey(item: Pick<
  ConsolidatableDispatchItem,
  "description_snapshot" | "unit_price" | "tray_item_type" | "tray_container_cost" | "item_note" | "modifiers"
>): string {
  const modKey = (item.modifiers || [])
    .map((modifier) => (modifier.description || "").trim().toLowerCase())
    .sort()
    .join("|");
  const noteKey = String(item.item_note ?? "").trim().toLowerCase();

  return [
    item.description_snapshot.trim().toLowerCase(),
    item.unit_price,
    item.tray_item_type ?? "",
    Number(item.tray_container_cost ?? 0),
    noteKey,
    modKey,
  ].join("::");
}

export function consolidateDispatchOrderItems<T extends ConsolidatableDispatchItem>(items: T[]): T[] {
  const groups = new Map<string, T>();

  for (const item of items) {
    const key = buildDispatchItemGroupKey(item);
    const sourceLine: DispatchSourceLine = {
      id: item.id,
      quantity_dispatchable: item.quantity_dispatchable,
      quantity_pending_prepare: item.quantity_pending_prepare,
      quantity_ready_available: item.quantity_ready_available,
      quantity_dispatched: item.quantity_dispatched,
    };

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...item,
        group_item_ids: [item.id],
        source_lines: [sourceLine],
      });
      continue;
    }

    existing.quantity_ordered += item.quantity_ordered;
    existing.quantity_paid += item.quantity_paid;
    existing.quantity_pending_prepare += item.quantity_pending_prepare;
    existing.quantity_ready_available += item.quantity_ready_available;
    existing.quantity_dispatchable += item.quantity_dispatchable;
    existing.quantity_dispatched += item.quantity_dispatched;
    existing.quantity_cancelled += item.quantity_cancelled;
    existing.total = Number(existing.total ?? 0) + Number(item.total ?? 0);
    existing.cantidad_especial = Number(existing.cantidad_especial ?? 0) + Number(item.cantidad_especial ?? 0);
    existing.group_item_ids = [...(existing.group_item_ids ?? [existing.id]), item.id];
    existing.source_lines = [...(existing.source_lines ?? []), sourceLine];

    if (item.created_at && (!existing.created_at || item.created_at < existing.created_at)) {
      existing.created_at = item.created_at;
    }
    if (
      item.sent_to_kitchen_at
      && (!existing.sent_to_kitchen_at || item.sent_to_kitchen_at < existing.sent_to_kitchen_at)
    ) {
      existing.sent_to_kitchen_at = item.sent_to_kitchen_at;
    }
  }

  return Array.from(groups.values());
}

export function buildDispatchAllocations(
  item: ConsolidatableDispatchItem,
  qty: number,
): Array<{ order_item_id: string; quantity_dispatched: number }> {
  const requestedQty = Math.max(0, Math.floor(Number(qty ?? 0)));
  if (requestedQty <= 0) return [];

  const sourceLines = item.source_lines?.length
    ? item.source_lines
    : [{
      id: item.id,
      quantity_dispatchable: item.quantity_dispatchable,
      quantity_pending_prepare: item.quantity_pending_prepare,
      quantity_ready_available: item.quantity_ready_available,
      quantity_dispatched: item.quantity_dispatched,
    }];

  let remaining = Math.min(requestedQty, item.quantity_dispatchable);
  const allocations: Array<{ order_item_id: string; quantity_dispatched: number }> = [];

  for (const line of sourceLines) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, line.quantity_dispatchable));
    if (take <= 0) continue;
    allocations.push({ order_item_id: line.id, quantity_dispatched: take });
    remaining -= take;
  }

  return allocations;
}
