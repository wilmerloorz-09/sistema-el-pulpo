export const sanitizeIntegerInput = (value: string) => value.replace(/\D/g, "");

export const sanitizeDecimalInput = (value: string) => {
  const normalized = value.replace(",", ".").replace(/[^0-9.]/g, "");
  const [integerPart = "", ...decimalParts] = normalized.split(".");

  if (decimalParts.length === 0) return integerPart;

  return `${integerPart}.${decimalParts.join("")}`;
};

export const parseIntegerInput = (value: string) => {
  const sanitized = sanitizeIntegerInput(value);
  if (!sanitized) return 0;

  const parsed = Number.parseInt(sanitized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parseDecimalInput = (value: string) => {
  const sanitized = sanitizeDecimalInput(value);
  if (!sanitized || sanitized === ".") return 0;

  const parsed = Number.parseFloat(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
};
