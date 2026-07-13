export interface TransferenciaPagoDatos {
  bancoId: string;
  numeroTransferencia: string;
  monto: number;
}

export function formatTransferenciaMontoInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(2);
}

export function parseTransferenciaMontoInput(value: string): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
