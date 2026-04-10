export type PaymentVoidState = "active" | "captured" | "completed" | "voided" | "refunded";

export interface PaymentVoidPolicyInput {
  paymentExists: boolean;
  currentShiftExists: boolean;
  currentShiftOpen: boolean;
  paymentShiftId: string | null;
  currentShiftId: string | null;
  paymentStatus: PaymentVoidState | string | null;
  alreadyVoided: boolean;
  supervisorAuthorized: boolean;
  reason: string;
}

export function getPaymentVoidValidationMessage(input: PaymentVoidPolicyInput): string | null {
  if (!input.paymentExists) {
    return "El pago no existe";
  }

  if (!input.currentShiftExists || !input.currentShiftId) {
    return "No se encontro el turno actual";
  }

  if (!input.currentShiftOpen) {
    return "No se puede anular un pago de un turno cerrado";
  }

  if (!input.paymentShiftId || input.paymentShiftId !== input.currentShiftId) {
    return "El pago solo puede anularse dentro del mismo turno en que fue registrado";
  }

  if (input.alreadyVoided || String(input.paymentStatus ?? "").toLowerCase() === "voided") {
    return "El pago ya fue anulado";
  }

  if (!["active", "captured", "completed"].includes(String(input.paymentStatus ?? "").toLowerCase())) {
    return "El pago no esta en un estado anulable";
  }

  if (!input.supervisorAuthorized) {
    return "Solo un supervisor puede autorizar la anulacion del pago";
  }

  if (!input.reason.trim()) {
    return "Debes indicar un motivo para anular el pago";
  }

  return null;
}
