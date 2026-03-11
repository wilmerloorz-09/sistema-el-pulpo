export interface OperationalQuantitySnapshot {
  quantityOrdered: number;
  quantityReadyTotal: number;
  quantityReadyAvailable: number;
  quantityDispatched: number;
  quantityCancelledPending: number;
  quantityCancelledReady: number;
  quantityCancelledTotal: number;
  quantityPendingPrepare: number;
}

function asInt(value: unknown) {
  return Math.max(0, Math.floor(Number(value ?? 0)));
}

export function computeOperationalQuantities(input: {
  quantityOrdered: number;
  quantityReadyTotal?: number;
  quantityDispatched?: number;
  quantityCancelledPending?: number;
  quantityCancelledReady?: number;
}): OperationalQuantitySnapshot {
  const quantityOrdered = asInt(input.quantityOrdered);
  const quantityReadyTotal = asInt(input.quantityReadyTotal);
  const quantityDispatched = asInt(input.quantityDispatched);
  const quantityCancelledPending = asInt(input.quantityCancelledPending);
  const quantityCancelledReady = asInt(input.quantityCancelledReady);
  const quantityCancelledTotal = quantityCancelledPending + quantityCancelledReady;

  const quantityReadyAvailable = Math.max(0, quantityReadyTotal - quantityDispatched - quantityCancelledReady);
  const quantityPendingPrepare = Math.max(0, quantityOrdered - quantityReadyTotal - quantityCancelledPending);

  return {
    quantityOrdered,
    quantityReadyTotal,
    quantityReadyAvailable,
    quantityDispatched,
    quantityCancelledPending,
    quantityCancelledReady,
    quantityCancelledTotal,
    quantityPendingPrepare,
  };
}

export function sumRowsByItem<Row extends Record<string, unknown>>(
  rows: Row[],
  itemIdKey: keyof Row,
  quantityKey: keyof Row,
  predicate?: (row: Row) => boolean,
) {
  const map: Record<string, number> = {};

  for (const row of rows) {
    if (predicate && !predicate(row)) continue;

    const itemId = String(row[itemIdKey] ?? "");
    if (!itemId) continue;

    map[itemId] = (map[itemId] ?? 0) + asInt(row[quantityKey]);
  }

  return map;
}
