const STASH_PREFIX = "el-pulpo-cash-report:";
const STASH_TTL_MS = 30 * 60 * 1000;

type StashStorage = "session" | "local";

function normalizeReportHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
}

function getStorage(kind: StashStorage): Storage | null {
  if (typeof window === "undefined") return null;
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToText(encoded: string): string | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Guarda el HTML para la ruta /imprimir-reporte-caja (localStorage en movil para sobrevivir navegacion). */
export function stashCashReportHtml(
  html: string,
  options?: { storage?: StashStorage | "both" },
): string | null {
  const mode = options?.storage ?? "both";
  const storages: StashStorage[] =
    mode === "both" ? ["local", "session"] : [mode];
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const key = `${STASH_PREFIX}${id}`;
  const payload = normalizeReportHtml(html);
  const expiresAt = String(Date.now() + STASH_TTL_MS);
  let wrote = false;

  for (const kind of storages) {
    const storage = getStorage(kind);
    if (!storage) continue;
    try {
      storage.setItem(key, payload);
      storage.setItem(`${key}:exp`, expiresAt);
      wrote = true;
    } catch {
      /* quota / private mode */
    }
  }

  return wrote ? id : null;
}

function readFromStorage(storage: Storage, id: string): string | null {
  const key = `${STASH_PREFIX}${id}`;
  const expiresAt = Number(storage.getItem(`${key}:exp`) ?? "0");
  if (!expiresAt || Date.now() > expiresAt) {
    storage.removeItem(key);
    storage.removeItem(`${key}:exp`);
    return null;
  }
  return storage.getItem(key);
}

export function readStashedCashReportHtml(id: string | null | undefined): string | null {
  if (!id || typeof window === "undefined") return null;

  const local = window.localStorage ? readFromStorage(window.localStorage, id) : null;
  if (local) return local;

  const session = window.sessionStorage ? readFromStorage(window.sessionStorage, id) : null;
  return session;
}

export function buildCashReportPrintPageUrl(
  html: string,
  options?: { autoPrint?: boolean; preferStash?: boolean },
): string | null {
  const autoPrint = options?.autoPrint !== false;
  const preferStash = options?.preferStash !== false;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!origin) return null;

  if (preferStash) {
    const stashedId = stashCashReportHtml(html, { storage: "both" });
    if (stashedId) {
      const params = new URLSearchParams({ id: stashedId });
      if (autoPrint) params.set("print", "1");
      return `${origin}/imprimir-reporte-caja?${params.toString()}`;
    }
  }

  const encoded = encodeURIComponent(textToBase64(normalizeReportHtml(html)));
  if (encoded.length > 180_000) {
    return null;
  }

  const params = new URLSearchParams({ d: encoded });
  if (autoPrint) params.set("print", "1");
  return `${origin}/imprimir-reporte-caja?${params.toString()}`;
}

/** Navega dentro de la app (WebView) a la vista de impresion; evita intents de Chrome con URL larga. */
export function openCashReportInAppPrintPage(html: string, autoPrint = true): boolean {
  const stashedId = stashCashReportHtml(html, { storage: "both" });
  if (!stashedId || typeof window === "undefined") return false;

  const params = new URLSearchParams({ id: stashedId });
  if (autoPrint) params.set("print", "1");
  const path = `/imprimir-reporte-caja?${params.toString()}`;
  window.location.assign(path);
  return true;
}

export function decodeCashReportPayloadFromUrl(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    return base64ToText(decodeURIComponent(encoded));
  } catch {
    return base64ToText(encoded);
  }
}
