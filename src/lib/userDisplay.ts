export interface UserDisplayProfile {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
}

export function getUserDisplayName(profile?: UserDisplayProfile | null) {
  const firstName = String(profile?.first_name ?? "").trim();
  if (firstName) return firstName;

  const fullName = String(profile?.full_name ?? "").trim();
  if (fullName) return fullName;

  const username = String(profile?.username ?? "").trim();
  if (username) return username;

  const email = String(profile?.email ?? "").trim();
  if (email) return email;

  return "Usuario";
}

export function buildUserDisplayMap(profiles: UserDisplayProfile[] | null | undefined) {
  return Object.fromEntries((profiles ?? []).map((profile) => [profile.id, getUserDisplayName(profile)]));
}
