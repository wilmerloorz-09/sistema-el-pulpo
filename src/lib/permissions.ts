export type AccessLevel = "NONE" | "VIEW" | "OPERATE" | "MANAGE";

export type PermissionMap = Record<string, AccessLevel>;

const LEVEL_ORDER: Record<AccessLevel, number> = {
  NONE: 0,
  VIEW: 1,
  OPERATE: 2,
  MANAGE: 3,
};

export function hasPermission(
  permissions: PermissionMap | null | undefined,
  moduleCode: string,
  required: AccessLevel,
): boolean {
  const current = permissions?.[moduleCode] ?? "NONE";
  return LEVEL_ORDER[current] >= LEVEL_ORDER[required];
}

export function canView(permissions: PermissionMap | null | undefined, moduleCode: string) {
  return hasPermission(permissions, moduleCode, "VIEW");
}

export function canOperate(permissions: PermissionMap | null | undefined, moduleCode: string) {
  return hasPermission(permissions, moduleCode, "OPERATE");
}

export function canManage(permissions: PermissionMap | null | undefined, moduleCode: string) {
  return hasPermission(permissions, moduleCode, "MANAGE");
}

export function allowedModulesFromPermissions(permissions: PermissionMap | null | undefined): string[] {
  if (!permissions) return [];
  return Object.entries(permissions)
    .filter(([, level]) => level && level !== "NONE")
    .map(([moduleCode]) => moduleCode);
}
