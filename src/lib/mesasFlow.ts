/** Parámetro `origin` en `/ordenes` cuando la orden viene del listado de mesas (versión estable). */
export const MESAS_ORIGIN_LEGACY = "mesas";

/** Parámetro `origin` para el listado experimental `/mesas-v2`. */
export const MESAS_ORIGIN_V2 = "mesas-v2";

/** Query en `/ordenes` para activar la UI de mesa (cabecera + tarjetas) desde Mesas beta. */
export const MESAS_V2_UI_PARAM = "mesaUi";
export const MESAS_V2_UI_VALUE = "v2";

/** Cuando vale `1`, se muestra el selector de órdenes de la mesa en tarjetas. */
export const MESAS_V2_CARDS_PARAM = "mesaCards";

export function isMesasListOrigin(origin: string | null): boolean {
  return origin === MESAS_ORIGIN_LEGACY || origin === MESAS_ORIGIN_V2;
}

/** Ruta del listado según el `origin` guardado en la URL de Órdenes. */
export function mesasListPathForOrigin(origin: string | null): "/mesas" | "/mesas-v2" {
  if (origin === MESAS_ORIGIN_V2) return "/mesas-v2";
  return "/mesas";
}

/** Query string para `/ordenes` desde Mesas (beta), opcionalmente abriendo el selector en tarjetas. */
export function mesasV2OrdenesSearch(opts: { order: string; mesaCards?: boolean }): string {
  const p = new URLSearchParams();
  p.set("order", opts.order);
  p.set("origin", MESAS_ORIGIN_V2);
  p.set(MESAS_V2_UI_PARAM, MESAS_V2_UI_VALUE);
  if (opts.mesaCards) p.set(MESAS_V2_CARDS_PARAM, "1");
  return p.toString();
}
