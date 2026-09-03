import type {
  CashRegisterMovement,
  CashRegisterOpeningHistoryEntry,
  ShiftDenom,
} from "@/hooks/useCaja";

export const ALL_CASHIERS = "ALL";

export function getOpenCashierIds(
  openingHistory: CashRegisterOpeningHistoryEntry[],
): Set<string> {
  return new Set(
    openingHistory
      .filter((entry) => entry.status === "abierta")
      .map((entry) => entry.cashier_id),
  );
}

export function resolveCashierOpening(
  openingHistory: CashRegisterOpeningHistoryEntry[],
  cashierId: string,
): CashRegisterOpeningHistoryEntry | null {
  if (cashierId === ALL_CASHIERS) return null;

  const pool = openingHistory.filter((entry) => entry.cashier_id === cashierId);
  const open = pool.find((entry) => entry.status === "abierta");
  if (open) return open;

  let latest: CashRegisterOpeningHistoryEntry | null = null;
  for (const entry of pool) {
    if (entry.status === "anulada") continue;
    if (
      !latest
      || new Date(entry.opened_at).getTime() > new Date(latest.opened_at).getTime()
    ) {
      latest = entry;
    }
  }
  return latest;
}

/** Cobros/movimientos de la apertura actual, incluidos los del cajero anterior tras un reemplazo. */
export function belongsToCashierRegisterActivity(params: {
  actorId: string;
  activityAt: string;
  cashierId: string;
  opening: CashRegisterOpeningHistoryEntry | null;
  openingHistory: CashRegisterOpeningHistoryEntry[];
}): boolean {
  if (params.cashierId === ALL_CASHIERS) return true;
  if (params.actorId === params.cashierId) return true;
  if (!params.opening) return false;

  const activityAt = new Date(params.activityAt).getTime();
  const openedAt = new Date(params.opening.opened_at).getTime();
  if (activityAt < openedAt) return false;

  if (params.opening.closed_at) {
    const closedAt = new Date(params.opening.closed_at).getTime();
    if (activityAt > closedAt) return false;
  }

  const actorHadOwnRegisterAtActivity = params.openingHistory.some(
    (entry) =>
      entry.cashier_id === params.actorId
      && entry.id !== params.opening.id
      && entry.status !== "anulada"
      && activityAt >= new Date(entry.opened_at).getTime()
      && (
        !entry.closed_at
        || activityAt <= new Date(entry.closed_at).getTime()
      ),
  );
  if (actorHadOwnRegisterAtActivity) return false;
  return true;
}

export type CajaRegisterDenomRow = ShiftDenom & {
  cashier_id: string | null;
  opening_id: string | null;
};

export interface CajaRegisterSnapshot {
  denoms: CajaRegisterDenomRow[];
  openingHistory: CashRegisterOpeningHistoryEntry[];
}

export interface CajaCashierDenomGroup {
  cashierId: string;
  cashierName: string;
  denoms: ShiftDenom[];
}

function relevantOpeningIds(
  openings: CashRegisterOpeningHistoryEntry[],
  cashierId: string,
): Set<string> {
  const pool =
    cashierId === ALL_CASHIERS
      ? openings
      : openings.filter((entry) => entry.cashier_id === cashierId);

  const open = pool.filter((entry) => entry.status === "abierta");
  if (open.length > 0) {
    return new Set(open.map((entry) => entry.id));
  }

  const latestByCashier = new Map<string, CashRegisterOpeningHistoryEntry>();
  for (const entry of pool) {
    if (entry.status === "anulada") continue;
    const current = latestByCashier.get(entry.cashier_id);
    if (!current || new Date(entry.opened_at).getTime() > new Date(current.opened_at).getTime()) {
      latestByCashier.set(entry.cashier_id, entry);
    }
  }
  return new Set(Array.from(latestByCashier.values()).map((entry) => entry.id));
}

function aggregateDenoms(rows: CajaRegisterDenomRow[]): ShiftDenom[] {
  const byDenom = new Map<string, ShiftDenom>();

  for (const row of rows) {
    const key = row.denomination_id || row.id;
    const existing = byDenom.get(key);
    const qtyInitial = Number(row.qty_initial ?? 0);
    const qtyCurrent = Number(row.qty_current ?? 0);
    if (!existing) {
      byDenom.set(key, {
        id: row.id,
        denomination_id: row.denomination_id,
        label: row.label,
        denomination_type: row.denomination_type,
        display_order: row.display_order,
        value: row.value,
        image_url: row.image_url,
        qty_initial: qtyInitial,
        qty_current: qtyCurrent,
      });
      continue;
    }
    existing.qty_initial += qtyInitial;
    existing.qty_current += qtyCurrent;
  }

  return Array.from(byDenom.values());
}

/** Recorta denominaciones, historial y movimientos al cajero elegido o a todos. */
export function scopeCajaSummary(params: {
  denoms: CajaRegisterDenomRow[];
  openingHistory: CashRegisterOpeningHistoryEntry[];
  movements: CashRegisterMovement[];
  cashierId: string;
}): {
  denoms: ShiftDenom[];
  cashierGroups: CajaCashierDenomGroup[];
  openingHistory: CashRegisterOpeningHistoryEntry[];
  movements: CashRegisterMovement[];
} {
  const cashierId = params.cashierId || ALL_CASHIERS;
  const openingIds = relevantOpeningIds(params.openingHistory, cashierId);
  const openCashierIds = new Set(
    params.openingHistory
      .filter((entry) => entry.status === "abierta")
      .map((entry) => entry.cashier_id),
  );

  const denomSource = params.denoms.filter((row) => {
    if (cashierId !== ALL_CASHIERS && row.cashier_id && row.cashier_id !== cashierId) {
      return false;
    }
    if (openingIds.size > 0 && row.opening_id) {
      return openingIds.has(row.opening_id);
    }
    if (cashierId !== ALL_CASHIERS) {
      return !row.cashier_id || row.cashier_id === cashierId;
    }
    if (openCashierIds.size === 0) return true;
    return Boolean(row.cashier_id && openCashierIds.has(row.cashier_id));
  });

  const cashierGroups: CajaCashierDenomGroup[] = Array.from(
    new Set(denomSource.map((row) => row.cashier_id).filter((id): id is string => Boolean(id))),
  ).map((id) => {
    const opening = params.openingHistory.find((entry) => entry.cashier_id === id);
    return {
      cashierId: id,
      cashierName: opening?.cashier_username || opening?.cashier_name || "Cajero",
      denoms: aggregateDenoms(denomSource.filter((row) => row.cashier_id === id)),
    };
  });

  return {
    denoms: aggregateDenoms(denomSource),
    cashierGroups,
    openingHistory: params.openingHistory
      .filter((entry) => cashierId === ALL_CASHIERS || entry.cashier_id === cashierId)
      .map((entry) => ({
        ...entry,
        is_current: entry.status === "abierta",
      })),
    movements:
      cashierId === ALL_CASHIERS
        ? params.movements
        : (() => {
            const opening = resolveCashierOpening(params.openingHistory, cashierId);
            return params.movements.filter((movement) =>
              belongsToCashierRegisterActivity({
                actorId: movement.recordedBy,
                activityAt: movement.createdAt,
                cashierId,
                opening,
                openingHistory: params.openingHistory,
              }),
            );
          })(),
  };
}
