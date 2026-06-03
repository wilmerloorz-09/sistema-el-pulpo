/** Notas de pago que no deben sumar al consumo elegible (misma regla que sync en BD). */
export function esPagoActivoParaConsumo(notes: string | null | undefined): boolean {
  const n = (notes ?? "").toUpperCase();
  return !n.includes("REVERSED:") && !n.includes("VOIDED:") && !n.includes("TRANSFER_PROOF_PENDING:1");
}

export type OrdenConsumoPromocion = {
  id: string;
  total: number | null;
  is_special?: boolean | null;
  special_total_manual?: number | null;
};

export function calcularConsumoOrdenPromocion(
  orden: OrdenConsumoPromocion,
  pagosActivosPorOrden: Record<string, number>,
): number {
  if (orden.is_special && orden.special_total_manual != null) {
    return Number(orden.special_total_manual);
  }
  const totalCabecera = orden.total != null ? Number(orden.total) : 0;
  if (totalCabecera > 0) return totalCabecera;
  return Number(pagosActivosPorOrden[orden.id] ?? 0);
}

export function cumpleConsumoMinimoPromocion(consumo: number, consumoMinimo: number): boolean {
  return consumo + 1e-6 >= consumoMinimo;
}
