import { toast } from "sonner";
import { isAppOnline } from "@/lib/networkStatus";

export const OFFLINE_ACTION_MESSAGE =
  "No se pudo completar la acción: se perdió la conexión a internet. Revisa tu conexión e intenta de nuevo.";

export class OfflineActionError extends Error {
  constructor(message = OFFLINE_ACTION_MESSAGE) {
    super(message);
    this.name = "OfflineActionError";
  }
}

export function isNetworkLikeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof OfflineActionError) return true;

  const name = String((error as { name?: string })?.name ?? "").toLowerCase();
  if (name === "offlineactionerror" || name === "networkerror") return true;

  const msg = String((error as { message?: string })?.message ?? error ?? "").toLowerCase();
  if (!msg) return false;
  if (msg.includes(OFFLINE_ACTION_MESSAGE.toLowerCase())) return true;
  if (msg.includes("failed to fetch")) return true;
  if (msg.includes("network request failed")) return true;
  if (msg.includes("load failed")) return true;
  if (msg.includes("err_internet_disconnected")) return true;
  if (msg.includes("err_network_changed")) return true;
  if (msg.includes("err_connection")) return true;
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("sin conexión") || msg.includes("sin conexion")) return true;
  if (msg.includes("networkerror when attempting to fetch")) return true;
  return false;
}

/** Lanza si no hay conexión (para bloquear acciones antes de ir al servidor). */
export function ensureOnlineForAction(): void {
  if (!isAppOnline()) {
    throw new OfflineActionError();
  }
}

let lastOfflineToastAt = 0;

export function notifyOfflineActionBlocked(): void {
  const now = Date.now();
  // Evita 2 toasts seguidos (cache global + onError local).
  if (now - lastOfflineToastAt < 1200) return;
  lastOfflineToastAt = now;
  toast.error(OFFLINE_ACTION_MESSAGE, { id: "offline-action" });
}

/** Reescribe errores de red al mensaje único de la app. */
export function asOfflineActionErrorIfNeeded(error: unknown): unknown {
  if (!isNetworkLikeError(error)) return error;
  if (error instanceof OfflineActionError) return error;
  return new OfflineActionError();
}

/**
 * Fetch para Supabase: bloquea escrituras si ya no hay red
 * y unifica el error cuando la petición cae por conexión.
 */
export async function supabaseFetchWithOfflineGuard(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = String(init?.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

  if (isWrite && !isAppOnline()) {
    throw new OfflineActionError();
  }

  try {
    return await fetch(input, init);
  } catch (error) {
    if (isWrite && isNetworkLikeError(error)) {
      throw new OfflineActionError();
    }
    throw error;
  }
}
