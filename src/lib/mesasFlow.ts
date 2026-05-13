/** Parámetro `origin` en `/ordenes` cuando la orden viene del listado de mesas (versión estable). */
export const MESAS_ORIGIN_LEGACY = "mesas";

/** Parámetro `origin` para el listado experimental `/mesas-v2`. */
export const MESAS_ORIGIN_V2 = "mesas-v2";

export function isMesasListOrigin(origin: string | null): boolean {
  return origin === MESAS_ORIGIN_LEGACY || origin === MESAS_ORIGIN_V2;
}

/** Ruta del listado según el `origin` guardado en la URL de Órdenes. */
export function mesasListPathForOrigin(origin: string | null): "/mesas" | "/mesas-v2" {
  if (origin === MESAS_ORIGIN_V2) return "/mesas-v2";
  return "/mesas";
}
