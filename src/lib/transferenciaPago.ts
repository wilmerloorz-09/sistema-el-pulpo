import type { AnalisisComprobanteTransferencia } from "@/services/analisisComprobanteTransferencia";
import type { ResultadoValidacionComprobante } from "@/lib/validacionComprobanteTransferencia";

export interface TransferenciaPagoDatos {
  bancoId: string;
  numeroTransferencia: string;
  monto: number;
  /** Foto opcional del comprobante; permanece en memoria hasta el cobro final. */
  fotoArchivo?: File | Blob | null;
  /** Object URL local para previsualizar; no se persiste en BD. */
  fotoVistaPreviaUrl?: string | null;
  /** Snapshot de los datos extraídos de la foto. */
  analisisIa?: AnalisisComprobanteTransferencia | null;
  /** Comparación del análisis contra cuentas autorizadas y fecha/monto. */
  validacionComprobante?: ResultadoValidacionComprobante | null;
  /** Obligatorio cuando el usuario acepta novedades o datos no verificables. */
  motivoAceptacion?: string | null;
}

/** Libera la URL de vista previa en memoria (si existe). */
export function liberarVistaPreviaTransferencia(
  datos: TransferenciaPagoDatos | null | undefined,
): void {
  const url = datos?.fotoVistaPreviaUrl;
  if (url) URL.revokeObjectURL(url);
}

export function formatTransferenciaMontoInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(2);
}

export function parseTransferenciaMontoInput(value: string): number {
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
