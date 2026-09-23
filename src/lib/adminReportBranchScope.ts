/**
 * Sucursales excluidas temporalmente de Reportes y Pagos del personal.
 * Quitar de esta lista cuando deban volver a contarse.
 */
const EXCLUDED_NAME_MATCHERS: Array<(name: string) => boolean> = [
  (name) => name.includes("el pulpo 4"),
  (name) => name.startsWith("local principal"),
];

export function isExcludedFromAdminReports(branch: {
  name?: string | null;
}): boolean {
  const name = String(branch.name ?? "").toLowerCase().trim();
  if (!name) return false;
  return EXCLUDED_NAME_MATCHERS.some((match) => match(name));
}

export function filterBranchesForAdminReports<T extends { name?: string | null }>(
  branches: T[],
): T[] {
  return branches.filter((branch) => !isExcludedFromAdminReports(branch));
}

/** Aplica filtro de sucursal: una, varias (alcance "todas" sin excluidas) o ninguna. */
export function applyAdminReportBranchFilter<
  T extends { eq: (column: string, value: string) => T; in: (column: string, values: string[]) => T },
>(
  query: T,
  column: string,
  branchId: string | null | undefined,
  branchScopeIds?: string[] | null,
): T {
  if (branchId && branchId !== "ALL") {
    return query.eq(column, branchId);
  }
  if (branchScopeIds && branchScopeIds.length > 0) {
    return query.in(column, branchScopeIds);
  }
  return query;
}
