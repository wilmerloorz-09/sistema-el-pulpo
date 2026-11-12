/** Mensajes / fallos de login que no son “clave incorrecta”. */
export function isTransientLoginMessage(raw?: string | null): boolean {
  const normalized = String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!normalized) return false;

  return (
    normalized.includes("saturado")
    || normalized.includes("validando identificador")
    || normalized.includes("503")
    || normalized.includes("502")
    || normalized.includes("429")
    || normalized.includes("timeout")
    || normalized.includes("timed out")
    || normalized.includes("rate limit")
    || normalized.includes("too many requests")
    || normalized.includes("failed to send")
    || normalized.includes("non-2xx")
    || normalized.includes("fetch failed")
    || normalized.includes("network")
    || normalized.includes("connection")
    || normalized.includes("temporarily unavailable")
    || normalized.includes("service unavailable")
  );
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Limpia sesión Auth y claves locales atascadas (equivale a “reiniciar” sin apagar el equipo). */
export function clearLocalAuthDebris(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith("sb-")
        || key === "authOwnedSingleSession"
        || key === "authSessionActivity"
        || key === "activeBranchId"
        || key === "loginBranchId"
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore storage failures on restricted WebViews
  }
}
