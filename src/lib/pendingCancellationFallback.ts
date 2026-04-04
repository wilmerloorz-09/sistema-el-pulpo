type PendingCancellationFallbackEntry = {
  requested_at: string;
  items: Array<{
    order_item_id: string;
    quantity_cancelled: number;
  }>;
};

const STORAGE_KEY = "el-pulpo:pending-cancellation-fallbacks";

function readStore(): Record<string, PendingCancellationFallbackEntry> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, PendingCancellationFallbackEntry>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function savePendingCancellationFallback(
  orderId: string,
  requestedAt: string,
  items: Array<{ order_item_id: string; quantity_cancelled: number }>,
) {
  const normalizedItems = items
    .map((item) => ({
      order_item_id: String(item.order_item_id ?? "").trim(),
      quantity_cancelled: Math.max(0, Math.floor(Number(item.quantity_cancelled ?? 0))),
    }))
    .filter((item) => item.order_item_id && item.quantity_cancelled > 0);

  if (!orderId || normalizedItems.length === 0) return;

  const store = readStore();
  const existingItems = store[orderId]?.items ?? [];
  const mergedMap = new Map<string, number>();

  for (const item of existingItems) {
    const itemId = String(item.order_item_id ?? "").trim();
    const qty = Math.max(0, Math.floor(Number(item.quantity_cancelled ?? 0)));
    if (!itemId || qty <= 0) continue;
    mergedMap.set(itemId, (mergedMap.get(itemId) ?? 0) + qty);
  }

  for (const item of normalizedItems) {
    mergedMap.set(item.order_item_id, (mergedMap.get(item.order_item_id) ?? 0) + item.quantity_cancelled);
  }

  store[orderId] = {
    requested_at: requestedAt,
    items: Array.from(mergedMap.entries()).map(([order_item_id, quantity_cancelled]) => ({
      order_item_id,
      quantity_cancelled,
    })),
  };
  writeStore(store);
}

export function clearPendingCancellationFallback(orderId: string) {
  if (!orderId) return;
  const store = readStore();
  if (!(orderId in store)) return;
  delete store[orderId];
  writeStore(store);
}

export function getPendingCancellationFallbackMap(orderId: string): Record<string, number> {
  if (!orderId) return {};
  const entry = readStore()[orderId];
  if (!entry) return {};

  return entry.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.order_item_id] = (acc[item.order_item_id] ?? 0) + item.quantity_cancelled;
    return acc;
  }, {});
}
