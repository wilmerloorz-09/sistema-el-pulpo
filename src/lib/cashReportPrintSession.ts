const STASH_PREFIX = "el-pulpo-cash-report:";
const STASH_TTL_MS = 30 * 60 * 1000;

function normalizeReportHtml(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) return trimmed;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${trimmed}</body></html>`;
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

/** Guarda el HTML en sessionStorage (misma pestana / navegador). */
export function stashCashReportHtml(html: string): string | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const key = `${STASH_PREFIX}${id}`;
  try {
    window.sessionStorage.setItem(key, normalizeReportHtml(html));
    window.sessionStorage.setItem(`${key}:exp`, String(Date.now() + STASH_TTL_MS));
    return id;
  } catch {
    return null;
  }
}

export function readStashedCashReportHtml(id: string | null | undefined): string | null {
  if (!id || typeof window === "undefined" || !window.sessionStorage) return null;
  const key = `${STASH_PREFIX}${id}`;
  const expiresAt = Number(window.sessionStorage.getItem(`${key}:exp`) ?? "0");
  if (!expiresAt || Date.now() > expiresAt) {
    window.sessionStorage.removeItem(key);
    window.sessionStorage.removeItem(`${key}:exp`);
    return null;
  }
  return window.sessionStorage.getItem(key);
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
    const stashedId = stashCashReportHtml(html);
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

export function decodeCashReportPayloadFromUrl(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    return base64ToText(decodeURIComponent(encoded));
  } catch {
    return base64ToText(encoded);
  }
}
