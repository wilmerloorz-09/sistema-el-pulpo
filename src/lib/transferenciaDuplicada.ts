import { supabase } from "@/integrations/supabase/client";

export const MENSAJE_TRANSFERENCIA_DUPLICADA =
  "Ya existe un pago registrado con este banco y numero de transferencia.";

export function esErrorTransferenciaDuplicada(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  const details = String((error as { details?: string })?.details ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  const combined = `${message} ${details}`;
  return (
    code === "23505"
    || combined.includes("transferencia duplicada")
    || combined.includes("idx_payments_transferencia_unica")
    || combined.includes("payments_transferencia")
  );
}

export function mensajeErrorPago(error: unknown, fallback = "No se pudo registrar el cobro."): string {
  if (esErrorTransferenciaDuplicada(error)) return MENSAJE_TRANSFERENCIA_DUPLICADA;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

/**
 * true = duplicada, false = libre, null = no se pudo comprobar (no bloquear el cobro).
 * Usa RPC SECURITY DEFINER indexada; no escanea payments vía RLS.
 */
export async function existeTransferenciaDuplicada(
  bancoId: string,
  numeroTransferencia: string,
): Promise<boolean | null> {
  const numero = numeroTransferencia.trim();
  if (!bancoId || !numero) return false;

  try {
    const { data, error } = await supabase.rpc("existe_transferencia_duplicada" as never, {
      p_banco_id: bancoId,
      p_numero: numero,
    } as never);

    if (error) {
      console.warn("[transferencia-duplicada] RPC fallo; se continua y valida al registrar", error);
      return null;
    }

    return Boolean(data);
  } catch (error) {
    console.warn("[transferencia-duplicada] error inesperado; se continua", error);
    return null;
  }
}
