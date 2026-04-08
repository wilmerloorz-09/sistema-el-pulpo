import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { generateUUID } from "@/lib/uuid";
import { dedupePaymentMethods, isCashPaymentMethodName, isTransferPaymentMethodName } from "@/lib/paymentMethods";
import { computeLineAmount, roundMoney } from "@/lib/paymentQuantity";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";
import type { Database } from "@/integrations/supabase/types";

export interface Denomination {
  id: string;
  label: string;
  denomination_type?: "coin" | "bill";
  value: number;
  display_order: number;
  image_url?: string | null;
}

export interface ShiftDenom {
  id: string;
  denomination_id: string;
  label: string;
  denomination_type?: "coin" | "bill";
  display_order: number;
  value: number;
  image_url?: string | null;
  qty_initial: number;
  qty_current: number;
}

export interface CashShift {
  id: string;
  branch_id: string;
  status: "OPEN" | "CLOSED";
  caja_status: Database["public"]["Enums"]["caja_status"];
  cashier_id: string;
  capture_user_id: string | null;
  capture_device_label: string | null;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  active_tables_count: number;
  denoms: ShiftDenom[];
  openingHistory: CashRegisterOpeningHistoryEntry[];
}

export interface CashShiftCaptureCandidate {
  id: string;
  full_name: string;
  username: string;
}

export interface CashRegisterOpeningHistoryEntry {
  id: string;
  shift_id: string;
  status: "abierta" | "cerrada" | "anulada";
  cashier_id: string;
  cashier_name: string;
  cashier_username: string;
  opened_at: string;
  closed_at: string | null;
  initial_total: number;
  notes: string | null;
  anulada_por: string | null;
  anulada_por_nombre: string | null;
  anulada_por_username: string | null;
  anulada_at: string | null;
  motivo_anulacion: string | null;
  is_current: boolean;
  payment_count: number;
}

export interface PendingPaymentCaptureRequest {
  id: string;
  payment_id: string;
  status: "pending" | "opened" | "uploaded" | "approved" | "rejected" | "expired" | "canceled";
  secure_token: string;
  token_expires_at: string;
  created_at: string;
  amount: number;
  order_id: string;
  order_number: number | null;
  order_code: string | null;
  payment_method_name: string;
}

export interface CashRegisterMovement {
  id: string;
  shiftId: string;
  branchId: string;
  movementType: "entrada" | "salida" | "cambio_denominacion";
  amount: number;
  reason: string;
  movementDetail: CashRegisterMovementDetail | null;
  recordedBy: string;
  recordedByName: string | null;
  recordedByUsername: string | null;
  createdAt: string;
}

export interface CashRegisterMovementDetailLine {
  denomination_id: string;
  label: string;
  value: number;
  qty: number;
  total: number;
  image_url?: string | null;
}

export interface CashRegisterMovementDetail {
  kind: "cambio_denominacion";
  from: CashRegisterMovementDetailLine[];
  to: CashRegisterMovementDetailLine[];
  totals: {
    from: number;
    to: number;
  };
}

export interface PayableOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  is_special: boolean;
  is_tray_order?: boolean;
  special_total_manual: number | null;
  special_real_total: number;
  special_paid_amount: number;
  special_pending_amount: number;
  table_name: string | null;
  split_code: string | null;
  total: number;
  tray_products_total?: number;
  tray_container_total?: number;
  items: {
    id: string;
    product_id: string;
    menu_node_id: string | null;
    image_url: string | null;
    icon: string | null;
    description_snapshot: string;
    quantity: number;
    unit_price: number;
    total: number;
    tray_item_type?: "A" | "B" | "C" | null;
    tray_container_cost?: number;
    paid_at: string | null;
    quantity_paid: number;
    quantity_pending: number;
    pending_total: number;
  }[];
}

export interface PaymentMethod {
  id: string;
  name: string;
}

export interface ItemPaymentInput {
  itemId: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface PaymentSplitInput {
  methodId: string;
  amount: number;
}

export interface PayOrderParams {
  orderId: string;
  itemSelections: ItemPaymentInput[];
  paymentSplits: PaymentSplitInput[];
  tenderedSplits: PaymentSplitInput[];
  isSpecial?: boolean;
  specialAmount?: number;
  receivedTotal: number;
  totalAmount: number;
  cashReceivedDenoms: { denomination_id: string; qty: number }[];
  cashChangeDenoms: { denomination_id: string; qty: number }[];
  preparedTransferProofSession?: PreparedTransferProofSession | null;
}

export interface PreparedTransferProofSession {
  paymentGroupId: string;
  paymentIds: string[];
  captureRequestIds: string[];
}

export type CompletedPaymentStatus = "APPLIED" | "PARTIAL" | "REVERSED" | "VOIDED";

export interface CompletedPayment {
  id: string;
  payment_group_id: string | null;
  created_at: string;
  cashier_name: string;
  amount: number;
  method_name: string;
  order_id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  is_special: boolean;
  table_name: string | null;
  split_code: string | null;
  order_total: number;
  order_paid_amount: number;
  order_pending_amount: number;
  order_status: Database["public"]["Enums"]["order_status"];
  status: CompletedPaymentStatus;
  notes: string | null;
  payment_item_id: string | null;
  item_id: string | null;
  item_description: string | null;
  item_quantity: number | null;
  item_paid_quantity: number | null;
  tray_item_type?: "A" | "B" | "C" | null;
  item_amount: number;
  reversal_requested: boolean;
}

export type CompletedPaymentsSortBy = "created_at" | "amount";
export type CompletedPaymentsSortDir = "asc" | "desc";

export interface CompletedPaymentsFilters {
  orderQuery: string;
  methodId: string;
  fromDateTime: string;
  toDateTime: string;
  sortBy: CompletedPaymentsSortBy;
  sortDir: CompletedPaymentsSortDir;
  page: number;
  pageSize: number;
}

interface CompletedPaymentsResult {
  rows: CompletedPayment[];
  total: number;
  methodSummary: CompletedPaymentsMethodSummary[];
  collectedTotal: number;
}

export interface CompletedPaymentsMethodSummary {
  methodId: string;
  methodName: string;
  amount: number;
  paymentCount: number;
}

const DEFAULT_CASHIER_REVERSE_WINDOW_MINUTES = 15;
const DEFAULT_PAYMENT_CAPTURE_TOKEN_TTL_MINUTES = 20;

function parseNumericSetting(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object") {
    const candidate = (value as Record<string, unknown>).minutes;
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function toIsoFromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeForIlike(value: string): string {
  return value.replace(/%/g, "").trim();
}

type PaymentNoteMeta = {
  itemId: string | null;
  paymentGroupId: string | null;
  itemsAnchor: boolean;
  reversalRequested: boolean;
  reversed: boolean;
  voided: boolean;
  transferProofPending: boolean;
  quantity: number | null;
  tenderedAmount: number | null;
};

function parsePaymentNotes(notes: string | null): PaymentNoteMeta {
  if (!notes) {
    return {
      itemId: null,
      paymentGroupId: null,
        itemsAnchor: false,
        reversalRequested: false,
        reversed: false,
        voided: false,
        transferProofPending: false,
        quantity: null,
        tenderedAmount: null,
      };
  }

  const segments = notes.split("|").map((s) => s.trim());

  let itemId: string | null = null;
  let paymentGroupId: string | null = null;
  let itemsAnchor = false;
  let reversalRequested = false;
  let reversed = false;
  let voided = false;
  let transferProofPending = false;
  let quantity: number | null = null;
  let tenderedAmount: number | null = null;

  for (const segment of segments) {
    if (segment.startsWith("ITEM:")) {
      itemId = segment.replace("ITEM:", "").trim() || null;
    }
    if (segment.startsWith("GROUP:")) {
      paymentGroupId = segment.replace("GROUP:", "").trim() || null;
    }
    if (segment.startsWith("ITEMS_ANCHOR:")) {
      itemsAnchor = segment.replace("ITEMS_ANCHOR:", "").trim() === "1";
    }
    if (segment.startsWith("REVERSAL_REQUESTED:")) {
      reversalRequested = true;
    }
    if (segment.startsWith("REVERSED:")) {
      reversed = true;
    }
    if (segment.startsWith("VOIDED:")) {
      voided = true;
    }
    if (segment === "TRANSFER_PROOF_PENDING:1") {
      transferProofPending = true;
    }
    if (segment.startsWith("QTY:")) {
      const parsedQty = Number(segment.replace("QTY:", "").trim());
      quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null;
    }
    if (segment.startsWith("TENDERED:")) {
      const parsedTendered = Number(segment.replace("TENDERED:", "").trim());
      tenderedAmount = Number.isFinite(parsedTendered) && parsedTendered >= 0 ? roundMoney(parsedTendered) : null;
    }
  }

  return { itemId, paymentGroupId, itemsAnchor, reversalRequested, reversed, voided, transferProofPending, quantity, tenderedAmount };
}

function isSpecialOrderNote(notes: string | null) {
  return String(notes ?? "")
    .split("|")
    .map((segment) => segment.trim())
    .some((segment) => segment === "SPECIAL_ORDER:1");
}

function appendNoteMarker(existingNotes: string | null, marker: string): string {
  const current = (existingNotes ?? "").trim();
  if (!current) return marker;
  if (current.includes(marker)) return current;
  return `${current}|${marker}`;
}

function buildMarker(prefix: string, userId: string, reason: string): string {
  const encodedReason = encodeURIComponent(reason.trim());
  return `${prefix}:${new Date().toISOString()}:${userId}:${encodedReason}`;
}

function isMissingRpcSignature(error: any, functionName: string) {
  const message = String(error?.message ?? "");
  return message.includes("schema cache") || message.includes(`Could not find the function public.${functionName}`);
}

function isRowLevelSecurityError(error: any) {
  const message = String(error?.message ?? "");
  return message.toLowerCase().includes("row-level security");
}

function isMissingTableError(error: any, tableName: string) {
  const message = String(error?.message ?? "");
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || message.includes(`relation "${tableName}" does not exist`)
    || message.includes(`Could not find the table '${tableName}'`)
    || message.includes(`Could not find the table "${tableName}"`);
}

export async function syncOrderPaymentState(orderId: string) {
  const { data, error } = await supabase.rpc("sync_order_payment_state" as never, {
    p_order_id: orderId,
  } as never);

  if (!error) {
    const row = Array.isArray(data)
      ? (data[0] as { order_id?: string; status?: string; paid_at?: string | null } | undefined)
      : undefined;

    return row
      ? {
          orderId: row.order_id ?? orderId,
          status: row.status ?? null,
          paidAt: row.paid_at ?? null,
        }
      : {
          orderId,
          status: null,
          paidAt: null,
        };
  }

  if (isMissingRpcSignature(error, "sync_order_payment_state")) {
    throw new Error(
      "La base de datos aun no tiene habilitada la sincronizacion segura de pagos. Aplica la migracion mas reciente."
    );
  }

  throw error;
}

function buildPaymentCaptureToken() {
  return generateUUID().replace(/-/g, "");
}

function buildPaymentNote(params: {
  paymentGroupId: string;
  index: number;
  tenderedAmount: number;
  appliedAmount: number;
  isSpecial: boolean;
  transferProofPending?: boolean;
}) {
  return [
    `GROUP:${params.paymentGroupId}`,
    `ITEMS_ANCHOR:${params.index === 0 ? 1 : 0}`,
    `TENDERED:${params.tenderedAmount.toFixed(2)}`,
    `APPLIED:${params.appliedAmount.toFixed(2)}`,
    ...(params.isSpecial ? ["SPECIAL_ORDER:1"] : []),
    ...(params.transferProofPending ? ["TRANSFER_PROOF_PENDING:1"] : []),
  ].join("|");
}

type PaymentItemRow = {
  id: string;
  payment_id: string;
  order_item_id: string;
  quantity_paid: number;
  unit_price: number;
  total_amount: number;
};

async function fetchActivePaymentItemsForOrderItems(orderItemIds: string[]): Promise<PaymentItemRow[]> {
  if (orderItemIds.length === 0) return [];

  const { data: paymentItems, error: paymentItemsError } = await supabase
    .from("payment_items")
    .select("id, payment_id, order_item_id, quantity_paid, unit_price, total_amount")
    .in("order_item_id", orderItemIds);
  if (paymentItemsError) throw paymentItemsError;

  const paymentIds = [...new Set((paymentItems ?? []).map((row) => row.payment_id))];
  if (paymentIds.length === 0) return [];

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select("id, notes")
    .in("id", paymentIds);
  if (paymentsError) throw paymentsError;

  const blockedPaymentIds = new Set(
    (payments ?? [])
      .filter((payment) => {
        const meta = parsePaymentNotes(payment.notes);
        return meta.reversed || meta.voided || meta.transferProofPending;
      })
      .map((payment) => payment.id)
  );

  return (paymentItems ?? [])
    .filter((row) => !blockedPaymentIds.has(row.payment_id))
    .map((row) => ({
      id: row.id,
      payment_id: row.payment_id,
      order_item_id: row.order_item_id,
      quantity_paid: Number(row.quantity_paid),
      unit_price: Number(row.unit_price),
      total_amount: Number(row.total_amount),
    }));
}

function aggregatePaidQuantityByOrderItem(rows: PaymentItemRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.order_item_id] = (map[row.order_item_id] ?? 0) + Number(row.quantity_paid);
  }
  return map;
}

async function fetchActivePaymentsTotalByOrder(orderIds: string[]): Promise<Record<string, number>> {
  if (orderIds.length === 0) return {};

  const { data: payments, error } = await supabase
    .from("payments")
    .select("order_id, amount, notes")
    .in("order_id", orderIds);
  if (error) throw error;

  const totals: Record<string, number> = {};
  for (const payment of payments ?? []) {
    const meta = parsePaymentNotes(payment.notes);
    if (meta.reversed || meta.voided || meta.transferProofPending) continue;
    totals[payment.order_id] = roundMoney((totals[payment.order_id] ?? 0) + Number(payment.amount ?? 0));
  }

  return totals;
}

async function fetchAppliedCancelledQuantityByOrderItem(orderItemIds: string[]): Promise<Record<string, number>> {
  if (orderItemIds.length === 0) return {};

  try {
    const { data: itemCancellations, error: itemCancellationsError } = await supabase
      .from("order_item_cancellations")
      .select("order_item_id, quantity_cancelled, order_cancellation_id")
      .in("order_item_id", orderItemIds);
    if (itemCancellationsError) throw itemCancellationsError;

    const cancellationIds = [...new Set((itemCancellations ?? []).map((row) => row.order_cancellation_id))];
    if (cancellationIds.length === 0) return {};

    const { data: cancellationHeaders, error: headersError } = await supabase
      .from("order_cancellations")
      .select("id, status")
      .in("id", cancellationIds);
    if (headersError) throw headersError;

    const activeCancellationIds = new Set(
      (cancellationHeaders ?? []).filter((header) => header.status === "APPLIED").map((header) => header.id)
    );

    const map: Record<string, number> = {};
    for (const row of itemCancellations ?? []) {
      if (!activeCancellationIds.has(row.order_cancellation_id)) continue;
      map[row.order_item_id] = (map[row.order_item_id] ?? 0) + Number(row.quantity_cancelled);
    }
    return map;
  } catch {
    return {};
  }
}

function resolvePaidQuantity(params: {
  payableQuantity: number;
  orderedQuantity: number;
  paidQuantityFromPayments: number;
  paidAt?: string | null;
}) {
  const fallbackPaidQuantity = params.paidQuantityFromPayments > 0
    ? params.paidQuantityFromPayments
    : params.paidAt
      ? params.orderedQuantity
      : 0;

  return Math.min(params.payableQuantity, fallbackPaidQuantity);
}

function getPayableQuantityForOrderType(
  orderType: "DINE_IN" | "TAKEOUT",
  quantities: ReturnType<typeof computeOperationalQuantities>,
) {
  if (orderType === "TAKEOUT") {
    return Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
  }

  return quantities.quantityDispatchedAvailable;
}

export function useCaja(completedPaymentsFilters?: CompletedPaymentsFilters) {
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();

  const denomsQuery = useQuery({
    queryKey: ["denominations"],
    queryFn: () =>
      dbSelect<Denomination>("denominations", {
        select: "id, label, denomination_type, value, display_order, image_url",
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "display_order" },
      }),
    enabled: true,
  });

  const branchTableSettingsQuery = useQuery({
    queryKey: ["branch-table-settings", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return { reference_table_count: 0 };

      const { data, error } = await supabase
        .from("branches")
        .select("reference_table_count")
        .eq("id", activeBranchId)
        .single();
      if (error) throw error;

      return {
        reference_table_count: Number(data.reference_table_count ?? 0),
      };
    },
    enabled: !!activeBranchId,
  });

  const shiftQuery = useQuery({
    queryKey: ["current-shift", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;

      const { data, error } = await (supabase
        .from("cash_shifts" as never)
        .select("id, branch_id, status, caja_status, cashier_id, capture_user_id, capture_device_label, opened_at, closed_at, notes, active_tables_count")
        .eq("branch_id", activeBranchId)
        .eq("status", "OPEN")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle() as any);
      if (error) throw error;
      if (!data) return null;

      const { data: denoms, error: denomsError } = await supabase
        .from("cash_shift_denoms")
        .select("id, denomination_id, qty_initial, qty_current")
        .eq("shift_id", data.id);
      if (denomsError) throw denomsError;

      const allDenoms = denomsQuery.data ?? [];
      const enriched: ShiftDenom[] = (denoms ?? []).map((d: any) => {
        const denom = allDenoms.find((ad) => ad.id === d.denomination_id);
        return {
          ...d,
          label: denom?.label ?? "",
          denomination_type: denom?.denomination_type,
          display_order: denom?.display_order ?? 0,
          value: denom?.value ?? 0,
          image_url: denom?.image_url ?? null,
        };
      });

      const { data: openingHistoryData, error: openingHistoryError } = await supabase.rpc(
        "list_cash_register_openings" as never,
        { p_shift_id: data.id } as never,
      );
      if (openingHistoryError) throw openingHistoryError;

      const openingHistory = ((openingHistoryData ?? []) as any[]).map((row) => ({
        id: row.id,
        shift_id: row.shift_id,
        status: row.status,
        cashier_id: row.cashier_id,
        cashier_name: row.cashier_name,
        cashier_username: row.cashier_username,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        initial_total: Number(row.initial_total ?? 0),
        notes: row.notes ?? null,
        anulada_por: row.anulada_por ?? null,
        anulada_por_nombre: row.anulada_por_nombre ?? null,
        anulada_por_username: row.anulada_por_username ?? null,
        anulada_at: row.anulada_at ?? null,
        motivo_anulacion: row.motivo_anulacion ?? null,
        is_current: Boolean(row.is_current),
        payment_count: Number(row.payment_count ?? 0),
      })) as CashRegisterOpeningHistoryEntry[];

      return {
        ...data,
        capture_user_id: data.capture_user_id ?? null,
        capture_device_label: data.capture_device_label ?? null,
        denoms: enriched,
        openingHistory,
      } as CashShift;
    },
    enabled: !!activeBranchId && !!denomsQuery.data,
  });

  const captureCandidatesQuery = useQuery({
    queryKey: ["cash-shift-capture-candidates", shiftQuery.data?.id],
    queryFn: async (): Promise<CashShiftCaptureCandidate[]> => {
      const shift = shiftQuery.data;
      if (!shift?.id) return [];

      const { data: shiftUsers, error: shiftUsersError } = await (supabase
        .from("cash_shift_users" as never)
        .select("user_id")
        .eq("shift_id", shift.id)
        .eq("is_enabled", true)
        .eq("can_use_caja", true) as any);
      if (shiftUsersError) throw shiftUsersError;

      const userIds = [...new Set((shiftUsers ?? []).map((row: any) => row.user_id).filter(Boolean))];
      if (userIds.length === 0) return [];

      const { data: profiles, error: profilesError } = await (supabase
        .from("profiles" as never)
        .select("id, full_name, username, is_active")
        .in("id", userIds) as any);
      if (profilesError) throw profilesError;

      return (profiles ?? [])
        .filter((profile: any) => profile.is_active !== false)
        .map((profile: any) => ({
          id: profile.id,
          full_name: profile.full_name ?? "Usuario",
          username: profile.username ?? "",
        }))
        .sort((a: CashShiftCaptureCandidate, b: CashShiftCaptureCandidate) =>
          a.full_name.localeCompare(b.full_name, "es", { sensitivity: "base" })
          || a.username.localeCompare(b.username, "es", { sensitivity: "base" }),
        );
    },
    enabled: !!shiftQuery.data?.id,
  });

  const pendingCaptureRequestsQuery = useQuery({
    queryKey: ["pending-payment-capture-requests", shiftQuery.data?.id, user?.id],
    queryFn: async (): Promise<PendingPaymentCaptureRequest[]> => {
      const shift = shiftQuery.data;
      if (!shift?.id || !user?.id) return [];
      if (shift.cashier_id !== user.id) return [];

      const { data: requestRows, error: requestRowsError } = await (supabase
        .from("payment_capture_requests" as never)
        .select("id, payment_id, status, secure_token, token_expires_at, created_at")
        .eq("cash_session_id", shift.id)
        .eq("assigned_capture_user_id", user.id)
        .in("status", ["pending", "opened"])
        .order("created_at", { ascending: true }) as any);

      if (requestRowsError) {
        if (isMissingTableError(requestRowsError, "payment_capture_requests")) {
          return [];
        }
        throw requestRowsError;
      }

      const requests = (requestRows ?? []) as Array<{
        id: string;
        payment_id: string;
        status: PendingPaymentCaptureRequest["status"];
        secure_token: string;
        token_expires_at: string;
        created_at: string;
      }>;

      if (requests.length === 0) return [];

      const paymentIds = [...new Set(requests.map((row) => row.payment_id).filter(Boolean))];

      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("id, order_id, payment_method_id, amount")
        .in("id", paymentIds);
      if (paymentsError) throw paymentsError;

      const payments = paymentsData ?? [];
      const orderIds = [...new Set(payments.map((row) => row.order_id).filter(Boolean))];
      const methodIds = [...new Set(payments.map((row) => row.payment_method_id).filter(Boolean))];

      const [{ data: ordersData, error: ordersError }, { data: methodsData, error: methodsError }] = await Promise.all([
        orderIds.length === 0
          ? Promise.resolve({ data: [] as Array<{ id: string; order_number: number | null; order_code: string | null }>, error: null })
          : supabase.from("orders").select("id, order_number, order_code").in("id", orderIds),
        methodIds.length === 0
          ? Promise.resolve({ data: [] as Array<{ id: string; name: string | null }>, error: null })
          : supabase.from("payment_methods").select("id, name").in("id", methodIds),
      ]);

      if (ordersError) throw ordersError;
      if (methodsError) throw methodsError;

      const paymentsMap = Object.fromEntries(payments.map((payment) => [payment.id, payment]));
      const ordersMap = Object.fromEntries((ordersData ?? []).map((order) => [order.id, order]));
      const methodsMap = Object.fromEntries((methodsData ?? []).map((method) => [method.id, method]));

      return requests.map((request) => {
        const payment = paymentsMap[request.payment_id];
        const order = payment ? ordersMap[payment.order_id] : null;
        const method = payment ? methodsMap[payment.payment_method_id] : null;

        return {
          ...request,
          amount: Number(payment?.amount ?? 0),
          order_id: payment?.order_id ?? "",
          order_number: order?.order_number ?? null,
          order_code: order?.order_code ?? null,
          payment_method_name: method?.name ?? "Transferencia",
        };
      });
    },
    enabled: !!shiftQuery.data?.id && !!user?.id,
    refetchInterval: ({ state }) => (state.data && state.data.length > 0 ? 3000 : 5000),
  });

  const openCaptureRequest = useMutation({
    mutationFn: async (requestId: string) => {
      const shift = shiftQuery.data;
      if (!shift?.id) throw new Error("No hay turno abierto");
      if (!user?.id) throw new Error("No user");

      const now = new Date().toISOString();
      const { error } = await (supabase
        .from("payment_capture_requests" as never)
        .update({
          status: "opened",
          opened_at: now,
          updated_at: now,
        } as never)
        .eq("id", requestId)
        .eq("cash_session_id", shift.id)
        .eq("assigned_capture_user_id", user.id)
        .in("status", ["pending", "opened"]) as any);

      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-payment-capture-requests"], exact: false });
    },
    onError: (err: any) => {
      if (isMissingTableError(err, "payment_capture_requests")) {
        toast.error("La base de datos todavia no tiene habilitado el modulo de comprobantes.");
        return;
      }
      toast.error(err.message ?? "No se pudo abrir la solicitud de comprobante");
    },
  });

  const prepareTransferProof = useMutation({
    mutationFn: async ({
      orderId,
      paymentSplits,
      tenderedSplits,
      isSpecial = false,
    }: {
      orderId: string;
      paymentSplits: PaymentSplitInput[];
      tenderedSplits: PaymentSplitInput[];
      isSpecial?: boolean;
    }): Promise<PreparedTransferProofSession> => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (!activeBranchId) throw new Error("No se pudo determinar la sucursal activa");
      if (!user) throw new Error("No user");

      const { data: selectedMethods, error: selectedMethodsError } = await supabase
        .from("payment_methods")
        .select("id, name")
        .in("id", paymentSplits.map((split) => split.methodId));
      if (selectedMethodsError) throw selectedMethodsError;

      const transferMethodIds = new Set(
        (selectedMethods ?? [])
          .filter((method) => isTransferPaymentMethodName(method.name))
          .map((method) => method.id),
      );

      const transferSplits = paymentSplits.filter((split) => transferMethodIds.has(split.methodId));
      if (transferSplits.length === 0) {
        throw new Error("No hay pagos por transferencia para preparar.");
      }
      if (!shift.cashier_id) {
        throw new Error("Este turno no tiene usuario de caja configurado.");
      }

      const { data: orphanedPayments } = await supabase
        .from("payments")
        .select("id")
        .eq("created_by", user.id)
        .like("notes", "%TRANSFER_PROOF_PENDING:1%");

      if (orphanedPayments && orphanedPayments.length > 0) {
        const orphanedPaymentIds = orphanedPayments.map((p) => p.id);
        
        await (supabase
          .from("payment_capture_requests" as never)
          .delete()
          .in("payment_id", orphanedPaymentIds) as any);
          
        await supabase
          .from("payments")
          .delete()
          .in("id", orphanedPaymentIds);
      }

      const now = new Date().toISOString();
      const paymentGroupId = generateUUID();
      const tenderedByMethod = Object.fromEntries(tenderedSplits.map((split) => [split.methodId, roundMoney(split.amount)]));

      const paymentsToInsert = transferSplits.map((paymentSplit, index) => ({
        id: generateUUID(),
        order_id: orderId,
        payment_method_id: paymentSplit.methodId,
        amount: paymentSplit.amount,
        notes: buildPaymentNote({
          paymentGroupId,
          index,
          tenderedAmount: tenderedByMethod[paymentSplit.methodId] ?? paymentSplit.amount,
          appliedAmount: Number(paymentSplit.amount),
          isSpecial,
          transferProofPending: true,
        }),
        created_by: user.id,
        created_at: now,
      }));

      await Promise.all(paymentsToInsert.map((payment) => dbInsert("payments", payment)));

      const captureRequestsToInsert = paymentsToInsert.map((payment) => ({
        id: generateUUID(),
        cash_session_id: shift.id,
        payment_id: payment.id,
        branch_id: activeBranchId,
        requested_by_user_id: user.id,
        assigned_capture_user_id: shift.cashier_id,
        status: "pending",
        secure_token: buildPaymentCaptureToken(),
        token_expires_at: new Date(Date.now() + DEFAULT_PAYMENT_CAPTURE_TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
        created_at: now,
        updated_at: now,
      }));

      try {
        const { error } = await (supabase.from("payment_capture_requests" as never).insert(captureRequestsToInsert as never) as any);
        if (error) throw error;
      } catch (error) {
        await Promise.all(paymentsToInsert.map((payment) => supabase.from("payments").delete().eq("id", payment.id)));
        if (isMissingTableError(error, "payment_capture_requests")) {
          throw new Error("La base de datos todavia no tiene habilitado el modulo de comprobantes.");
        }
        throw error;
      }

      return {
        paymentGroupId,
        paymentIds: paymentsToInsert.map((payment) => payment.id),
        captureRequestIds: captureRequestsToInsert.map((request) => request.id),
      };
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["pending-payment-capture-requests"], exact: false });
      toast.success("Solicitud de foto enviada para el pago por transferencia.");
    },
    onError: (err: any) => toast.error(err.message ?? "No se pudo solicitar la foto de transferencia"),
  });

  const discardPreparedTransferProof = useMutation({
    mutationFn: async (session: PreparedTransferProofSession) => {
      if (session.captureRequestIds.length > 0) {
        const { error: captureDeleteError } = await (supabase
          .from("payment_capture_requests" as never)
          .delete()
          .in("id", session.captureRequestIds) as any);
        if (captureDeleteError && !isMissingTableError(captureDeleteError, "payment_capture_requests")) {
          throw captureDeleteError;
        }
      }

      if (session.paymentIds.length > 0) {
        const { error: paymentDeleteError } = await supabase
          .from("payments")
          .delete()
          .in("id", session.paymentIds);
        if (paymentDeleteError) throw paymentDeleteError;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-payment-capture-requests"], exact: false });
      qc.invalidateQueries({ queryKey: ["payable-orders"], exact: false });
    },
  });

  const getTransferProofReadiness = async (paymentIds: string[]) => {
    if (paymentIds.length === 0) return { ready: true, uploadedCount: 0, totalCount: 0 };

    const { data, error } = await (supabase
      .from("payment_capture_requests" as never)
      .select("payment_id, status")
      .in("payment_id", paymentIds) as any);
    if (error) {
      if (isMissingTableError(error, "payment_capture_requests")) {
        throw new Error("La base de datos todavia no tiene habilitado el modulo de comprobantes.");
      }
      throw error;
    }

    const rows = (data ?? []) as Array<{ payment_id: string; status: PendingPaymentCaptureRequest["status"] }>;
    const uploadedCount = rows.filter((row) => ["uploaded", "approved"].includes(row.status)).length;
    return {
      ready: rows.length === paymentIds.length && uploadedCount === paymentIds.length,
      uploadedCount,
      totalCount: paymentIds.length,
    };
  };

  const movementsQuery = useQuery({
    queryKey: ["cash-register-movements", shiftQuery.data?.id],
    queryFn: async () => {
      const shift = shiftQuery.data;
      if (!shift) return [];

      const { data, error } = await supabase.rpc(
        "list_cash_register_movements" as never,
        { p_turno_id: shift.id } as never,
      );
      if (error) throw error;

      return ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        shiftId: row.shift_id,
        branchId: row.branch_id,
        movementType: row.movement_type,
        amount: Number(row.amount ?? 0),
        reason: row.reason ?? "",
        movementDetail: (row.movement_detail ?? null) as CashRegisterMovementDetail | null,
        recordedBy: row.recorded_by,
        recordedByName: row.recorded_by_name ?? null,
        recordedByUsername: row.recorded_by_username ?? null,
        createdAt: row.created_at,
      })) as CashRegisterMovement[];
    },
    enabled: !!shiftQuery.data?.id && shiftQuery.data?.caja_status === "OPEN",
  });

  const ordersQuery = useQuery({
    queryKey: ["payable-orders", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, order_code, order_type, table_id, split_id, status, is_special, is_tray_order, special_total_manual")
        .eq("branch_id", activeBranchId)
        .in("status", ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"])
        .order("updated_at");
      if (error) throw error;
      if (!orders || orders.length === 0) return [];

      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      let tablesMap: Record<string, string> = {};
      if (tableIds.length > 0) {
        const { data: tables } = await supabase.from("restaurant_tables").select("id, name").in("id", tableIds);
        tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, t.name]));
      }

      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const { data: splits } = await supabase.from("table_splits").select("id, split_code").in("id", splitIds);
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      const orderIds = orders.map((o) => o.id);
      const { data: items, error: itemsError } = await supabase
        .from("order_items")
        .select("id, order_id, product_id, description_snapshot, quantity, unit_price, total, paid_at, tray_item_type, tray_container_cost")
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      const legacyProductIds = [...new Set((items ?? []).map((item) => item.product_id).filter(Boolean))] as string[];
      let menuNodeByLegacyProductId: Record<string, { id: string; image_url: string | null; icon: string | null }> = {};
      if (legacyProductIds.length > 0) {
        const { data: menuNodes, error: menuNodesError } = await supabase
          .from("menu_nodes" as never)
          .select("id, legacy_product_id, image_url, icon")
          .eq("branch_id", activeBranchId)
          .eq("is_active", true)
          .in("legacy_product_id", legacyProductIds);
        if (menuNodesError) throw menuNodesError;

        menuNodeByLegacyProductId = Object.fromEntries(
          ((menuNodes ?? []) as Array<{ id: string; legacy_product_id: string | null; image_url?: string | null; icon?: string | null }>)
            .filter((node) => Boolean(node.legacy_product_id))
            .map((node) => [
              node.legacy_product_id as string,
              {
                id: node.id,
                image_url: node.image_url ?? null,
                icon: node.icon ?? null,
              },
            ]),
        );
      }

      const orderItemIds = (items ?? []).map((item) => item.id);
      const [activePaymentItems, activePaymentsTotalByOrder] = await Promise.all([
        fetchActivePaymentItemsForOrderItems(orderItemIds),
        fetchActivePaymentsTotalByOrder(orderIds),
      ]);
      const paidQtyMap = aggregatePaidQuantityByOrderItem(activePaymentItems);
      const operationalMaps = await fetchOperationalMapsForOrders(orderIds);

      return orders
        .map((o) => {
          const orderItems = (items ?? []).filter((i) => i.order_id === o.id);
          const mappedItems = orderItems
            .map((i) => {
              const quantities = computeOperationalQuantities({
                quantityOrdered: Number(i.quantity ?? 0),
                quantityReadyTotal: operationalMaps.readyMap[i.id] ?? 0,
                quantityDispatchedTotal: operationalMaps.dispatchedTotalMap[i.id] ?? 0,
                quantityCancelledPending: operationalMaps.cancelledPendingMap[i.id] ?? 0,
                quantityCancelledReady: operationalMaps.cancelledReadyMap[i.id] ?? 0,
                quantityCancelledDispatched: operationalMaps.cancelledDispatchedMap[i.id] ?? 0,
              });

              const activeOrderedQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
              const payableQty = (o as { is_special?: boolean | null }).is_special
                ? activeOrderedQty
                : getPayableQuantityForOrderType(o.order_type as "DINE_IN" | "TAKEOUT", quantities);
              const paidQty = resolvePaidQuantity({
                payableQuantity: payableQty,
                orderedQuantity: Number(i.quantity ?? 0),
                paidQuantityFromPayments: paidQtyMap[i.id] ?? 0,
                paidAt: i.paid_at,
              });
              const pendingQty = Math.max(0, payableQty - paidQty);

              return {
                id: i.id,
                product_id: i.product_id,
                menu_node_id: menuNodeByLegacyProductId[i.product_id]?.id ?? null,
                image_url: menuNodeByLegacyProductId[i.product_id]?.image_url ?? null,
                icon: menuNodeByLegacyProductId[i.product_id]?.icon ?? null,
                description_snapshot: i.description_snapshot,
                quantity: payableQty,
                unit_price: Number(i.unit_price),
                total: Number(i.total ?? computeLineAmount(payableQty, Number(i.unit_price))),
                tray_item_type: (i.tray_item_type ?? null) as "A" | "B" | "C" | null,
                tray_container_cost: Number(i.tray_container_cost ?? 0),
                paid_at: i.paid_at,
                quantity_paid: paidQty,
                quantity_pending: pendingQty,
                pending_total: pendingQty <= 0
                  ? 0
                  : roundMoney(
                      Math.max(0, Number(i.total ?? 0) - Number(i.tray_container_cost ?? 0))
                      * (pendingQty / Math.max(1, payableQty))
                      + (pendingQty > 0 ? Number(i.tray_container_cost ?? 0) : 0),
                    ),
              };
            })
            .filter((item) => item.quantity > 0 || item.quantity_paid > 0 || item.quantity_pending > 0);

          const isSpecial = Boolean((o as { is_special?: boolean | null }).is_special);
          const isTrayOrder = Boolean((o as { is_tray_order?: boolean | null }).is_tray_order);
          const specialRealTotal = roundMoney(mappedItems.reduce((sum, item) => sum + Number(item.total), 0));
          const trayContainerTotal = roundMoney(mappedItems.reduce((sum, item) => sum + Number(item.tray_container_cost ?? 0), 0));
          const trayProductsTotal = roundMoney(mappedItems.reduce((sum, item) => sum + Math.max(0, Number(item.total) - Number(item.tray_container_cost ?? 0)), 0));
          const specialManualTotal = isSpecial
            ? ((o as { special_total_manual?: number | null }).special_total_manual == null
                ? null
                : Number((o as { special_total_manual?: number | null }).special_total_manual))
            : null;
          const specialPaidAmount = isSpecial ? roundMoney(activePaymentsTotalByOrder[o.id] ?? 0) : 0;
          const specialPendingAmount = isSpecial && specialManualTotal != null
            ? roundMoney(Math.max(0, specialManualTotal - specialPaidAmount))
            : 0;
          const displayTotal = isSpecial && specialManualTotal != null ? specialManualTotal : specialRealTotal;

          return {
            id: o.id,
            order_number: o.order_number,
            order_code: (o as any).order_code ?? null,
            order_type: o.order_type,
            is_special: isSpecial,
            is_tray_order: isTrayOrder,
            special_total_manual: specialManualTotal,
            special_real_total: specialRealTotal,
            special_paid_amount: specialPaidAmount,
            special_pending_amount: specialPendingAmount,
            table_name: o.table_id ? tablesMap[o.table_id] ?? null : null,
            split_code: o.split_id ? splitsMap[o.split_id] ?? null : null,
            total: displayTotal,
            tray_products_total: trayProductsTotal,
            tray_container_total: trayContainerTotal,
            items: mappedItems,
          } as PayableOrder;
        })
        .filter((order) =>
          order.is_special
            ? (order.special_total_manual != null && order.special_pending_amount > 0)
            : order.items.some((item) => item.quantity_pending > 0),
        );
    },
    refetchInterval: 10000,
    enabled: !!activeBranchId,
  });

  const methodsQuery = useQuery({
    queryKey: ["payment-methods", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];

      let methods = await dbSelect<PaymentMethod>("payment_methods", {
        select: "id, name",
        branchId: activeBranchId,
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "name" },
      });

      if (!methods.some((method) => isCashPaymentMethodName(method.name))) {
        const cashMethodId = generateUUID();
        const { error } = await supabase.from("payment_methods").insert({
          id: cashMethodId,
          branch_id: activeBranchId,
          name: "Efectivo",
          is_active: true,
        });
        if (error) throw error;

        methods = await dbSelect<PaymentMethod>("payment_methods", {
          select: "id, name",
          branchId: activeBranchId,
          filters: [{ column: "is_active", op: "eq", value: true }],
          orderBy: { column: "name" },
        });
      }

      return dedupePaymentMethods(methods);
    },
    enabled: !!activeBranchId,
  });
  const cashierReverseWindowQuery = useQuery({
    queryKey: ["caja-cashier-reverse-window-minutes", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return DEFAULT_CASHIER_REVERSE_WINDOW_MINUTES;

      const branchKey = `caja.cashier_reverse_window_minutes.branch:${activeBranchId}`;
      const globalKey = "caja.cashier_reverse_window_minutes";

      const { data, error } = await supabase
        .from("system_settings")
        .select("key, value")
        .in("key", [branchKey, globalKey]);
      if (error) throw error;

      const byKey = new Map((data ?? []).map((row) => [row.key, row.value]));
      const branchValue = parseNumericSetting(byKey.get(branchKey));
      const globalValue = parseNumericSetting(byKey.get(globalKey));
      const resolved = branchValue ?? globalValue ?? DEFAULT_CASHIER_REVERSE_WINDOW_MINUTES;

      return Math.max(0, Math.floor(resolved));
    },
    enabled: !!activeBranchId,
  });

  const completedPaymentsQuery = useQuery({
    queryKey: [
      "completed-payments",
      activeBranchId,
      shiftQuery.data?.id,
      completedPaymentsFilters?.orderQuery ?? "",
      completedPaymentsFilters?.methodId ?? "ALL",
      completedPaymentsFilters?.fromDateTime ?? "",
      completedPaymentsFilters?.toDateTime ?? "",
      completedPaymentsFilters?.sortBy ?? "created_at",
      completedPaymentsFilters?.sortDir ?? "desc",
      completedPaymentsFilters?.page ?? 1,
      completedPaymentsFilters?.pageSize ?? 20,
    ],
    queryFn: async (): Promise<CompletedPaymentsResult> => {
      if (!activeBranchId) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const fromIso = toIsoFromDateTimeLocal(completedPaymentsFilters?.fromDateTime ?? "");
      const toIso = toIsoFromDateTimeLocal(completedPaymentsFilters?.toDateTime ?? "");

      let effectiveStartIso = fromIso;
      let effectiveEndIso = toIso;

      if (!effectiveStartIso) {
        if (shiftQuery.data?.opened_at) {
          effectiveStartIso = shiftQuery.data.opened_at;
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          effectiveStartIso = today.toISOString();
        }
      }

      if (!effectiveEndIso) {
        if (shiftQuery.data) {
          effectiveEndIso = shiftQuery.data.closed_at ?? new Date().toISOString();
        } else {
          effectiveEndIso = new Date().toISOString();
        }
      }

      const { data: branchOrders, error: branchOrdersError } = await supabase
        .from("orders")
        .select("id")
        .eq("branch_id", activeBranchId);
      if (branchOrdersError) throw branchOrdersError;

      const branchOrderIds = (branchOrders ?? []).map((order) => order.id);
      if (branchOrderIds.length === 0) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const buildPaymentsQuery = (withCount = false) => {
        let query = supabase
          .from("payments")
          .select("id, created_at, amount, notes, order_id, payment_method_id, created_by", withCount ? { count: "exact" } : undefined)
          .in("order_id", branchOrderIds)
          .gte("created_at", effectiveStartIso)
          .lte("created_at", effectiveEndIso);

        if (completedPaymentsFilters?.methodId && completedPaymentsFilters.methodId !== "ALL") {
          query = query.eq("payment_method_id", completedPaymentsFilters.methodId);
        }

        return query;
      };

      let summaryPaymentsQuery = buildPaymentsQuery(false);
      let paymentsQuery = buildPaymentsQuery(true);

      const orderSearch = sanitizeForIlike(completedPaymentsFilters?.orderQuery ?? "");
      if (orderSearch) {
        const parsedOrderNumber = Number(orderSearch);

        const [ordersByCodeOrNumber, matchingTables] = await Promise.all([
          Number.isNaN(parsedOrderNumber)
            ? supabase
                .from("orders")
                .select("id")
                .eq("branch_id", activeBranchId)
                .ilike("order_code", `%${orderSearch}%`)
            : supabase
                .from("orders")
                .select("id")
                .eq("branch_id", activeBranchId)
                .or(`order_number.eq.${parsedOrderNumber},order_code.ilike.%${orderSearch}%`),
          supabase.from("restaurant_tables").select("id").eq("branch_id", activeBranchId).ilike("name", `%${orderSearch}%`),
        ]);

        if (ordersByCodeOrNumber.error) throw ordersByCodeOrNumber.error;
        if (matchingTables.error) throw matchingTables.error;

        const tableIds = (matchingTables.data ?? []).map((t) => t.id);
        let ordersByTable: { id: string }[] = [];
        if (tableIds.length > 0) {
          const { data: ordersByTableData, error: ordersByTableError } = await supabase
            .from("orders")
            .select("id")
            .eq("branch_id", activeBranchId)
            .in("table_id", tableIds);
          if (ordersByTableError) throw ordersByTableError;
          ordersByTable = ordersByTableData ?? [];
        }

        const matchingOrderIds = [
          ...new Set([...(ordersByCodeOrNumber.data ?? []).map((o) => o.id), ...ordersByTable.map((o) => o.id)]),
        ];

        if (matchingOrderIds.length === 0) {
          return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
        }
        summaryPaymentsQuery = summaryPaymentsQuery.in("order_id", matchingOrderIds);
        paymentsQuery = paymentsQuery.in("order_id", matchingOrderIds);
      }

      const { data: summaryPayments, error: summaryPaymentsError } = await summaryPaymentsQuery;
      if (summaryPaymentsError) throw summaryPaymentsError;

      if (!summaryPayments || summaryPayments.length === 0) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const sortBy = completedPaymentsFilters?.sortBy ?? "created_at";
      const sortDir = completedPaymentsFilters?.sortDir ?? "desc";
      const pageSize = completedPaymentsFilters?.pageSize ?? 20;
      const page = Math.max(1, completedPaymentsFilters?.page ?? 1);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      paymentsQuery = paymentsQuery.order(sortBy, { ascending: sortDir === "asc" }).range(from, to);

      const { data: payments, error: paymentsError, count } = await paymentsQuery;
      if (paymentsError) throw paymentsError;
      if (!payments || payments.length === 0) {
        const summaryMethodIds = [...new Set(summaryPayments.map((payment) => payment.payment_method_id))];
        let methodsMap: Record<string, string> = {};
        if (summaryMethodIds.length > 0) {
          const { data: methods, error: methodsError } = await supabase
            .from("payment_methods")
            .select("id, name")
            .in("id", summaryMethodIds);
          if (methodsError) throw methodsError;
          methodsMap = Object.fromEntries((methods ?? []).map((method) => [method.id, method.name]));
        }

        const summaryMap = new Map<string, { amount: number; paymentCount: number }>();
        for (const payment of summaryPayments) {
          const meta = parsePaymentNotes(payment.notes);
            if (meta.reversed || meta.voided || meta.transferProofPending) continue;
          const current = summaryMap.get(payment.payment_method_id) ?? { amount: 0, paymentCount: 0 };
          current.amount += meta.tenderedAmount ?? Number(payment.amount);
          current.paymentCount += 1;
          summaryMap.set(payment.payment_method_id, current);
        }

        const methodSummary = Array.from(summaryMap.entries())
          .map(([methodId, totals]) => ({
            methodId,
            methodName: methodsMap[methodId] ?? "Metodo",
            amount: roundMoney(totals.amount),
            paymentCount: totals.paymentCount,
          }))
          .sort((a, b) => b.amount - a.amount || a.methodName.localeCompare(b.methodName));

        const collectedTotal = roundMoney(methodSummary.reduce((sum, row) => sum + row.amount, 0));

        return { rows: [], total: count ?? 0, methodSummary, collectedTotal };
      }

      const orderIds = [...new Set(payments.map((p) => p.order_id))];
      const methodIds = [...new Set([...payments.map((p) => p.payment_method_id), ...summaryPayments.map((p) => p.payment_method_id)])];
      const createdByIds = [...new Set(payments.map((p) => p.created_by))];
      const { data: selectedPaymentItems, error: selectedPaymentItemsError } = await supabase
        .from("payment_items")
        .select("id, payment_id, order_item_id, quantity_paid, unit_price, total_amount")
        .in("payment_id", payments.map((payment) => payment.id));
      if (selectedPaymentItemsError) throw selectedPaymentItemsError;

      const itemIdsFromNotes = payments
        .map((payment) => parsePaymentNotes(payment.notes).itemId)
        .filter((itemId): itemId is string => Boolean(itemId));
      const itemIds = [
        ...new Set([
          ...itemIdsFromNotes,
          ...(selectedPaymentItems ?? []).map((item) => item.order_item_id),
        ]),
      ];

      const [ordersRes, methodsRes, profilesRes, allOrderPaymentsRes, allOrderItemsRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, order_number, order_code, order_type, table_id, split_id, branch_id, status, is_special, special_total_manual")
          .in("id", orderIds)
          .eq("branch_id", activeBranchId),
        supabase.from("payment_methods").select("id, name").in("id", methodIds),
        supabase.from("profiles").select("id, full_name, username").in("id", createdByIds),
        supabase.from("payments").select("order_id, amount, notes").in("order_id", orderIds),
        supabase.from("order_items").select("order_id, total").in("order_id", orderIds),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (methodsRes.error) throw methodsRes.error;
      if (profilesRes.error) throw profilesRes.error;
      if (allOrderPaymentsRes.error) throw allOrderPaymentsRes.error;
      if (allOrderItemsRes.error) throw allOrderItemsRes.error;

      const orders = ordersRes.data ?? [];
      const methods = methodsRes.data ?? [];
      const profiles = profilesRes.data ?? [];
      const allOrderPayments = allOrderPaymentsRes.data ?? [];
      const allOrderItems = allOrderItemsRes.data ?? [];

      const tableIds = [...new Set(orders.map((o) => o.table_id).filter(Boolean))] as string[];
      const splitIds = [...new Set(orders.map((o) => o.split_id).filter(Boolean))] as string[];

      const [{ data: tables }, { data: splits }, { data: items }] = await Promise.all([
        tableIds.length > 0
          ? supabase.from("restaurant_tables").select("id, name").in("id", tableIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        splitIds.length > 0
          ? supabase.from("table_splits").select("id, split_code").in("id", splitIds)
          : Promise.resolve({ data: [] as { id: string; split_code: string }[] }),
          itemIds.length > 0
            ? supabase.from("order_items").select("id, description_snapshot, quantity, unit_price, total, tray_item_type").in("id", itemIds)
            : Promise.resolve({ data: [] as { id: string; description_snapshot: string; quantity: number; unit_price: number; total: number; tray_item_type?: "A" | "B" | "C" | null }[] }),
      ]);

      const ordersMap = Object.fromEntries(orders.map((o) => [o.id, o]));
      const methodsMap = Object.fromEntries(methods.map((m) => [m.id, m.name]));
      const profilesMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || p.username || "Usuario"]));
      const tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, t.name]));
      const splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      const itemsMap = Object.fromEntries((items ?? []).map((i) => [i.id, i]));

      const orderPaidMap: Record<string, number> = {};
      const orderRealTotalMap: Record<string, number> = {};
      for (const payment of allOrderPayments) {
        const meta = parsePaymentNotes(payment.notes);
          if (meta.reversed || meta.voided || meta.transferProofPending) continue;
        orderPaidMap[payment.order_id] = (orderPaidMap[payment.order_id] || 0) + Number(payment.amount);
      }
      for (const item of allOrderItems) {
        orderRealTotalMap[item.order_id] = (orderRealTotalMap[item.order_id] || 0) + Number(item.total);
      }

      const paymentItemsByPayment: Record<string, PaymentItemRow[]> = {};
      for (const paymentItem of selectedPaymentItems ?? []) {
        if (!paymentItemsByPayment[paymentItem.payment_id]) {
          paymentItemsByPayment[paymentItem.payment_id] = [];
        }
        paymentItemsByPayment[paymentItem.payment_id].push({
          id: paymentItem.id,
          payment_id: paymentItem.payment_id,
          order_item_id: paymentItem.order_item_id,
          quantity_paid: Number(paymentItem.quantity_paid),
          unit_price: Number(paymentItem.unit_price),
          total_amount: Number(paymentItem.total_amount),
        });
      }

      const rows: CompletedPayment[] = [];
      for (const payment of payments) {
        const order = ordersMap[payment.order_id];
        if (!order) continue;

        const meta = parsePaymentNotes(payment.notes);
        const orderRealTotal = orderRealTotalMap[payment.order_id] ?? 0;
        const orderTotal = Boolean((order as { is_special?: boolean | null }).is_special) && (order as { special_total_manual?: number | null }).special_total_manual != null
          ? Number((order as { special_total_manual?: number | null }).special_total_manual)
          : orderRealTotal;
        const paidAmount = orderPaidMap[payment.order_id] ?? 0;
        const pendingAmount = Math.max(0, orderTotal - paidAmount);

        let status: CompletedPaymentStatus = "APPLIED";
        if (meta.reversed) {
          status = "REVERSED";
        } else if (meta.voided) {
          status = "VOIDED";
        } else if (pendingAmount > 0) {
          status = "PARTIAL";
        }

        const itemRows = paymentItemsByPayment[payment.id] ?? [];
        if (itemRows.length > 0) {
          for (const paymentItem of itemRows) {
            const item = itemsMap[paymentItem.order_item_id];
            rows.push({
              id: payment.id,
              payment_group_id: parsePaymentNotes(payment.notes).paymentGroupId ?? payment.id,
              created_at: payment.created_at,
              cashier_name: profilesMap[payment.created_by] ?? "Usuario",
              amount: Number(payment.amount),
              method_name: methodsMap[payment.payment_method_id] ?? "Metodo",
              order_id: order.id,
              order_number: order.order_number,
              order_code: order.order_code,
              order_type: order.order_type,
              is_special: Boolean((order as { is_special?: boolean | null }).is_special),
              table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
              split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
              order_total: orderTotal,
              order_paid_amount: paidAmount,
              order_pending_amount: pendingAmount,
              order_status: order.status,
              status,
              notes: payment.notes,
                payment_item_id: paymentItem.id,
                item_id: paymentItem.order_item_id,
                item_description: item?.description_snapshot ?? null,
                item_quantity: item?.quantity ?? null,
                item_paid_quantity: paymentItem.quantity_paid,
                tray_item_type: item?.tray_item_type ?? null,
                item_amount: paymentItem.total_amount,
                reversal_requested: meta.reversalRequested,
              });
          }
        } else {
          const legacyItem = meta.itemId ? itemsMap[meta.itemId] : undefined;
          rows.push({
            id: payment.id,
            payment_group_id: parsePaymentNotes(payment.notes).paymentGroupId ?? payment.id,
            created_at: payment.created_at,
            cashier_name: profilesMap[payment.created_by] ?? "Usuario",
            amount: Number(payment.amount),
            method_name: methodsMap[payment.payment_method_id] ?? "Metodo",
            order_id: order.id,
            order_number: order.order_number,
            order_code: order.order_code,
            order_type: order.order_type,
            is_special: Boolean((order as { is_special?: boolean | null }).is_special),
            table_name: order.table_id ? tablesMap[order.table_id] ?? null : null,
            split_code: order.split_id ? splitsMap[order.split_id] ?? null : null,
            order_total: orderTotal,
            order_paid_amount: paidAmount,
            order_pending_amount: pendingAmount,
            order_status: order.status,
            status,
            notes: payment.notes,
            payment_item_id: null,
              item_id: meta.itemId,
              item_description: isSpecialOrderNote(payment.notes) ? "Cobro especial" : legacyItem?.description_snapshot ?? null,
              item_quantity: isSpecialOrderNote(payment.notes) ? null : legacyItem?.quantity ?? null,
              item_paid_quantity: isSpecialOrderNote(payment.notes) ? null : legacyItem?.quantity ?? null,
              tray_item_type: isSpecialOrderNote(payment.notes) ? null : legacyItem?.tray_item_type ?? null,
              item_amount: Number(payment.amount),
              reversal_requested: meta.reversalRequested,
            });
        }
      }

      const summaryMap = new Map<string, { amount: number; paymentCount: number }>();
      for (const payment of summaryPayments) {
        const meta = parsePaymentNotes(payment.notes);
          if (meta.reversed || meta.voided || meta.transferProofPending) continue;
        const current = summaryMap.get(payment.payment_method_id) ?? { amount: 0, paymentCount: 0 };
        current.amount += meta.tenderedAmount ?? Number(payment.amount);
        current.paymentCount += 1;
        summaryMap.set(payment.payment_method_id, current);
      }

      const methodSummary = Array.from(summaryMap.entries())
        .map(([methodId, totals]) => ({
          methodId,
          methodName: methodsMap[methodId] ?? "Metodo",
          amount: roundMoney(totals.amount),
          paymentCount: totals.paymentCount,
        }))
        .sort((a, b) => b.amount - a.amount || a.methodName.localeCompare(b.methodName));

      const collectedTotal = roundMoney(methodSummary.reduce((sum, row) => sum + row.amount, 0));

      return { rows, total: count ?? rows.length, methodSummary, collectedTotal };
    },
    enabled: !!activeBranchId && !!shiftQuery.data?.id,
    refetchInterval: 10000,
  });

  const openCashRegister = useMutation({
    mutationFn: async ({
      counts: denomCounts,
    }: {
      counts: { denomination_id: string; qty: number }[];
    }) => {
      if (!user) throw new Error("No user");
      if (!activeBranchId) throw new Error("No branch selected");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      const normalizedDenomCounts = denomCounts.map((denom) => ({
        denomination_id: denom.denomination_id,
        qty: Math.max(0, Math.trunc(denom.qty || 0)),
      }));

      const { error } = await supabase.rpc("open_cash_register", {
        p_shift_id: shift.id,
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_denoms: normalizedDenomCounts,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["branch-table-settings"] });
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      toast.success("Caja abierta");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const payOrder = useMutation({
    mutationFn: async ({ orderId, itemSelections, paymentSplits, tenderedSplits, isSpecial = false, specialAmount, receivedTotal, totalAmount, cashReceivedDenoms, cashChangeDenoms, preparedTransferProofSession }: PayOrderParams) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (!isSpecial && itemSelections.length === 0) throw new Error("Selecciona al menos un item para cobrar");
      if (paymentSplits.length === 0) throw new Error("Selecciona al menos un metodo de pago");

      const itemIds = itemSelections.map((item) => item.itemId);
      const invalidSelection = itemSelections.find((item) => item.amount <= 0 || item.quantity <= 0 || !Number.isInteger(item.quantity));
      if (!isSpecial && invalidSelection) throw new Error("Todos los items seleccionados deben tener cantidad valida");
      if (isSpecial && (!Number.isFinite(specialAmount) || Number(specialAmount) <= 0)) {
        throw new Error("Ingresa un monto valido para la orden especial");
      }

      const invalidSplit = paymentSplits.find((split) => !split.methodId || Number(split.amount) <= 0);
      if (invalidSplit) throw new Error("Todos los metodos aplicados deben tener un monto valido");

      const invalidTenderedSplit = tenderedSplits.find((split) => !split.methodId || Number(split.amount) <= 0);
      if (invalidTenderedSplit) throw new Error("Todos los metodos recibidos deben tener un monto valido");

      const methodIds = [...new Set([...paymentSplits.map((split) => split.methodId), ...tenderedSplits.map((split) => split.methodId)])];
      const { data: selectedMethods, error: selectedMethodsError } = await supabase
        .from("payment_methods")
        .select("id, name")
        .in("id", methodIds);
      if (selectedMethodsError) throw selectedMethodsError;
      if ((selectedMethods ?? []).length !== methodIds.length) {
        throw new Error("Hay metodos de pago invalidos en la operacion");
      }

      const cashMethods = (selectedMethods ?? []).filter((method) => isCashPaymentMethodName(method.name));
      const transferMethodIds = new Set(
        (selectedMethods ?? [])
          .filter((method) => isTransferPaymentMethodName(method.name))
          .map((method) => method.id),
      );
      if (cashMethods.length > 1) throw new Error("Solo puede existir un pago en efectivo por cobro");
      const cashMethodId = cashMethods[0]?.id ?? null;
      const cashSplit = cashMethodId ? paymentSplits.find((split) => split.methodId === cashMethodId) ?? null : null;
      const cashSplitAmount = roundMoney(cashSplit?.amount ?? 0);
      const effectiveCashReceivedDenoms = cashMethodId ? cashReceivedDenoms : [];
      const effectiveCashChangeDenoms = cashChangeDenoms;

      const appliedTotal = roundMoney(paymentSplits.reduce((sum, split) => sum + Number(split.amount), 0));
      if (Math.abs(appliedTotal - totalAmount) > 0.01) {
        throw new Error("La suma aplicada no coincide con el total del cobro");
      }

      const tenderedTotal = roundMoney(tenderedSplits.reduce((sum, split) => sum + Number(split.amount), 0));
      if (Math.abs(tenderedTotal - receivedTotal) > 0.01) {
        throw new Error("Inconsistencia detectada en el total recibido");
      }
      if (receivedTotal + 0.001 < totalAmount) {
        throw new Error("El total recibido es menor al total del cobro");
      }

      const totalReceivedCash = roundMoney(
        effectiveCashReceivedDenoms.reduce((sum, entry) => {
          const denom = shift.denoms.find((item) => item.denomination_id === entry.denomination_id);
          return sum + (denom ? denom.value * entry.qty : 0);
        }, 0),
      );

      if (cashSplitAmount > 0 && totalReceivedCash + 0.001 < cashSplitAmount) {
        throw new Error("El efectivo recibido es menor al monto aplicado en efectivo");
      }

      const expectedChangeTotal = roundMoney(Math.max(0, receivedTotal - totalAmount));
      const providedChangeTotal = roundMoney(
        effectiveCashChangeDenoms.reduce((sum, entry) => {
          const denom = shift.denoms.find((item) => item.denomination_id === entry.denomination_id);
          return sum + (denom ? denom.value * entry.qty : 0);
        }, 0),
      );
      if (Math.abs(providedChangeTotal - expectedChangeTotal) > 0.01) {
        throw new Error("El detalle del cambio no coincide con el excedente recibido");
      }

      const availableCashByDenom: Record<string, number> = {};
      for (const denom of shift.denoms) {
        availableCashByDenom[denom.denomination_id] = denom.qty_current;
      }
      for (const receivedDenom of effectiveCashReceivedDenoms) {
        availableCashByDenom[receivedDenom.denomination_id] = (availableCashByDenom[receivedDenom.denomination_id] ?? 0) + receivedDenom.qty;
      }
      for (const changeDenom of effectiveCashChangeDenoms) {
        availableCashByDenom[changeDenom.denomination_id] = (availableCashByDenom[changeDenom.denomination_id] ?? 0) - changeDenom.qty;
        if (availableCashByDenom[changeDenom.denomination_id] < 0) {
          throw new Error("No hay suficientes denominaciones en caja para entregar el cambio");
        }
      }

      const { data: orderData, error: orderDataError } = await supabase
          .from("orders")
          .select("order_type, status, is_special, is_tray_order, special_total_manual, table_id")
          .eq("id", orderId)
          .single();
      if (orderDataError) throw orderDataError;

      const orderIsSpecial = Boolean((orderData as { is_special?: boolean | null }).is_special);
      if (orderIsSpecial !== isSpecial) {
        throw new Error("La orden cambio de modalidad antes de registrar el cobro. Recarga e intentalo de nuevo.");
      }

      let dbItems: Array<{
        id: string;
        quantity: number | null;
        unit_price: number | null;
        total: number | null;
        paid_at: string | null;
      }> = [];
      let paidQtyMap: Record<string, number> = {};
      const [
        operationalMaps,
        { data: allOrderItemsData, error: dbItemsError },
        paidRowsData,
        activePaymentsData
      ] = await Promise.all([
        fetchOperationalMapsForOrders([orderId]),
        supabase.from("order_items").select("id, quantity, unit_price, total, paid_at").eq("order_id", orderId),
        !isSpecial ? fetchActivePaymentItemsForOrderItems(itemIds) : Promise.resolve([]),
        isSpecial ? fetchActivePaymentsTotalByOrder([orderId]) : Promise.resolve({})
      ]);

      if (dbItemsError) throw dbItemsError;
      const allDbItems = allOrderItemsData ?? [];

      if (!isSpecial) {
        dbItems = allDbItems.filter(item => itemIds.includes(item.id));
        if (dbItems.length !== itemIds.length) {
          throw new Error("Hay items seleccionados que no pertenecen a la orden");
        }

        paidQtyMap = aggregatePaidQuantityByOrderItem(paidRowsData);
        const dbItemMap = Object.fromEntries(dbItems.map((item) => [item.id, item]));

        for (const itemSelection of itemSelections) {
          const dbItem = dbItemMap[itemSelection.itemId];
          if (!dbItem) throw new Error("Item no encontrado en la orden");

          const quantities = computeOperationalQuantities({
            quantityOrdered: Number(dbItem.quantity ?? 0),
            quantityReadyTotal: operationalMaps.readyMap[itemSelection.itemId] ?? 0,
            quantityDispatchedTotal: operationalMaps.dispatchedTotalMap[itemSelection.itemId] ?? 0,
            quantityCancelledPending: operationalMaps.cancelledPendingMap[itemSelection.itemId] ?? 0,
            quantityCancelledReady: operationalMaps.cancelledReadyMap[itemSelection.itemId] ?? 0,
            quantityCancelledDispatched: operationalMaps.cancelledDispatchedMap[itemSelection.itemId] ?? 0,
          });
          const payableQty = getPayableQuantityForOrderType(orderData.order_type as "DINE_IN" | "TAKEOUT", quantities);
          const alreadyPaidQty = resolvePaidQuantity({
            payableQuantity: payableQty,
            orderedQuantity: Number(dbItem.quantity ?? 0),
            paidQuantityFromPayments: paidQtyMap[itemSelection.itemId] ?? 0,
            paidAt: dbItem.paid_at,
          });
          const pendingPayableQty = Math.max(0, payableQty - alreadyPaidQty);

          if (itemSelection.quantity > pendingPayableQty) {
            throw new Error("No puedes pagar mas cantidad de la despachada pendiente");
          }

          const unitPrice = Number(dbItem.unit_price);
          if (Math.abs(unitPrice - itemSelection.unitPrice) > 0.01) {
            throw new Error("Inconsistencia detectada en el precio unitario del item");
          }

          const expectedAmount = Math.round(itemSelection.quantity * unitPrice * 100) / 100;
          if (Math.abs(expectedAmount - itemSelection.amount) > 0.01) {
            throw new Error("Inconsistencia detectada entre cantidad, precio unitario y total");
          }
        }

        const expectedTotal = Math.round(itemSelections.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
        if (Math.abs(expectedTotal - totalAmount) > 0.01) {
          throw new Error("Inconsistencia detectada en el total del cobro");
        }
      } else {
        const activePaymentsByOrder = activePaymentsData;
        const configuredSpecialTotal = (orderData as { special_total_manual?: number | null }).special_total_manual;
        if (configuredSpecialTotal == null) {
          throw new Error("La orden especial aun no tiene un total manual configurado");
        }

        const specialPendingAmount = roundMoney(Math.max(0, Number(configuredSpecialTotal) - Number(activePaymentsByOrder[orderId] ?? 0)));
        const normalizedSpecialAmount = roundMoney(Number(specialAmount ?? totalAmount));

        if (normalizedSpecialAmount > specialPendingAmount + 0.01) {
          throw new Error("No puedes cobrar mas de lo pendiente en la orden especial");
        }

        if (Math.abs(normalizedSpecialAmount - totalAmount) > 0.01) {
          throw new Error("Inconsistencia detectada en el total del cobro especial");
        }
      }

        const now = new Date().toISOString();
        const paymentGroupId = preparedTransferProofSession?.paymentGroupId ?? generateUUID();
        const tenderedByMethod = Object.fromEntries(tenderedSplits.map((split) => [split.methodId, roundMoney(split.amount)]));
        let anchorPaymentId = null;
        let cashPaymentId: string | null = null;

      const insertCashMovementCompat = async (payload: {
        shift_id: string;
        movement_type: "OPENING" | "PAYMENT_IN" | "CHANGE_OUT";
        qty_delta: number;
        payment_id?: string | null;
        denomination_id?: string | null;
        created_at?: string | null;
      }) => {
        const { error: rpcError } = await supabase.rpc("registrar_movimiento_caja_operativo" as never, {
          p_shift_id: payload.shift_id,
          p_movement_type: payload.movement_type,
          p_qty_delta: payload.qty_delta,
          p_payment_id: payload.payment_id ?? null,
          p_denomination_id: payload.denomination_id ?? null,
          p_created_at: payload.created_at ?? null,
        });

        if (!rpcError) return;

        if (!isMissingRpcSignature(rpcError, "registrar_movimiento_caja_operativo")) {
          throw rpcError;
        }

        try {
          await dbInsert("cash_movements", {
            id: generateUUID(),
            shift_id: payload.shift_id,
            payment_id: payload.payment_id ?? null,
            denomination_id: payload.denomination_id ?? null,
            movement_type: payload.movement_type,
            qty_delta: payload.qty_delta,
            created_at: payload.created_at ?? now,
          });
        } catch (legacyInsertError: any) {
          if (isRowLevelSecurityError(legacyInsertError)) {
            throw new Error(
              "La base de datos aun no esta alineada para registrar movimientos de cobro en caja. Aplica la migracion mas reciente de cash_movements."
            );
          }
          throw legacyInsertError;
        }
      };

        const preparedTransferQueue = [...(preparedTransferProofSession?.paymentIds ?? [])];
        const allPayments = paymentSplits.map((paymentSplit, index) => {
          const reusePreparedPayment = transferMethodIds.has(paymentSplit.methodId) && preparedTransferQueue.length > 0;
          const paymentId = reusePreparedPayment ? preparedTransferQueue.shift()! : generateUUID();
          if (index === 0) anchorPaymentId = paymentId;
          if (cashMethodId && paymentSplit.methodId === cashMethodId) {
            cashPaymentId = paymentId;
          }

          return {
            id: paymentId,
            order_id: orderId,
            payment_method_id: paymentSplit.methodId,
            amount: paymentSplit.amount,
            notes: buildPaymentNote({
              paymentGroupId,
              index,
              tenderedAmount: tenderedByMethod[paymentSplit.methodId] ?? paymentSplit.amount,
              appliedAmount: Number(paymentSplit.amount),
              isSpecial: Boolean(isSpecial),
              transferProofPending: false,
            }),
            created_by: user.id,
            created_at: now,
            reusePreparedPayment,
          };
        });

        await Promise.all(
          allPayments
            .filter((payment) => !payment.reusePreparedPayment)
            .map(({ reusePreparedPayment, ...payment }) => dbInsert("payments", payment))
        );

        await Promise.all(
          allPayments
            .filter((payment) => payment.reusePreparedPayment)
            .map(async (payment) => {
              const { error } = await supabase
                .from("payments")
                .update({
                  amount: payment.amount,
                  notes: payment.notes,
                  created_by: payment.created_by,
                  created_at: payment.created_at,
                })
                .eq("id", payment.id);
              if (error) throw error;
            })
        );

        if (!anchorPaymentId) throw new Error("No se pudo registrar el pago");

      let createdCaptureRequestCount = 0;
      let captureRequestWarning: string | null = null;

        const transferPayments = allPayments.filter((payment) => transferMethodIds.has(payment.payment_method_id));
        if (transferPayments.length > 0 && !preparedTransferProofSession) {
        if (!shift.cashier_id) {
          captureRequestWarning = "El pago por transferencia se registro, pero este turno no tiene usuario de caja configurado.";
        } else if (!activeBranchId) {
          captureRequestWarning = "El pago por transferencia se registro, pero no se pudo asociar la sucursal para la solicitud de foto.";
        } else {
          const captureRequestsToInsert = transferPayments.map((payment) => ({
            id: generateUUID(),
            cash_session_id: shift.id,
            payment_id: payment.id,
            branch_id: activeBranchId,
            requested_by_user_id: user.id,
            assigned_capture_user_id: shift.cashier_id,
            status: "pending",
            secure_token: buildPaymentCaptureToken(),
            token_expires_at: new Date(
              Date.now() + DEFAULT_PAYMENT_CAPTURE_TOKEN_TTL_MINUTES * 60 * 1000,
            ).toISOString(),
            created_at: now,
            updated_at: now,
          }));

          try {
            const { error: captureRequestInsertError } = await (supabase
              .from("payment_capture_requests" as never)
              .insert(captureRequestsToInsert as never) as any);
            if (captureRequestInsertError) throw captureRequestInsertError;
            createdCaptureRequestCount = captureRequestsToInsert.length;
          } catch (captureRequestError: any) {
            console.error("No se pudo crear la solicitud de captura de comprobante", captureRequestError);
            captureRequestWarning = isMissingTableError(captureRequestError, "payment_capture_requests")
              ? "El pago por transferencia se registro, pero la tabla de solicitudes de foto aun no esta disponible en la base de datos."
              : "El pago por transferencia se registro, pero no se pudo generar la solicitud para subir la foto.";
          }
        }
      }

      const denomChanges: Record<string, number> = {};
      const cashMovementsPromises: Promise<void>[] = [];

      if (cashPaymentId) {
        for (const rd of effectiveCashReceivedDenoms) {
          denomChanges[rd.denomination_id] = (denomChanges[rd.denomination_id] || 0) + rd.qty;
          cashMovementsPromises.push(
            insertCashMovementCompat({
              shift_id: shift.id,
              payment_id: cashPaymentId,
              denomination_id: rd.denomination_id,
              movement_type: "PAYMENT_IN",
              qty_delta: rd.qty,
              created_at: now,
            })
          );
        }

        for (const cd of effectiveCashChangeDenoms) {
          denomChanges[cd.denomination_id] = (denomChanges[cd.denomination_id] || 0) - cd.qty;
          cashMovementsPromises.push(
            insertCashMovementCompat({
              shift_id: shift.id,
              denomination_id: cd.denomination_id,
              movement_type: "CHANGE_OUT",
              qty_delta: cd.qty,
              created_at: now,
            })
          );
        }
      } else {
        for (const cd of effectiveCashChangeDenoms) {
          denomChanges[cd.denomination_id] = (denomChanges[cd.denomination_id] || 0) - cd.qty;
          cashMovementsPromises.push(
            insertCashMovementCompat({
              shift_id: shift.id,
              payment_id: anchorPaymentId,
              denomination_id: cd.denomination_id,
              movement_type: "CHANGE_OUT",
              qty_delta: cd.qty,
              created_at: now,
            })
          );
        }
      }

      let paymentStateWarning: string | null = null;

      // MEGA PARALLEL EXECUTION BUNDLE
      const [finalRefreshedShiftDenoms] = await Promise.all([
        Promise.all(cashMovementsPromises).then(async () => {
          const { data: refreshedShiftDenoms, error: refreshedShiftDenomsError } = await supabase
            .from("cash_shift_denoms")
            .select("denomination_id, qty_current")
            .eq("shift_id", shift.id);
          if (refreshedShiftDenomsError) throw refreshedShiftDenomsError;

          const refreshedShiftDenomsMap = Object.fromEntries(
            (refreshedShiftDenoms ?? []).map((row) => [
              row.denomination_id,
              Number(row.qty_current ?? 0),
            ]),
          );

          const refreshMatchesExpected = Object.entries(denomChanges).every(([denomId, delta]) => {
            const currentQty = shift.denoms.find((denom) => denom.denomination_id === denomId)?.qty_current ?? 0;
            return refreshedShiftDenomsMap[denomId] === currentQty + delta;
          });

          if (Object.keys(denomChanges).length > 0 && !refreshMatchesExpected) {
            throw new Error("La caja no pudo actualizar sus denominaciones fisicas.");
          }

          return (refreshedShiftDenoms ?? []).map((row) => ({
            denomination_id: row.denomination_id,
            qty_current: Number(row.qty_current ?? 0),
          }));
        }),
        !isSpecial ? Promise.all(
          itemSelections.map((itemSelection) =>
            dbInsert("payment_items", {
              id: generateUUID(),
              payment_id: anchorPaymentId,
              order_item_id: itemSelection.itemId,
              quantity_paid: itemSelection.quantity,
              unit_price: itemSelection.unitPrice,
              total_amount: itemSelection.amount,
              created_at: now,
            })
          )
        ) : Promise.resolve(),
      ]);

      let syncSummary: Awaited<ReturnType<typeof syncOrderPaymentState>> | null = null;

      try {
        syncSummary = await syncOrderPaymentState(orderId);
      } catch (syncError) {
        console.error("No se pudo sincronizar el estado de pago de la orden", syncError);
        paymentStateWarning =
          syncError instanceof Error && syncError.message
            ? syncError.message
            : "El pago se registro, pero no se pudo cerrar la orden automaticamente.";
      }

      return {
        denomChanges,
        refreshedShiftDenoms: finalRefreshedShiftDenoms,
        createdCaptureRequestCount,
        captureRequestWarning,
        paymentStateWarning,
        orderId,
        orderType: orderData.order_type as "DINE_IN" | "TAKEOUT",
        tableId: (orderData as { table_id?: string | null }).table_id ?? null,
        syncStatus: syncSummary?.status ?? null,
      };
    },
    onSuccess: async (result) => {
      if (
        activeBranchId
        && result?.orderType === "DINE_IN"
        && result?.syncStatus === "PAID"
        && result?.tableId
      ) {
        let patched = false;

        qc.setQueryData(["tables-with-status", activeBranchId], (current: any) => {
          if (!Array.isArray(current)) return current;

          const next = current.map((table: any) => {
            if (table?.id !== result.tableId) return table;
            if (table?.activeOrderId !== result.orderId) return table;
            if (Number(table?.splitCount ?? 0) > 1) return table;

            patched = true;
            return {
              ...table,
              status: "free",
              activeOrderId: undefined,
              orderStatus: undefined,
              splitCount: 0,
              totalDue: 0,
              splitTotals: [],
              itemCount: 0,
              elapsedMinutes: 0,
            };
          });

          return next;
        });

        if (!patched) {
          qc.removeQueries({ queryKey: ["tables-with-status", activeBranchId], exact: true });
        }
      }

      if (activeBranchId && result?.refreshedShiftDenoms) {
        const refreshedQtyMap = Object.fromEntries(
          result.refreshedShiftDenoms.map((row) => [row.denomination_id, row.qty_current]),
        );
        qc.setQueryData(["current-shift", activeBranchId], (current: CashShift | null | undefined) => {
          if (!current) return current;

          return {
            ...current,
            denoms: current.denoms.map((denom) => ({
              ...denom,
              qty_current:
                refreshedQtyMap[denom.denomination_id] ?? Number(denom.qty_current ?? 0),
            })),
          };
        });
      }

      Promise.all([
        qc.invalidateQueries({ queryKey: ["payable-orders"], exact: false }),
        qc.invalidateQueries({ queryKey: ["completed-payments"], exact: false }),
        qc.invalidateQueries({ queryKey: ["current-shift"], exact: false }),
        qc.invalidateQueries({ queryKey: ["dispatch-orders"], exact: false }),
        qc.invalidateQueries({ queryKey: ["kitchen-orders"], exact: false }),
        qc.invalidateQueries({ queryKey: ["orders"], exact: false }),
        qc.invalidateQueries({ queryKey: ["order"], exact: false }),
        qc.invalidateQueries({ queryKey: ["tables-with-status"], exact: false }),
        qc.invalidateQueries({ queryKey: ["pending-payment-capture-requests"], exact: false }),
      ]).catch(console.error);

      const captureRequestCount = result?.createdCaptureRequestCount ?? 0;
      toast.success(
        captureRequestCount > 0
          ? `Pago registrado. Solicitud de foto enviada (${captureRequestCount}).`
          : "Pago registrado",
      );

      if (result?.captureRequestWarning) {
        toast.warning(result.captureRequestWarning);
      }

      if (result?.paymentStateWarning) {
        toast.warning(result.paymentStateWarning);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updatePaymentNotes = async (paymentId: string, marker: string) => {
    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("notes")
      .eq("id", paymentId)
      .single();
    if (paymentError) throw paymentError;

    const nextNotes = appendNoteMarker(payment?.notes ?? null, marker);

    const { error: updateError } = await supabase
      .from("payments")
      .update({ notes: nextNotes })
      .eq("id", paymentId);
    if (updateError) throw updateError;
  };

  const resolvePaymentIds = (paymentId: string, paymentEntryIds?: string[]) => {
    const ids = (paymentEntryIds ?? []).filter(Boolean);
    if (ids.length === 0) return [paymentId];
    return [...new Set(ids)];
  };

  const expandPaymentIdsByGroup = async (paymentIds: string[]) => {
    const uniqueIds = [...new Set(paymentIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const { data: selectedPayments, error: selectedPaymentsError } = await supabase
      .from("payments")
      .select("id, notes")
      .in("id", uniqueIds);
    if (selectedPaymentsError) throw selectedPaymentsError;

    const groupIds = [...new Set((selectedPayments ?? []).map((payment) => parsePaymentNotes(payment.notes).paymentGroupId).filter(Boolean))] as string[];
    if (groupIds.length === 0) return uniqueIds;

    const groupedResults = await Promise.all(
      groupIds.map(async (groupId) => {
        const { data, error } = await supabase
          .from("payments")
          .select("id, notes")
          .ilike("notes", "%GROUP:" + groupId + "%");
        if (error) throw error;
        return (data ?? []).map((row) => row.id);
      }),
    );

    return [...new Set([...uniqueIds, ...groupedResults.flat()])];
  };

  const requestPaymentReversal = useMutation({
    mutationFn: async ({
      paymentId,
      reason,
      paymentEntryIds,
    }: {
      paymentId: string;
      reason: string;
      paymentEntryIds?: string[];
    }) => {
      if (!user) throw new Error("No user");
      if (!reason.trim()) throw new Error("Debes ingresar un motivo");
      const targetIds = await expandPaymentIdsByGroup(resolvePaymentIds(paymentId, paymentEntryIds));
      const marker = buildMarker("REVERSAL_REQUESTED", user.id, reason);

      const { data: payments, error: paymentsError } = await supabase
        .from("payments")
        .select("id, notes")
        .in("id", targetIds);
      if (paymentsError) throw paymentsError;
      if (!payments || payments.length === 0) throw new Error("No se encontraron pagos para solicitar reverso");

      for (const payment of payments) {
        const meta = parsePaymentNotes(payment.notes);
        if (meta.reversed || meta.voided) {
          throw new Error("No puedes solicitar reverso de un pago ya reversado o anulado");
        }
      }

      await Promise.all(payments.map((payment) => updatePaymentNotes(payment.id, marker)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      toast.success("Solicitud de reverso registrada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const reversePayment = useMutation({
    mutationFn: async ({
      paymentId,
      reason,
      paymentEntryIds,
    }: {
      paymentId: string;
      reason: string;
      paymentEntryIds?: string[];
    }) => {
      if (!user) throw new Error("No user");
      if (!reason.trim()) throw new Error("Debes ingresar un motivo");
      const targetIds = await expandPaymentIdsByGroup(resolvePaymentIds(paymentId, paymentEntryIds));

      const { data: payments, error: paymentsError } = await supabase
        .from("payments")
        .select("id, order_id, notes")
        .in("id", targetIds);
      if (paymentsError) throw paymentsError;
      if (!payments || payments.length === 0) throw new Error("No se encontraron pagos para reversar");

      const marker = buildMarker("REVERSED", user.id, reason);
      const affectedOrderIds = new Set<string>();

      for (const payment of payments) {
        const meta = parsePaymentNotes(payment.notes);
        if (meta.reversed || meta.voided) {
          throw new Error("No puedes reversar un pago ya reversado o anulado");
        }
        affectedOrderIds.add(payment.order_id);
      }

      await Promise.all(payments.map((payment) => updatePaymentNotes(payment.id, marker)));

      let syncWarning: string | null = null;

      if (affectedOrderIds.size > 0) {
        try {
          await Promise.all([...affectedOrderIds].map((orderId) => syncOrderPaymentState(orderId)));
        } catch (syncError) {
          console.error("No se pudo sincronizar el estado de pago tras reversar", syncError);
          syncWarning =
            syncError instanceof Error && syncError.message
              ? syncError.message
              : "El reverso se registro, pero no se pudo actualizar el estado de la orden automaticamente.";
        }
      }

      return { syncWarning };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Pago reversado correctamente");
      if (result?.syncWarning) {
        toast.warning(result.syncWarning);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const approvePaymentReversal = useMutation({
    mutationFn: async ({
      paymentId,
      reason,
      approved,
      paymentEntryIds,
    }: {
      paymentId: string;
      reason: string;
      approved: boolean;
      paymentEntryIds?: string[];
    }) => {
      if (!user) throw new Error("No user");
      const prefix = approved ? "REVERSAL_APPROVED" : "REVERSAL_REJECTED";
      const marker = buildMarker(prefix, user.id, reason || "Sin observacion");
      const targetIds = await expandPaymentIdsByGroup(resolvePaymentIds(paymentId, paymentEntryIds));
      await Promise.all(targetIds.map((targetId) => updatePaymentNotes(targetId, marker)));
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      toast.success(vars.approved ? "Solicitud de reverso aprobada" : "Solicitud de reverso rechazada");
    },
    onError: (err: any) => toast.error(err.message),
  });
  const closeCashRegister = useMutation({
    mutationFn: async (notes?: string) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (!activeBranchId) throw new Error("No branch selected");
      if (!user) throw new Error("No user");

      const { error } = await supabase.rpc("close_cash_register", {
        p_shift_id: shift.id,
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_notes: notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      toast.success("Caja cerrada");
    },
  });

  const annulCashOpening = useMutation({
    mutationFn: async ({ reason }: { reason: string }) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      const { error } = await supabase.rpc("anular_apertura_caja" as never, {
        p_turno_id: shift.id,
        p_motivo: reason,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Apertura de caja anulada");
    },
  });

  const registerCashMovement = useMutation({
    mutationFn: async ({
      type,
      amount,
      reason,
      detail,
    }: {
      type: "entrada" | "salida" | "cambio_denominacion";
      amount: number;
      reason: string;
      detail?: CashRegisterMovementDetail | null;
    }) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      const { error } = await supabase.rpc("registrar_movimiento_caja" as never, {
        p_turno_id: shift.id,
        p_tipo: type,
        p_monto: amount,
        p_motivo: reason,
        p_detail: detail ?? null,
      } as never);
      if (!error) return;

      if (!isMissingRpcSignature(error, "registrar_movimiento_caja")) {
        throw error;
      }

      const { error: legacyError } = await supabase.rpc("registrar_movimiento_caja" as never, {
        p_turno_id: shift.id,
        p_tipo: type,
        p_monto: amount,
        p_motivo: reason,
      } as never);
      if (legacyError) throw legacyError;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["cash-register-movements"] });
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      toast.success(
        variables.type === "cambio_denominacion"
          ? "Cambio de denominacion registrado"
          : "Movimiento de caja registrado",
      );
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    denominations: denomsQuery.data ?? [],
    shift: shiftQuery.data,
    isLoadingShift: shiftQuery.isLoading || denomsQuery.isLoading,
    cashRegisterMovements: movementsQuery.data ?? [],
    isLoadingCashRegisterMovements: movementsQuery.isLoading,
    payableOrders: ordersQuery.data ?? [],
    paymentMethods: methodsQuery.data ?? [],
    completedPayments: completedPaymentsQuery.data?.rows ?? [],
    completedPaymentsTotal: completedPaymentsQuery.data?.total ?? 0,
    completedPaymentsMethodSummary: completedPaymentsQuery.data?.methodSummary ?? [],
    completedPaymentsCollectedTotal: completedPaymentsQuery.data?.collectedTotal ?? 0,
    isLoadingCompletedPayments: completedPaymentsQuery.isLoading,
    cashierReverseWindowMinutes: cashierReverseWindowQuery.data ?? DEFAULT_CASHIER_REVERSE_WINDOW_MINUTES,
    branchReferenceTableCount: branchTableSettingsQuery.data?.reference_table_count ?? 0,
    captureCandidates: captureCandidatesQuery.data ?? [],
    isLoadingCaptureCandidates: captureCandidatesQuery.isLoading,
    pendingCaptureRequests: pendingCaptureRequestsQuery.data ?? [],
    isLoadingPendingCaptureRequests: pendingCaptureRequestsQuery.isLoading,
    refetchPendingCaptureRequests: pendingCaptureRequestsQuery.refetch,
    openCaptureRequest,
    prepareTransferProof: prepareTransferProof.mutateAsync,
    discardPreparedTransferProof: discardPreparedTransferProof.mutateAsync,
    getTransferProofReadiness,
    openCashRegister,
    payOrder,
    requestPaymentReversal,
    reversePayment,
    approvePaymentReversal,
    closeCashRegister,
    annulCashOpening,
    registerCashMovement,
  };
}













