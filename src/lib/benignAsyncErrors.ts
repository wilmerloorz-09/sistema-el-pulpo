/**
 * AbortError from Supabase Auth's navigator.locks coordination (tablet/WebView).
 * Safe to ignore when the operation was superseded by a newer auth call.
 */
export function isBenignAuthLockAbort(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const err = reason as { name?: string; message?: string };
  if (err.name !== "AbortError") return false;
  const msg = String(err.message ?? "").toLowerCase();
  return (
    msg.includes("lock request is aborted") ||
    msg.includes("signal is aborted") ||
    msg.includes("the user aborted a request")
  );
}

export function logBackgroundTaskError(scope: string, error: unknown) {
  if (isBenignAuthLockAbort(error)) return;
  console.warn(`[${scope}]`, error);
}
