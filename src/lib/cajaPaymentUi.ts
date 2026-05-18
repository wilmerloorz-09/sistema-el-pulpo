/**
 * Cobro v2: total, denominaciones y transferencia (`PaymentDialogV2`).
 * Siempre activo: misma UI en desarrollo y en producción (sin depender de `VITE_*`).
 * El flujo clásico (`PaymentDialog.tsx`) sigue en el repo por si hace falta comparar o revertir.
 */
export const USE_PAYMENT_DIALOG_V2 = true;

import type { BranchShiftGate } from "@/hooks/useBranchShiftGate";

/** Cajero secundario: siempre UI móvil de cobro, en teléfono o tablet. */
export function shouldUseSecondaryPaymentDialog(
  shiftGate: BranchShiftGate | null | undefined,
): boolean {
  return Boolean(shiftGate?.isSecondaryCashier);
}

/** Caja principal: solo pantallas >= tablet 10". Secundaria: cualquier tamaño (telefono incluido). */
export function canOpenPaymentUiOnDevice(
  shiftGate: BranchShiftGate | null | undefined,
  isTablet10: boolean,
): boolean {
  return isTablet10 || shouldUseSecondaryPaymentDialog(shiftGate);
}
