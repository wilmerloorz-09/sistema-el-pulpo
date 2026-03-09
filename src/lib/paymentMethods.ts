export interface PaymentMethodOption {
  id: string;
  name: string;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
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

  const efectivo = methods.find((method) => normalizeText(method.name) === "efectivo");
  if (efectivo) return efectivo.id;

  return methods[0].id;
}
