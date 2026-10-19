/**
 * Restricción temporal de menú por usuario.
 * Por ahora: admin1 no ve ni entra a FINANZAS, INVENTARIO ni ADMINISTRACIÓN.
 */
const TEMP_RESTRICTED_USERNAMES = new Set(["admin1"]);
const TEMP_RESTRICTED_EMAILS = new Set(["admin1@elpulpo.com"]);

const BLOCKED_NAV_GROUPS = new Set([
  "FINANZAS",
  "INVENTARIO",
  "ADMINISTRACIÓN",
]);

export type MenuRestrictionProfile = {
  username?: string | null;
  email?: string | null;
} | null | undefined;

export function isTemporarilyMenuRestrictedUser(profile: MenuRestrictionProfile): boolean {
  const username = profile?.username?.trim().toLowerCase();
  if (username && TEMP_RESTRICTED_USERNAMES.has(username)) return true;
  const email = profile?.email?.trim().toLowerCase();
  if (email && TEMP_RESTRICTED_EMAILS.has(email)) return true;
  return false;
}

export function isNavGroupBlockedForUser(
  group: string,
  profile: MenuRestrictionProfile,
): boolean {
  return isTemporarilyMenuRestrictedUser(profile) && BLOCKED_NAV_GROUPS.has(group);
}

/** Rutas de las secciones bloqueadas (acceso directo por URL). */
export function isPathBlockedForRestrictedUser(
  pathname: string,
  profile: MenuRestrictionProfile,
): boolean {
  if (!isTemporarilyMenuRestrictedUser(profile)) return false;

  const path = pathname.split("?")[0] || "/";

  // FINANZAS
  if (
    path === "/caja"
    || path.startsWith("/caja/")
    || path === "/cambio-monedas"
    || path.startsWith("/cambio-monedas/")
    || path === "/cierres-caja"
    || path.startsWith("/cierres-caja/")
  ) {
    return true;
  }

  // INVENTARIO
  if (path === "/inventario" || path.startsWith("/inventario/")) {
    return true;
  }

  // ADMINISTRACIÓN
  if (
    path === "/reportes"
    || path.startsWith("/reportes/")
    || path === "/turno"
    || path.startsWith("/turno/")
    || path === "/forzar-cierre-turno"
    || path.startsWith("/forzar-cierre-turno/")
    || path === "/admin"
    || path.startsWith("/admin/")
    || path === "/personal"
    || path.startsWith("/personal/")
    || path === "/monitoreo-global"
    || path.startsWith("/monitoreo-global/")
  ) {
    return true;
  }

  return false;
}

export function safeHomePathForRestrictedUser(candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const path = candidate.split("?")[0] || candidate;
    if (!isPathBlockedForRestrictedUser(path, { username: "admin1" })) {
      return candidate;
    }
  }
  return "/mesas";
}
