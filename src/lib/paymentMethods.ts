export interface PaymentMethodOption {
  id: string;
  name: string;
}

export function normalizePaymentMethodName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function isCashPaymentMethodName(value: string): boolean {
  return normalizePaymentMethodName(value) === "efectivo";
}

export function isTransferPaymentMethodName(value: string): boolean {
  return normalizePaymentMethodName(value).includes("transfer");
}

export function isCardPaymentMethodName(value: string): boolean {
  const normalized = normalizePaymentMethodName(value);
  return (
    normalized.includes("tarjeta")
    || normalized.includes("card")
    || normalized.includes("credito")
    || normalized.includes("debito")
  );
}

/** Clasificacion visual del metodo de pago (para iconos en listados). */
export type PaymentMethodVisualKind = "cash" | "transfer" | "card" | "other";

export function getPaymentMethodVisualKind(value: string): PaymentMethodVisualKind {
  if (isCashPaymentMethodName(value)) return "cash";
  if (isTransferPaymentMethodName(value)) return "transfer";
  if (isCardPaymentMethodName(value)) return "card";
  return "other";
}

export function dedupePaymentMethods(methods: PaymentMethodOption[]): PaymentMethodOption[] {
  const seen = new Set<string>();
  const unique: PaymentMethodOption[] = [];

  for (const method of methods) {
    if (!method?.id || seen.has(method.id)) continue;
    seen.add(method.id);
    unique.push(method);
  }

  return unique;
}

export function getDefaultPaymentMethodId(methods: PaymentMethodOption[]): string {
  if (methods.length === 0) return "";

  const efectivo = methods.find((method) => isCashPaymentMethodName(method.name));
  if (efectivo) return efectivo.id;

  return methods[0].id;
}

export function getCashPaymentMethod(methods: PaymentMethodOption[]): PaymentMethodOption | null {
  return methods.find((method) => isCashPaymentMethodName(method.name)) ?? null;
}
