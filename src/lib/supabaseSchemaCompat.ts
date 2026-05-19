/** Errores de PostgREST/Supabase cuando la BD aún no tiene columnas o RPCs nuevos. */
export function isMissingColumnError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "");
  return (
    code === "42703"
    || code === "PGRST204"
    || (message.includes("column") && message.includes("does not exist"))
    || message.includes("schema cache")
  );
}
