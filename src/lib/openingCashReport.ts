import { supabase } from "@/integrations/supabase/client";
import {
  openCashClosureReportWindow,
  scopeReportToOpening,
  type CashOpeningSnapshot,
  type CashShiftSnapshot,
  type CompletedPayment,
} from "@/lib/cashReportUtils";
import { fetchCashRegisterMovementsForShift } from "@/hooks/useCaja";
import { getUserDisplayName } from "@/lib/userDisplay";
import { cleanOrderCode } from "@/lib/orderPresentation";
import { sumNonCashPaymentChangeOut } from "@/lib/transferCashChange";

export type ClosedOpeningListRow = {
  id: string;
  shift_id: string;
  branch_id: string;
  cashier_id: string;
  cashier_name: string;
  cashier_username: string;
  opened_at: string;
  closed_at: string;
  initial_total: number;
  final_total: number;
  collected_total: number;
  notes: string | null;
  shift_number: number | null;
  shift_code: string | null;
  shift_opened_at: string;
};

function mapPaymentStatus(raw: string | null | undefined, notes: string | null | undefined): string {
  const notesText = String(notes ?? "");
  if (notesText.includes("VOIDED:") || String(raw ?? "").toLowerCase() === "voided") return "VOIDED";
  if (notesText.includes("REVERSED:") || String(raw ?? "").toLowerCase() === "reversed") return "REVERSED";
  const upper = String(raw ?? "").toUpperCase();
  if (upper === "PARTIAL") return "PARTIAL";
  return "APPLIED";
}

export async function listClosedCashOpenings(params: {
  branchId: string;
  desdeIso: string;
  hastaIso: string;
  shiftId?: string | null;
  cashierId?: string | null;
  limit?: number;
}): Promise<ClosedOpeningListRow[]> {
  const { data, error } = await supabase.rpc("list_closed_cash_register_openings" as any, {
    p_branch_id: params.branchId,
    p_desde: params.desdeIso,
    p_hasta: params.hastaIso,
    p_shift_id: params.shiftId ?? null,
    p_cashier_id: params.cashierId ?? null,
    p_limit: params.limit ?? 150,
  } as any);

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id as string,
    shift_id: row.shift_id as string,
    branch_id: row.branch_id as string,
    cashier_id: row.cashier_id as string,
    cashier_name: String(row.cashier_name ?? "Sin nombre"),
    cashier_username: String(row.cashier_username ?? ""),
    opened_at: row.opened_at as string,
    closed_at: (row.closed_at ?? row.opened_at) as string,
    initial_total: Number(row.initial_total ?? 0),
    final_total: Number(row.final_total ?? row.initial_total ?? 0),
    collected_total: Number(row.collected_total ?? 0),
    notes: row.notes ?? null,
    shift_number: row.shift_number ?? null,
    shift_code: row.shift_code ?? null,
    shift_opened_at: String(row.shift_opened_at ?? row.opened_at),
  }));
}

export async function listShiftsForBranchInRange(params: {
  branchId: string;
  desdeIso: string;
  hastaIso: string;
}): Promise<Array<{ id: string; opened_at: string; closed_at: string | null; shift_number: number | null; shift_code: string | null }>> {
  const { data, error } = await supabase
    .from("cash_shifts")
    .select("id, opened_at, closed_at, shift_number, shift_code")
    .eq("branch_id", params.branchId)
    .gte("opened_at", params.desdeIso)
    .lte("opened_at", params.hastaIso)
    .order("opened_at", { ascending: false })
    .limit(80);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    shift_number: row.shift_number,
    shift_code: row.shift_code,
  }));
}

async function fetchOpeningDenomSnapshot(params: {
  shiftId: string;
  openingId: string;
  cashierId: string;
}): Promise<CashShiftSnapshot["denoms"]> {
  const { data: denomRows, error } = await (supabase.from("cash_shift_denoms") as any)
    .select("denomination_id, qty_initial, qty_current, opening_id, cashier_id")
    .eq("shift_id", params.shiftId);

  if (error) throw error;

  const rows = (denomRows ?? []) as Array<{
    denomination_id: string;
    qty_initial: number;
    qty_current: number;
    opening_id: string | null;
    cashier_id: string | null;
  }>;

  let scoped = rows.filter((row) => row.opening_id === params.openingId);
  if (scoped.length === 0) {
    scoped = rows.filter((row) => row.cashier_id === params.cashierId);
  }
  if (scoped.length === 0) {
    scoped = rows;
  }

  const denomIds = Array.from(new Set(scoped.map((row) => row.denomination_id).filter(Boolean)));
  if (denomIds.length === 0) return [];

  const { data: catalog, error: catalogError } = await supabase
    .from("denominations")
    .select("id, label, value, display_order, denomination_type")
    .in("id", denomIds);
  if (catalogError) throw catalogError;

  const byId = Object.fromEntries((catalog ?? []).map((d) => [d.id, d]));

  return scoped
    .map((row) => {
      const meta = byId[row.denomination_id];
      return {
        label: meta?.label ?? "N/D",
        value: Number(meta?.value ?? 0),
        display_order: Number(meta?.display_order ?? 999),
        denomination_type: (meta?.denomination_type as "coin" | "bill" | undefined) ?? "coin",
        qty_initial: Number(row.qty_initial ?? 0),
        qty_current: Number(row.qty_current ?? 0),
      };
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => a.display_order - b.display_order || a.value - b.value);
}

async function fetchPaymentsForOpeningWindow(params: {
  cashierId: string;
  openedAt: string;
  closedAt: string;
}): Promise<CompletedPayment[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(`
      id,
      created_at,
      amount,
      notes,
      status,
      payment_method_id,
      created_by,
      payment_methods ( name ),
      orders ( order_code, order_number, table_name_snapshot ),
      profiles:created_by ( alias, username, first_name, last_name, full_name )
    `)
    .eq("created_by", params.cashierId)
    .gte("created_at", params.openedAt)
    .lte("created_at", params.closedAt)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    amount: Number(row.amount ?? 0),
    notes: row.notes ?? null,
    method_name: row.payment_methods?.name || "N/D",
    order_code: cleanOrderCode(row.orders?.order_code),
    order_number: row.orders?.order_number ?? null,
    table_name: row.orders?.table_name_snapshot ?? null,
    cashier_name: getUserDisplayName(row.profiles) || "N/D",
    status: mapPaymentStatus(row.status, row.notes),
  }));
}

/**
 * Genera y abre el reporte HTML de una apertura de caja ya cerrada.
 */
export async function openClosedOpeningCashReport(params: {
  openingId: string;
  branchName: string;
  branchId: string;
}): Promise<void> {
  const { data: openingRow, error: openingError } = await supabase
    .from("cash_register_openings")
    .select(`
      id,
      shift_id,
      branch_id,
      cashier_id,
      status,
      opened_at,
      closed_at,
      initial_total,
      notes,
      profiles:cashier_id ( alias, username, first_name, last_name, full_name )
    `)
    .eq("id", params.openingId)
    .maybeSingle();

  if (openingError) throw openingError;
  if (!openingRow) throw new Error("No se encontró la apertura de caja.");
  if (openingRow.branch_id !== params.branchId) {
    throw new Error("La apertura no pertenece a la sucursal activa.");
  }
  if (String(openingRow.status) !== "cerrada") {
    throw new Error("Solo se pueden reimprimir aperturas cerradas.");
  }
  if (!openingRow.closed_at) {
    throw new Error("La apertura no tiene fecha de cierre.");
  }

  const { data: shiftRow, error: shiftError } = await supabase
    .from("cash_shifts")
    .select("id, opened_at, caja_status, active_tables_count, notes, status")
    .eq("id", openingRow.shift_id)
    .single();
  if (shiftError) throw shiftError;

  const profile = (openingRow as any).profiles ?? {};
  const opening: CashOpeningSnapshot & { cashier_username?: string | null; notes?: string | null } = {
    opened_at: openingRow.opened_at,
    closed_at: openingRow.closed_at,
    status: "cerrada",
    cashier_name: getUserDisplayName(profile) || "Sin nombre",
    cashier_username: profile.username ?? profile.alias ?? null,
    initial_total: Number(openingRow.initial_total ?? 0),
  };

  const [denoms, payments, movements] = await Promise.all([
    fetchOpeningDenomSnapshot({
      shiftId: openingRow.shift_id,
      openingId: openingRow.id,
      cashierId: openingRow.cashier_id,
    }),
    fetchPaymentsForOpeningWindow({
      cashierId: openingRow.cashier_id,
      openedAt: openingRow.opened_at,
      closedAt: openingRow.closed_at,
    }),
    fetchCashRegisterMovementsForShift(openingRow.shift_id),
  ]);

  const paymentIds = payments.map((p) => p.id);
  let transferCashChangeTotal = 0;
  if (paymentIds.length > 0) {
    const { data: changeOutRows, error: changeError } = await (supabase.from("cash_movements") as any)
      .select("payment_id, denomination_id, qty_delta, movement_type")
      .in("payment_id", paymentIds)
      .eq("movement_type", "CHANGE_OUT");
    if (changeError) throw changeError;

    const denomIds = Array.from(
      new Set(
        ((changeOutRows ?? []) as Array<{ denomination_id?: string | null }>)
          .map((row) => row.denomination_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const { data: denomValues } = denomIds.length > 0
      ? await supabase.from("denominations").select("id, value").in("id", denomIds)
      : { data: [] as Array<{ id: string; value: number }> };

    const denominationValueById = Object.fromEntries(
      (denomValues ?? []).map((d) => [d.id, Number(d.value ?? 0)]),
    );
    const { data: payMeta } = await supabase
      .from("payments")
      .select("id, payment_method_id, notes, status")
      .in("id", paymentIds);

    const methodByPaymentId = Object.fromEntries(
      ((payMeta ?? []) as any[]).map((p) => [p.id, p.payment_method_id]),
    );
    const methodNames: Record<string, string> = {};
    for (const payment of payments) {
      const methodId = methodByPaymentId[payment.id];
      if (methodId) methodNames[methodId] = payment.method_name;
    }

    transferCashChangeTotal = sumNonCashPaymentChangeOut({
      payments: ((payMeta ?? []) as any[]).map((p) => ({
        id: p.id,
        payment_method_id: p.payment_method_id,
        notes: p.notes,
        status: p.status,
      })),
      methodNameById: methodNames,
      changeOutMovements: changeOutRows ?? [],
      denominationValueById,
    });
  }

  const shiftSnapshot: CashShiftSnapshot = {
    id: shiftRow.id,
    opened_at: shiftRow.opened_at,
    caja_status: shiftRow.caja_status,
    active_tables_count: Number(shiftRow.active_tables_count ?? 0),
    denoms,
    openingHistory: [opening],
  };

  openCashClosureReportWindow({
    ...scopeReportToOpening({
      branchName: params.branchName,
      shift: shiftSnapshot,
      opening,
      completedPayments: payments,
      movements: movements.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        movementType: m.movementType,
        amount: m.amount,
        reason: m.reason,
        recordedBy: m.recordedBy,
        recordedByName: m.recordedByName ?? undefined,
        recordedByUsername: m.recordedByUsername ?? undefined,
      })),
      closureNotes: openingRow.notes ?? undefined,
      denominationSnapshot: denoms,
      transferCashChangeTotal,
    }),
    reportMode: "opening",
  });
}
