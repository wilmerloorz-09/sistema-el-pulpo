import { dbSelect, dbSelectStrict } from "@/services/DatabaseService";

/** Alineado a caja / detalle de orden: no contar pagos anulados, revertidos o con comprobante pendiente. */
function paymentNotesBlocked(notes: string | null | undefined): boolean {
  const raw = String(notes ?? "");
  return raw.includes("REVERSED:") || raw.includes("VOIDED:") || raw.includes("TRANSFER_PROOF_PENDING:1");
}

/**
 * Suma `quantity_paid` por `order_item_id` desde `payment_items`, excluyendo pagos bloqueados.
 * Misma regla que `fetchActivePaymentItemsForOrderItems` en caja.
 */
export async function fetchActivePaidQuantityByOrderItemId(
  orderItemIds: string[],
  readOpts?: { skipLocalCache?: boolean; strict?: boolean },
): Promise<Record<string, number>> {
  if (orderItemIds.length === 0) return {};

  const read = readOpts?.strict ? dbSelectStrict : dbSelect;

  const paymentItems = await read<any>("payment_items", {
    select: "payment_id, order_item_id, quantity_paid",
    filters: [{ column: "order_item_id", op: "in", value: orderItemIds }],
    skipLocalCache: readOpts?.skipLocalCache,
  });

  const paymentIdSet = new Set<string>((paymentItems ?? []).map((row: any) => row.payment_id).filter(Boolean));
  const paymentIds = Array.from(paymentIdSet);
  if (paymentIds.length === 0) return {};

  const payments = await read<any>("payments", {
    select: "id, notes",
    filters: [{ column: "id", op: "in", value: paymentIds }],
    skipLocalCache: readOpts?.skipLocalCache,
  });

  const blockedPaymentIds = new Set(
    (payments ?? []).filter((p: any) => paymentNotesBlocked(p.notes)).map((p: any) => p.id),
  );

  const map: Record<string, number> = {};
  for (const row of paymentItems ?? []) {
    if (blockedPaymentIds.has(row.payment_id)) continue;
    const oid = String(row.order_item_id ?? "");
    if (!oid) continue;
    map[oid] = (map[oid] ?? 0) + Number(row.quantity_paid ?? 0);
  }
  return map;
}
