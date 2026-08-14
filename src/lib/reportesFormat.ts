/** Formato monetario del módulo Reportes (es-EC: coma decimal). */
export function formatReporteMoney(value: number): string {
  return `$${Number(value ?? 0).toLocaleString("es-EC", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Número con decimales al estilo es-EC (sin símbolo $). Útil para CSV. */
export function formatReporteNumber(value: number, digits = 2): string {
  return Number(value ?? 0).toLocaleString("es-EC", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
