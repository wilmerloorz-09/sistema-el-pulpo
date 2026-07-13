import { supabase } from "@/integrations/supabase/client";

export const MENSAJE_TRANSFERENCIA_DUPLICADA =
  "Ya existe un pago registrado con este banco y numero de transferencia.";

export function esErrorTransferenciaDuplicada(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  return (
    code === "23505"
    || message.includes("transferencia duplicada")
    || message.includes("idx_payments_transferencia_unica")
  );
}

export function mensajeErrorPago(error: unknown, fallback = "No se pudo registrar el cobro."): string {
  if (esErrorTransferenciaDuplicada(error)) return MENSAJE_TRANSFERENCIA_DUPLICADA;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function existeTransferenciaDuplicada(
  bancoId: string,
  numeroTransferencia: string,
): Promise<boolean> {
  const numero = numeroTransferencia.trim();
  if (!bancoId || !numero) return false;

  const { data, error } = await supabase
    .from("payments")
    .select("id")
    .eq("banco_id", bancoId)
    .ilike("numero_transferencia", numero)
    .limit(1);

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
