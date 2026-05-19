/** Parámetro `origin` en `/ordenes` cuando la orden viene del listado de mesas (versión estable). */
export const MESAS_ORIGIN_LEGACY = "mesas";

/** Parámetro `origin` para el listado experimental `/mesas-v2`. */
export const MESAS_ORIGIN_V2 = "mesas-v2";

/** Cuando vale `1`, se muestra el selector de órdenes de la mesa en tarjetas (`/ordenes` con `origin` mesas). */
export const MESAS_V2_CARDS_PARAM = "mesaCards";

export function isMesasListOrigin(origin: string | null): boolean {
  return origin === MESAS_ORIGIN_LEGACY || origin === MESAS_ORIGIN_V2;
}

/** Ruta del listado según el `origin` guardado en la URL de Órdenes. */
export function mesasListPathForOrigin(origin: string | null): "/mesas" | "/mesas-v2" {
  if (origin === MESAS_ORIGIN_V2) return "/mesas-v2";
  return "/mesas";
}

/** Extrae el número visible de una mesa (ej. "Mesa 1" → "1"). */
export function formatTableBadge(name: string) {
  return name.replace(/^mesa\s*/i, "").trim() || name;
}

/** Query string para `/ordenes` con `origin` de mesas (clásico o beta) y selector opcional en tarjetas. */
export function mesasOrdenesSearch(opts: { order: string; origin: string; mesaCards?: boolean }): string {
  const p = new URLSearchParams();
  p.set("order", opts.order);
  p.set("origin", opts.origin);
  if (opts.mesaCards) p.set(MESAS_V2_CARDS_PARAM, "1");
  return p.toString();
}

/** Query string para `/ordenes` desde Mesas (beta). */
export function mesasV2OrdenesSearch(opts: { order: string; mesaCards?: boolean }): string {
  return mesasOrdenesSearch({ ...opts, origin: MESAS_ORIGIN_V2 });
}
