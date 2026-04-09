export interface AccessCatalogRole {
  id: string;
  code: string;
  name: string;
}

export type UserTypeValue = "administrador" | "supervisor" | "usuario_operativo";

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const USER_TYPE_ALIASES: Record<UserTypeValue, string[]> = {
  administrador: ["administrador", "admin", "administrador general", "global_admin"],
  supervisor: ["supervisor", "encargado", "jefe de sucursal"],
  usuario_operativo: [
    "usuario_operativo",
    "usuario operativo",
    "operativo",
    "mesero",
    "cajero",
    "despachador",
    "despachador_mesas",
    "despachador_para_llevar",
  ],
};

export function resolveRoleCodeFromCatalog(
  roles: AccessCatalogRole[] | undefined,
  userType: UserTypeValue,
): string {
  const candidates = new Set(USER_TYPE_ALIASES[userType].map(normalize));

  const exactMatch = (roles ?? []).find((role) => {
    const normalizedCode = normalize(role.code);
    const normalizedName = normalize(role.name);
    return candidates.has(normalizedCode) || candidates.has(normalizedName);
  });

  if (exactMatch) {
    return exactMatch.code;
  }

  return userType;
}

