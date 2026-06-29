export interface UserDisplayProfile {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  alias?: string | null;
  username?: string | null;
  email?: string | null;
}

/** Identificador operativo del usuario (alias, sin @). */
export function getUserAlias(profile?: Pick<UserDisplayProfile, "alias" | "username"> | null) {
  const alias = String(profile?.alias ?? "").trim();
  if (alias) return alias;

  return String(profile?.username ?? "").trim();
}

/** Nombre real para administración y subtítulo de cuenta. */
export function getUserRealName(profile?: UserDisplayProfile | null) {
  const firstName = String(profile?.first_name ?? "").trim();
  const lastName = String(profile?.last_name ?? "").trim();
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;

  const fullName = String(profile?.full_name ?? "").trim();
  if (fullName) return fullName;

  return "";
}

/** Nombre visible en operación: siempre el alias. */
export function getUserDisplayName(profile?: UserDisplayProfile | null) {
  const alias = getUserAlias(profile);
  if (alias) return alias;

  const email = String(profile?.email ?? "").trim();
  if (email) return email;

  return "Usuario";
}

/** @deprecated Usar getUserAlias — el alias se muestra sin @. */
export function formatUserHandle(profile?: Pick<UserDisplayProfile, "alias" | "username"> | null) {
  return getUserAlias(profile);
}

export function buildUserDisplayMap(profiles: UserDisplayProfile[] | null | undefined) {
  return Object.fromEntries((profiles ?? []).map((profile) => [profile.id, getUserDisplayName(profile)]));
}
