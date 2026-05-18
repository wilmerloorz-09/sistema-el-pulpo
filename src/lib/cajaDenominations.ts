import type { Denomination, ShiftDenom } from "@/hooks/useCaja";

/** Catálogo global: todo lo que el cliente puede entregar al pagar (independiente de la plantilla de apertura). */
export function catalogToPaymentDenoms(catalog: Denomination[]): ShiftDenom[] {
  return catalog.map((denom) => ({
    id: denom.id,
    denomination_id: denom.id,
    label: denom.label,
    denomination_type: denom.denomination_type ?? "coin",
    display_order: denom.display_order ?? 999,
    value: denom.value ?? 0,
    image_url: denom.image_url ?? null,
    qty_initial: 0,
    qty_current: 0,
  }));
}
