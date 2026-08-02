/** Alcance de órdenes visibles en Recaudar (Caja > por cobrar). */

export type CajaPayableOrderScope = "all" | "mine" | `user:${string}`;

export const CAJA_PAYABLE_SCOPE_ALL = "all" as const;
export const CAJA_PAYABLE_SCOPE_MINE = "mine" as const;

/** Recaudar muestra siempre todas las órdenes por cobrar del turno. */
export function getDefaultCajaPayableOrderScope(
  _userId?: string | undefined,
  _primaryCashierId?: string | null | undefined,
): CajaPayableOrderScope {
  return CAJA_PAYABLE_SCOPE_ALL;
}

export function orderMatchesCajaPayableScope(
  order: { created_by?: string | null },
  scope: CajaPayableOrderScope,
  currentUserId: string,
): boolean {
  if (scope === CAJA_PAYABLE_SCOPE_ALL) return true;
  if (scope === CAJA_PAYABLE_SCOPE_MINE) {
    return Boolean(currentUserId) && order.created_by === currentUserId;
  }
  if (scope.startsWith("user:")) {
    const creatorId = scope.slice("user:".length);
    return Boolean(creatorId) && order.created_by === creatorId;
  }
  return true;
}

export function cajaPayableScopeStorageKey(branchId: string, shiftId: string) {
  return `caja-payable-scope:${branchId}:${shiftId}`;
}

export function loadPersistedCajaPayableScope(
  branchId: string | undefined,
  shiftId: string | undefined,
): CajaPayableOrderScope | null {
  if (!branchId || !shiftId || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(cajaPayableScopeStorageKey(branchId, shiftId));
    if (!raw) return null;
    if (raw === CAJA_PAYABLE_SCOPE_ALL || raw === CAJA_PAYABLE_SCOPE_MINE) return raw;
    if (raw.startsWith("user:") && raw.length > "user:".length) return raw as CajaPayableOrderScope;
    return null;
  } catch {
    return null;
  }
}

export function persistCajaPayableScope(
  branchId: string | undefined,
  shiftId: string | undefined,
  scope: CajaPayableOrderScope,
) {
  if (!branchId || !shiftId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(cajaPayableScopeStorageKey(branchId, shiftId), scope);
  } catch {
    // ignore quota / private mode
  }
}

export function buildPayableOrderCreatorOptions(
  orders: Array<{ created_by?: string | null; created_by_name?: string | null }>,
): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const order of orders) {
    if (!order.created_by) continue;
    byId.set(order.created_by, order.created_by_name?.trim() || "Usuario");
  }
  return Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function cajaPayableScopeSelectValue(scope: CajaPayableOrderScope): string {
  return scope;
}

export function parseCajaPayableScopeSelectValue(value: string): CajaPayableOrderScope {
  if (value === CAJA_PAYABLE_SCOPE_ALL || value === CAJA_PAYABLE_SCOPE_MINE) return value;
  if (value.startsWith("user:") && value.length > "user:".length) return value as CajaPayableOrderScope;
  return CAJA_PAYABLE_SCOPE_ALL;
}
