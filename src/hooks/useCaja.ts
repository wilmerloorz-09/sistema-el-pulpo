import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbInsertMany, dbUpdate, dbDelete, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { generateUUID } from "@/lib/uuid";
import { dedupePaymentMethods, isCashPaymentMethodName, isTransferPaymentMethodName } from "@/lib/paymentMethods";
import { computeLineTotalWithContainer, roundMoney } from "@/lib/paymentQuantity";
import { buildMethodSummaryFromPayments } from "@/lib/paymentSummary";
import { computeOperationalQuantities, fetchOperationalMapsForOrders } from "@/lib/orderOperational";
import type { Database } from "@/integrations/supabase/types";
import { buildUserDisplayMap } from "@/lib/userDisplay";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { getOrderQueryKey } from "@/hooks/useOrder";
import { getOpenCashShiftForBranch, orderBelongsToOpenCashShift } from "@/lib/openCashShift";
import { orderIsPayableInCaja } from "@/lib/orderFlow";
import { cleanOrderCode } from "@/lib/orderPresentation";


export const ensureTableSnapshot = async (orderId: string) => {
  try {
    const orders = await dbSelect("orders", {
      select: "table_id, table_name_snapshot, split_id",
      filters: [{ column: "id", op: "eq", value: orderId }]
    });
    
    const order = orders[0];
    if (!order || order.table_name_snapshot) return; // already snapshotted
    
    let tableName = "Mesa";
    let tableId = order.table_id;
    
    if (!tableId && order.split_id) {
       const splits = await dbSelect("table_splits" as any, {
         select: "table_id",
         filters: [{ column: "id", op: "eq", value: order.split_id }]
       });
       if (splits[0]?.table_id) tableId = splits[0].table_id;
    }
    
    if (tableId) {
       const tables = await dbSelect("restaurant_tables", {
         select: "name, visual_order",
         filters: [{ column: "id", op: "eq", value: tableId }]
       });
       const table = tables[0];
       if (table) {
          const baseName = (table.name || "Mesa").trim();
          const hasNumber = /\d/.test(baseName);
          tableName = hasNumber ? baseName : `${baseName} ${Number(table.visual_order ?? 0) + 1}`;
       }
    }
    
    await dbUpdate("orders", orderId, { table_name_snapshot: tableName });
  } catch (e) {
    console.error("Failed to ensure table snapshot", e);
  }
};

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
  is_stale?: boolean;
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

export interface CashRegisterTemplate {
  id: string;
  name: string;
  is_active: boolean;
  counts: { denomination_id: string; qty: number }[];
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
  table_name: string | null;
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

export async function fetchCashRegisterMovementsForShift(shiftId: string): Promise<CashRegisterMovement[]> {
  const { data, error } = await supabase.rpc("list_cash_register_movements" as any, {
    p_turno_id: shiftId,
  } as any);
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
}

export async function fetchCompletedPaymentsForShift(shiftId: string): Promise<CompletedPayment[]> {
  const { data: orderIdsData, error: orderIdsError } = await supabase
    .from("orders")
    .select("id")
    .eq("cash_shift_id", shiftId);
  
  if (orderIdsError) throw orderIdsError;
  const branchOrderIds = (orderIdsData ?? []).map((o) => o.id);
  
  if (branchOrderIds.length === 0) return [];

  const { data, error } = await supabase
    .from("payments")
    .select(`
      id, 
      created_at, 
      amount, 
      notes, 
      order_id, 
      payment_method_id, 
      created_by,
      payment_methods ( name ),
      orders ( order_code, order_number, table_name_snapshot ),
      profiles:created_by ( full_name )
    `)
    .in("order_id", branchOrderIds)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    created_at: row.created_at,
    amount: Number(row.amount ?? 0),
    notes: row.notes,
    method_name: row.payment_methods?.name || "N/D",
    order_code: cleanOrderCode(row.orders?.order_code),
    order_number: row.orders?.order_number,
    table_name: row.orders?.table_name_snapshot,
    cashier_name: row.profiles?.full_name || "N/D",
    status: row.status || "APPLIED"
  })) as any[];
}

export async function fetchShiftSnapshot(shiftId: string): Promise<CashShiftSnapshot> {
  const { data: shiftData, error: shiftError } = await supabase
    .from("cash_shifts")
    .select("*")
    .eq("id", shiftId)
    .single();
  
  if (shiftError) throw shiftError;

  const { data: denomsData, error: denomsError } = await supabase
    .from("cash_shift_denominations")
    .select(`
      qty_initial,
      qty_current,
      denominations (
        label,
        value,
        display_order,
        denomination_type
      )
    `)
    .eq("shift_id", shiftId);
  
  if (denomsError) throw denomsError;

  const denoms = (denomsData ?? []).map((row: any) => ({
    label: row.denominations?.label || "N/D",
    value: Number(row.denominations?.value ?? 0),
    display_order: Number(row.denominations?.display_order ?? 0),
    denomination_type: row.denominations?.denomination_type,
    qty_initial: Number(row.qty_initial ?? 0),
    qty_current: Number(row.qty_current ?? 0),
  }));

  const { data: openingHistoryData, error: openingHistoryError } = await supabase.rpc("list_cash_register_openings" as any, { 
    p_shift_id: shiftId 
  });

  if (openingHistoryError) throw openingHistoryError;

  const openingHistory = ((openingHistoryData ?? []) as any[]).map((row) => ({
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    status: row.status,
    cashier_name: row.cashier_name,
    cashier_username: row.cashier_username,
    initial_total: Number(row.initial_total ?? 0),
  }));

  return {
    id: shiftData.id,
    opened_at: shiftData.opened_at,
    caja_status: shiftData.caja_status,
    active_tables_count: Number(shiftData.active_tables_count ?? 0),
    denoms,
    openingHistory,
  };
}

import type { Cliente } from "@/types/cliente";

export interface PayableOrderCliente {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
}

export interface PayableOrder {
  id: string;
  order_number: number | null;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT" | "EXPRESS" | "EXTRA";
  is_special: boolean;
  is_tray_order?: boolean;
  locked_for_editing?: boolean;
  created_by: string | null;
  created_by_name: string | null;
  cliente?: PayableOrderCliente | null;
  special_total_manual: number | null;
  special_real_total: number;
  special_paid_amount: number;
  special_pending_amount: number;
  table_name: string | null;
  table_name_snapshot?: string | null;
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

export interface PaymentVoidSelectionInput {
  paymentEntryId: string;
  quantity: number;
}

export interface CashRefundDenomInput {
  denomination_id: string;
  qty: number;
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
  /** Comensal a vincular con la orden al confirmar el cobro. */
  clienteId?: string | null;
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
  cashier_id: string | null;
  cashier_name: string;
  amount: number;
  method_name: string;
  order_id: string;
  order_number: number | null;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  is_special: boolean;
  created_by: string | null;
  created_by_name: string | null;
  table_name: string | null;
  split_code: string | null;
  order_total: number;
  order_paid_amount: number;
  order_pending_amount: number;
  order_status: Database["public"]["Enums"]["order_status"];
  status: CompletedPaymentStatus;
  notes: string | null;
  tendered_amount: number | null;
  payment_item_id: string | null;
  item_id: string | null;
  item_description: string | null;
  item_quantity: number | null;
  item_paid_quantity: number | null;
  tray_item_type?: "A" | "B" | "C" | null;
  item_amount: number;
  order_has_dispatched_items: boolean;
  reversal_requested: boolean;
  order_has_voided_payments: boolean;
  payment_opening_status: "abierta" | "cerrada" | "anulada" | null;
  cash_received_detail: CashMovementDetailLine[];
  cash_change_detail: CashMovementDetailLine[];
  cash_refund_detail: CashMovementDetailLine[];
}

export interface CashMovementDetailLine {
  denomination_id: string;
  label: string;
  value: number;
  qty: number;
  total: number;
  image_url?: string | null;
}

export type CompletedPaymentsScope = "ALL" | "TABLE" | "TAKEOUT" | "SPECIAL";

export interface CompletedPaymentsFilters {
  scope: CompletedPaymentsScope;
  cashierName: string;
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
  cashReceivedDenoms: CashRefundDenomInput[];
  cashChangeDenoms: CashRefundDenomInput[];
};

function encodeDenomDetailForNote(denoms: Array<{ denomination_id: string; qty: number }>) {
  return encodeURIComponent(JSON.stringify(denoms.map((entry) => ({
    denomination_id: entry.denomination_id,
    qty: Math.max(0, Math.floor(Number(entry.qty ?? 0))),
  })).filter((entry) => entry.denomination_id && entry.qty > 0)));
}

function parseDenomDetailFromNote(value: string): CashRefundDenomInput[] {
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        denomination_id: String(entry?.denomination_id ?? ""),
        qty: Math.max(0, Math.floor(Number(entry?.qty ?? 0))),
      }))
      .filter((entry) => entry.denomination_id && entry.qty > 0);
  } catch {
    return [];
  }
}

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
        cashReceivedDenoms: [],
        cashChangeDenoms: [],
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
  let cashReceivedDenoms: CashRefundDenomInput[] = [];
  let cashChangeDenoms: CashRefundDenomInput[] = [];

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
    if (segment.startsWith("CASH_RECEIVED_DENOMS:")) {
      cashReceivedDenoms = parseDenomDetailFromNote(segment.replace("CASH_RECEIVED_DENOMS:", "").trim());
    }
    if (segment.startsWith("CASH_CHANGE_DENOMS:")) {
      cashChangeDenoms = parseDenomDetailFromNote(segment.replace("CASH_CHANGE_DENOMS:", "").trim());
    }
  }

  return { itemId, paymentGroupId, itemsAnchor, reversalRequested, reversed, voided, transferProofPending, quantity, tenderedAmount, cashReceivedDenoms, cashChangeDenoms };
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

type RegisterPaymentRpcRow = {
  id: string;
  order_id: string;
  payment_method_id: string;
  amount: number;
  change_amount: number;
  notes: string;
  created_by: string;
  created_at: string;
};

type RegisterPaymentItemRpcRow = {
  id: string;
  payment_id: string;
  order_item_id: string;
  quantity_paid: number;
  unit_price: number;
  total_amount: number;
};

type CashMovementBatchRpcRow = {
  movement_type: "PAYMENT_IN" | "CHANGE_OUT";
  qty_delta: number;
  payment_id: string;
  denomination_id: string;
  created_at: string;
};

async function registerPaymentWithItemsCompat(
  payments: RegisterPaymentRpcRow[],
  items: RegisterPaymentItemRpcRow[],
) {
  const { error } = await supabase.rpc("register_payment_with_items" as any, {
    p_payments: payments,
    p_items: items,
  });
  if (!error) return;
  if (!isMissingRpcSignature(error, "register_payment_with_items")) throw error;

  for (const payment of payments) {
    await dbInsert(
      "payments",
      {
        id: payment.id,
        order_id: payment.order_id,
        payment_method_id: payment.payment_method_id,
        amount: payment.amount,
        change_amount: payment.change_amount,
        notes: payment.notes,
        created_by: payment.created_by,
        created_at: payment.created_at,
      },
      { hotPath: true },
    );
  }
  await dbInsertMany(
    "payment_items",
    items.map((item) => ({
      id: item.id,
      payment_id: item.payment_id,
      order_item_id: item.order_item_id,
      quantity_paid: item.quantity_paid,
      unit_price: item.unit_price,
      total_amount: item.total_amount,
    })),
    { hotPath: true },
  );
}

async function registerCashMovementsBatchCompat(
  shiftId: string,
  movements: CashMovementBatchRpcRow[],
  fallback: (movement: CashMovementBatchRpcRow) => Promise<void>,
) {
  if (movements.length === 0) return;

  const { error } = await supabase.rpc("registrar_movimientos_caja_operativos_batch" as any, {
    p_shift_id: shiftId,
    p_movements: movements,
  });
  if (!error) return;
  if (!isMissingRpcSignature(error, "registrar_movimientos_caja_operativos_batch")) throw error;

  await Promise.all(movements.map((movement) => fallback(movement)));
}

function isRowLevelSecurityError(error: any) {
  const message = String(error?.message ?? "");
  return message.toLowerCase().includes("row-level security");
}

function buildPosTerminalLabel() {
  if (typeof navigator === "undefined") return "POS no identificado";
  const platform = navigator.platform || "Plataforma desconocida";
  const userAgent = navigator.userAgent || "";

  if (/android|iphone|ipad|ipod|mobile/i.test(userAgent)) {
    return `POS movil - ${platform}`;
  }

  return `POS - ${platform}`;
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
  const { data, error } = await supabase.rpc("sync_order_payment_state" as any, {
    p_order_id: orderId,
  });

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

  if (isMissingRpcSignature(error as any, "sync_order_payment_state")) {
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
  cashReceivedDenoms?: Array<{ denomination_id: string; qty: number }>;
  cashChangeDenoms?: Array<{ denomination_id: string; qty: number }>;
}) {
  return [
    `GROUP:${params.paymentGroupId}`,
    `ITEMS_ANCHOR:${params.index === 0 ? 1 : 0}`,
    `TENDERED:${params.tenderedAmount.toFixed(2)}`,
    `APPLIED:${params.appliedAmount.toFixed(2)}`,
    ...(params.cashReceivedDenoms?.length ? [`CASH_RECEIVED_DENOMS:${encodeDenomDetailForNote(params.cashReceivedDenoms)}`] : []),
    ...(params.cashChangeDenoms?.length ? [`CASH_CHANGE_DENOMS:${encodeDenomDetailForNote(params.cashChangeDenoms)}`] : []),
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

async function fetchActivePaymentItemsForOrderItems(
  orderItemIds: string[],
  readOpts?: { skipLocalCache?: boolean },
): Promise<PaymentItemRow[]> {
  if (orderItemIds.length === 0) return [];

  const paymentItems = await dbSelect<any>("payment_items", {
    select: "id, payment_id, order_item_id, quantity_paid, unit_price, total_amount",
    filters: [{ column: "order_item_id", op: "in", value: orderItemIds }],
    skipLocalCache: readOpts?.skipLocalCache,
  });

  const paymentIdSet = new Set<string>((paymentItems ?? []).map((row) => row.payment_id));
  const paymentIds = Array.from(paymentIdSet);
  if (paymentIds.length === 0) return [];

  const payments = await dbSelect<any>("payments", {
    select: "id, notes, status",
    filters: [{ column: "id", op: "in", value: paymentIds }],
    skipLocalCache: readOpts?.skipLocalCache,
  });

  const blockedPaymentIds = new Set(
    (payments ?? [])
      .filter((payment) => {
        const meta = parsePaymentNotes(payment.notes);
        return meta.reversed || meta.voided || meta.transferProofPending || payment.status === "voided" || payment.status === "reversed";
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

async function fetchActivePaymentsTotalByOrder(
  orderIds: string[],
  readOpts?: { skipLocalCache?: boolean },
): Promise<Record<string, number>> {
  if (orderIds.length === 0) return {};

  const payments = await dbSelect<any>("payments", {
    select: "order_id, amount, notes, status",
    filters: [{ column: "order_id", op: "in", value: orderIds }],
    skipLocalCache: readOpts?.skipLocalCache,
  });

  const totals: Record<string, number> = {};
  for (const payment of payments ?? []) {
    const meta = parsePaymentNotes(payment.notes);
    if (meta.reversed || meta.voided || meta.transferProofPending || payment.status === "voided" || payment.status === "reversed") continue;
    totals[payment.order_id] = roundMoney((totals[payment.order_id] ?? 0) + Number(payment.amount ?? 0));
  }

  return totals;
}

async function fetchAppliedCancelledQuantityByOrderItem(
  orderItemIds: string[],
  readOpts?: { skipLocalCache?: boolean },
): Promise<Record<string, number>> {
  if (orderItemIds.length === 0) return {};

  try {
    const itemCancellations = await dbSelect<any>("order_item_cancellations" as any, {
      select: "order_item_id, quantity_cancelled, order_cancellation_id",
      filters: [{ column: "order_item_id", op: "in", value: orderItemIds }],
      skipLocalCache: readOpts?.skipLocalCache,
    });

    const cancellationIdSet = new Set<string>((itemCancellations ?? []).map((row) => row.order_cancellation_id));
    const cancellationIds = Array.from(cancellationIdSet);
    if (cancellationIds.length === 0) return {};

    const cancellationHeaders = await dbSelect<any>("order_cancellations", {
      select: "id, status",
      filters: [{ column: "id", op: "in", value: cancellationIds }],
      skipLocalCache: readOpts?.skipLocalCache,
    });

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
  allowPaidAtFallback?: boolean;
}) {
  const fallbackPaidQuantity = params.paidQuantityFromPayments > 0
    ? params.paidQuantityFromPayments
    : params.allowPaidAtFallback !== false && params.paidAt
      ? params.orderedQuantity
      : 0;

  return Math.min(params.payableQuantity, fallbackPaidQuantity);
}

function getPayableQuantityForOrderType(
  orderType: "DINE_IN" | "TAKEOUT" | "EXPRESS" | "EXTRA",
  quantities: ReturnType<typeof computeOperationalQuantities>,
  workflowMode: string,
) {
  if (orderType === "EXPRESS") {
    return quantities.quantityDispatchedAvailable;
  }
  if (orderType === "TAKEOUT" || orderType === "EXTRA" || workflowMode === "CASH_THEN_DISPATCH") {
    return Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
  }

  return quantities.quantityDispatchedAvailable;
}

export function useCaja(params?: { 
  completedPaymentsFilters?: CompletedPaymentsFilters;
  autoOpenOrderId?: string | null;
}) {
  const completedPaymentsFilters = params?.completedPaymentsFilters;
  const autoOpenOrderId = params?.autoOpenOrderId;

  const { user } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const { data: shiftGate } = useBranchShiftGate();
  const qc = useQueryClient();
  const activeWorkflowMode = "CASH_THEN_DISPATCH";

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

      const branches = await dbSelect<any>("branches", {
        select: "reference_table_count",
        filters: [{ column: "id", op: "eq", value: activeBranchId }]
      });
      
      const branch = branches[0];
      return {
        reference_table_count: Number(branch?.reference_table_count ?? 0),
      };
    },
    enabled: !!activeBranchId,
  });

  const shiftQuery = useQuery({
    queryKey: ["current-shift", activeBranchId, user?.id ?? null],
    queryFn: async () => {
      if (!activeBranchId || !user?.id) return null;

      const shifts = await dbSelect<any>("cash_shifts", {
        select: "id, branch_id, status, caja_status, cashier_id, capture_user_id, capture_device_label, opened_at, closed_at, notes, active_tables_count",
        branchId: activeBranchId,
        filters: [{ column: "status", op: "eq", value: "OPEN" }],
        orderBy: { column: "opened_at", ascending: false }
      });
      
      const shiftData = shifts[0];
      if (!shiftData) return null;

      const denoms = await dbSelect<any>("cash_shift_denoms", {
        select: "id, denomination_id, qty_initial, qty_current",
        filters: [
          { column: "shift_id", op: "eq", value: shiftData.id },
          { column: "cashier_id", op: "eq", value: user.id },
        ],
      });

      const allDenoms = denomsQuery.data ?? [];
      const enriched: ShiftDenom[] = (denoms ?? []).map((d: any) => {
        const denom = allDenoms.find((ad) => ad.id === d.denomination_id);
        if (!denom) {
          console.warn(`Denomination ${d.denomination_id} not found in global list for shift ${shiftData.id}`);
        }
        return {
          ...d,
          label: denom?.label ?? d.label ?? `Valor $${(d.value ?? 0).toFixed(2)}`,
          denomination_type: denom?.denomination_type ?? d.denomination_type ?? "coin",
          display_order: denom?.display_order ?? d.display_order ?? 999,
          value: denom?.value ?? d.value ?? 0,
          image_url: denom?.image_url ?? d.image_url ?? null,
        };
      });

      const { data: openingHistoryData } = await supabase.rpc("list_cash_register_openings" as any, { 
        p_shift_id: shiftData.id 
      });

      const openingHistory = ((openingHistoryData ?? []) as any[])
        .filter((row) => row.cashier_id === user.id)
        .map((row) => ({
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

      const openedDate = new Date(shiftData.opened_at);
      const today = new Date();
      const isStale = openedDate.getFullYear() !== today.getFullYear() ||
                     openedDate.getMonth() !== today.getMonth() ||
                     openedDate.getDate() !== today.getDate();

      return {
        ...shiftData,
        capture_user_id: shiftData.capture_user_id ?? null,
        capture_device_label: shiftData.capture_device_label ?? null,
        denoms: enriched,
        openingHistory,
        is_stale: isStale,
      } as CashShift;
    },
    enabled: !!activeBranchId && !!user?.id && !!denomsQuery.data,
  });

  const enabledShiftUsersQuery = useQuery({
    queryKey: ["shift-enabled-users", shiftQuery.data?.id],
    queryFn: async (): Promise<CashShiftCaptureCandidate[]> => {
      const shift = shiftQuery.data;
      if (!shift?.id) return [];

      const shiftUsers = await dbSelect<any>("cash_shift_users", {
        select: "user_id",
        filters: [
          { column: "shift_id", op: "eq", value: shift.id },
          { column: "is_enabled", op: "eq", value: true },
        ]
      });

      const userIds = Array.from(new Set((shiftUsers ?? []).map((r: any) => r.user_id).filter(Boolean)));
      if (userIds.length === 0) return [];

      const profiles = await dbSelect<any>("profiles", {
        select: "id, first_name, full_name, username, is_active",
        filters: [{ column: "id", op: "in", value: userIds }]
      });

      return (profiles ?? [])
        .filter((p: any) => p.is_active !== false)
        .map((p: any) => ({
          id: p.id,
          full_name: p.first_name ?? p.full_name ?? "Usuario",
          username: p.username ?? "",
        }))
        .sort((a, b) =>
          a.full_name.localeCompare(b.full_name, "es", { sensitivity: "base" })
          || a.username.localeCompare(b.username, "es", { sensitivity: "base" }),
        );
    },
    enabled: !!shiftQuery.data?.id,
  });

  const captureCandidatesQuery = useQuery({
    queryKey: ["cash-shift-capture-candidates", shiftQuery.data?.id],
    queryFn: async (): Promise<CashShiftCaptureCandidate[]> => {
      const shift = shiftQuery.data;
      if (!shift?.id) return [];

      const shiftUsers = await dbSelect<any>("cash_shift_users", {
        select: "user_id",
        filters: [
          { column: "shift_id", op: "eq", value: shift.id },
          { column: "is_enabled", op: "eq", value: true },
          { column: "can_use_caja", op: "eq", value: true }
        ]
      });

      const userIdSet = new Set<string>((shiftUsers ?? []).map((row: any) => row.user_id).filter(Boolean));
      const userIds = Array.from(userIdSet);
      if (userIds.length === 0) return [];

      const profiles = await dbSelect<any>("profiles", {
        select: "id, first_name, full_name, username, is_active",
        filters: [{ column: "id", op: "in", value: userIds }]
      });

      return (profiles ?? [])
        .filter((profile: any) => profile.is_active !== false)
        .map((profile: any) => ({
          id: profile.id,
          full_name: profile.first_name ?? profile.full_name ?? "Usuario",
          username: profile.username ?? "",
        }))
        .sort((a, b) =>
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

      const requests = await dbSelect<any>("payment_capture_requests", {
        select: "id, payment_id, status, secure_token, token_expires_at, created_at",
        filters: [
          { column: "cash_session_id", op: "eq", value: shift.id },
          { column: "assigned_capture_user_id", op: "eq", value: user.id },
          { column: "status", op: "in", value: ["pending", "opened"] }
        ],
        orderBy: { column: "created_at", ascending: true }
      });

      if (requests.length === 0) return [];

      const paymentIdSet = new Set<string>(requests.map((row) => row.payment_id).filter(Boolean));
      const paymentIds = Array.from(paymentIdSet);

      const payments = await dbSelect<any>("payments", {
        select: "id, order_id, payment_method_id, amount",
        filters: [{ column: "id", op: "in", value: paymentIds }]
      });

      const orderIdSet = new Set<string>(payments.map((p) => p.order_id).filter(Boolean));
      const orderIds = Array.from(orderIdSet);
      const methodIdSet = new Set<string>(payments.map((p) => p.payment_method_id).filter(Boolean));
      const methodIds = Array.from(methodIdSet);

      const [orders, methods] = await Promise.all([
        dbSelect<any>("orders", { 
          select: "id, order_number, order_code, table_name_snapshot, table_id", 
          filters: [{ column: "id", op: "in", value: orderIds }] 
        }),
        dbSelect<any>("payment_methods", { 
          filters: [{ column: "id", op: "in", value: methodIds }] 
        })
      ]);

      const tableIdSet = new Set<string>(orders.map((o) => o.table_id).filter(Boolean));
      const tableIds = Array.from(tableIdSet);
      const tables = tableIds.length > 0 
        ? await dbSelect<any>("restaurant_tables", { select: "id, name", filters: [{ column: "id", op: "in", value: tableIds }] })
        : [];

      const paymentsMap = Object.fromEntries(payments.map((p) => [p.id, p]));
      const ordersMap = Object.fromEntries(orders.map((o) => [o.id, o]));
      const methodsMap = Object.fromEntries(methods.map((m) => [m.id, m]));
      const tablesMap = Object.fromEntries(tables.map((t) => [t.id, t]));

      return requests.map((request) => {
        const payment = paymentsMap[request.payment_id];
        const order = payment ? ordersMap[payment.order_id] : null;
        const method = payment ? methodsMap[payment.payment_method_id] : null;
        const table = order ? tablesMap[order.table_id] : null;

        return {
          ...request,
          amount: Number(payment?.amount ?? 0),
          order_id: payment?.order_id ?? "",
          order_number: order?.order_number ?? null,
          order_code: cleanOrderCode(order?.order_code) ?? null,
          table_name: table?.name || order?.table_name_snapshot || null,
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
        .from("payment_capture_requests" as any)
        .update({
          status: "opened",
          opened_at: now,
          updated_at: now,
        } as any)
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

      const selectedMethods = await dbSelect<any>("payment_methods", {
        select: "id, name",
        filters: [{ column: "id", op: "in", value: paymentSplits.map((split) => split.methodId) }]
      });

      const transferMethodIds = new Set(
        (selectedMethods ?? [])
          .filter((method) => isTransferPaymentMethodName(method.name))
          .map((method) => method.id),
      );

      const transferSplits = paymentSplits.filter((split) => transferMethodIds.has(split.methodId));
      if (transferSplits.length === 0) {
        throw new Error("No hay pagos por transferencia para preparar.");
      }

      const existingRequests = await dbSelect<any>("payment_capture_requests", {
        select: "id",
        filters: [
          { column: "cash_session_id", op: "eq", value: shift.id },
          { column: "status", op: "in", value: ["pending", "opened"] }
        ]
      });

      if (existingRequests && existingRequests.length > 0) {
        throw new Error("Ya existe una solicitud de captura pendiente. Por favor, completa la captura actual antes de iniciar una nueva.");
      }
      if (!shift.cashier_id) {
        throw new Error("Este turno no tiene usuario de caja configurado.");
      }

      const orphanedPayments = await dbSelect<any>("payments", {
        select: "id",
        filters: [
          { column: "created_by", op: "eq", value: user.id },
          { column: "notes", op: "is" as any, value: "not.null" } 
        ]
      });
      
      const realOrphaned = (orphanedPayments ?? []).filter(p => String(p.notes || "").includes("TRANSFER_PROOF_PENDING:1"));

      if (realOrphaned.length > 0) {
        const orphanedPaymentIds = realOrphaned.map((p) => p.id);
        
        for (const pid of orphanedPaymentIds) {
          const relatedRequests = await dbSelect<any>("payment_capture_requests", {
            filters: [{ column: "payment_id", op: "eq", value: pid }]
          });
          for (const req of relatedRequests) {
            await dbDelete("payment_capture_requests", req.id);
          }
          await dbDelete("payments", pid);
        }
      }

      const now = new Date().toISOString();
      const paymentGroupId = generateUUID();
      const tenderedByMethod = Object.fromEntries(tenderedSplits.map((split) => [split.methodId, roundMoney(split.amount)]));

      const paymentsToInsert = transferSplits.map((paymentSplit, index) => ({
        id: generateUUID(),
        order_id: orderId,
        payment_method_id: paymentSplit.methodId,
        amount: paymentSplit.amount,
        change_amount: Math.max(0, Number(tenderedByMethod[paymentSplit.methodId] ?? paymentSplit.amount) - Number(paymentSplit.amount)),
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

      for (const p of paymentsToInsert) {
        await dbInsert("payments", p);
      }

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
        for (const req of captureRequestsToInsert) {
          await dbInsert("payment_capture_requests", req);
        }
      } catch (error) {
        for (const p of paymentsToInsert) {
          await dbDelete("payments", p.id);
        }
        throw error;
      }

      return {
        paymentGroupId,
        paymentIds: paymentsToInsert.map((payment) => payment.id),
        captureRequestIds: captureRequestsToInsert.map((request) => request.id),
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-payment-capture-requests"], exact: false });
      toast.success("Solicitud de foto enviada para el pago por transferencia.");
    },
    onError: (err: any) => toast.error(err.message ?? "No se pudo solicitar la foto de transferencia"),
  });

  const discardPreparedTransferProof = useMutation({
    mutationFn: async (session: PreparedTransferProofSession) => {
      if (session.captureRequestIds.length > 0) {
        for (const rid of session.captureRequestIds) {
          await dbDelete("payment_capture_requests", rid);
        }
      }

      if (session.paymentIds.length > 0) {
        for (const pid of session.paymentIds) {
          await dbDelete("payments", pid);
        }
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
      .from("payment_capture_requests" as any)
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

  const openShiftIdForMovements = shiftQuery.data?.id;
  const movementsQuery = useQuery({
    queryKey: ["cash-register-movements", openShiftIdForMovements],
    queryFn: async ({ queryKey }) => {
      const shiftId = queryKey[1] as string | undefined;
      if (!shiftId) return [];

      return fetchCashRegisterMovementsForShift(shiftId);
    },
    enabled: !!openShiftIdForMovements,
  });

  const ordersQuery = useQuery({
    queryKey: [
      "payable-orders",
      activeBranchId,
      activeWorkflowMode,
      shiftGate?.shiftId ?? "_",
    ],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const openShift = await getOpenCashShiftForBranch(activeBranchId);
      if (!openShift) return [];

      const orders = (
        await dbSelect<any>("orders", {
          select: "id, order_number, order_code, order_type, table_id, split_id, status, is_special, is_tray_order, created_by, created_at, sent_to_kitchen_at, special_total_manual, table_name_snapshot, locked_for_editing, notes, cliente_id",
          branchId: activeBranchId,
          filters: [
            { column: "status", op: "in", value: ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"] },
            { column: "cash_shift_id", op: "eq", value: openShift.id },
          ],
          orderBy: { column: "updated_at", ascending: false },
          skipLocalCache: true,
        })
      ).filter((order) => orderBelongsToOpenCashShift(order, openShift));

      if (!orders || orders.length === 0) return [];

      const activeOrders = orders.filter((order) => !String(order.notes ?? "").includes("VOID_SUCCESSOR_ORDER:"));
      if (activeOrders.length === 0) return [];

      const tableIdSet = new Set<string>(activeOrders.map((o) => o.table_id).filter(Boolean));
      const tableIds = Array.from(tableIdSet);
      let tablesMap: Record<string, { name: string; visual_order: number }> = {};
      if (tableIds.length > 0) {
        const tables = await dbSelect<any>("restaurant_tables", {
          select: "id, name, visual_order",
          filters: [{ column: "id", op: "in", value: tableIds }]
        });
        tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, { name: t.name, visual_order: t.visual_order }]));
      }

      const splitIdSet = new Set<string>(activeOrders.map((o) => o.split_id).filter(Boolean));
      const splitIds = Array.from(splitIdSet);
      let splitsMap: Record<string, string> = {};
      if (splitIds.length > 0) {
        const splits = await dbSelect<any>("table_splits", {
          select: "id, split_code",
          filters: [{ column: "id", op: "in", value: splitIds }]
        });
        splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      }

      const orderIds = activeOrders.map((o) => o.id);
      const creatorIds = Array.from(new Set(activeOrders.map((order) => order.created_by).filter(Boolean))) as string[];
      const creatorProfiles = creatorIds.length > 0
        ? await dbSelect<any>("profiles", {
            select: "id, first_name, full_name, username, email",
            filters: [{ column: "id", op: "in", value: creatorIds }],
          })
        : [];
      const creatorNameMap = buildUserDisplayMap(creatorProfiles);

      const clienteIds = Array.from(
        new Set(activeOrders.map((order) => order.cliente_id).filter(Boolean)),
      ) as string[];
      const clientesRows = clienteIds.length > 0
        ? await dbSelect<PayableOrderCliente>("clientes", {
            select: "id, cedula, nombres, apellidos",
            filters: [{ column: "id", op: "in", value: clienteIds }],
            skipLocalCache: true,
          })
        : [];
      const clientesMap = Object.fromEntries(clientesRows.map((cliente) => [cliente.id, cliente]));

      const items = await dbSelect<any>("order_items", {
        select: "id, order_id, product_id, description_snapshot, quantity, unit_price, total, status, paid_at, tray_item_type, tray_container_cost",
        filters: [{ column: "order_id", op: "in", value: orderIds }]
      });

      const legacyProductIdSet = new Set<string>((items ?? []).map((item) => item.product_id).filter(Boolean));
      const legacyProductIds = Array.from(legacyProductIdSet);
      let menuNodeByLegacyProductId: Record<string, { id: string; image_url: string | null; icon: string | null }> = {};
      if (legacyProductIds.length > 0) {
        const menuNodes = await dbSelect<any>("menu_nodes", {
          select: "id, legacy_product_id, image_url, icon",
          branchId: activeBranchId,
          filters: [
            { column: "is_active", op: "eq", value: true },
            { column: "legacy_product_id", op: "in", value: legacyProductIds }
          ]
        });

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
      const resolveTableName = (tableId: string | null, snapshotName?: string | null): string | null => {
        if (tableId && (tablesMap as any)[tableId]) {
          const t = (tablesMap as any)[tableId];
          const baseName = (t.name || "Mesa").trim();
          const hasNumber = /\d/.test(baseName);
          return hasNumber ? baseName : `${baseName} ${Number(t.visual_order ?? 0) + 1}`;
        }
        return snapshotName || "Mesa";
      };

      const [activePaymentItems, activePaymentsTotalByOrder] = await Promise.all([
        fetchActivePaymentItemsForOrderItems(orderItemIds),
        fetchActivePaymentsTotalByOrder(orderIds),
      ]);
      const paidQtyMap = aggregatePaidQuantityByOrderItem(activePaymentItems);
      const operationalMaps = await fetchOperationalMapsForOrders(orderIds);

      const payableSourceOrders = activeOrders.filter((o) => orderIsPayableInCaja(o));

      return payableSourceOrders
        .map((o) => {
          const orderItems = (items ?? []).filter((i) => i.order_id === o.id && i.status !== "DRAFT");
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
                : getPayableQuantityForOrderType(o.order_type as "DINE_IN" | "TAKEOUT" | "EXPRESS" | "EXTRA", quantities, activeWorkflowMode);
              const paidQty = resolvePaidQuantity({
                payableQuantity: payableQty,
                orderedQuantity: Number(i.quantity ?? 0),
                paidQuantityFromPayments: paidQtyMap[i.id] ?? 0,
                paidAt: i.paid_at,
                allowPaidAtFallback: false,
              });
              const pendingQty = Math.max(0, payableQty - paidQty);
              const unitPrice = Number(i.unit_price ?? 0);
              const trayContainerCost = Number(i.tray_container_cost ?? 0);
              const activeLineTotal = computeLineTotalWithContainer(payableQty, unitPrice, trayContainerCost);
              const pendingLineTotal = computeLineTotalWithContainer(pendingQty, unitPrice, trayContainerCost);

              return {
                id: i.id,
                product_id: i.product_id,
                menu_node_id: menuNodeByLegacyProductId[i.product_id]?.id ?? null,
                image_url: menuNodeByLegacyProductId[i.product_id]?.image_url ?? null,
                icon: menuNodeByLegacyProductId[i.product_id]?.icon ?? null,
                description_snapshot: i.description_snapshot,
                quantity: payableQty,
                unit_price: unitPrice,
                total: activeLineTotal,
                tray_item_type: (i.tray_item_type ?? null) as "A" | "B" | "C" | null,
                tray_container_cost: trayContainerCost,
                paid_at: i.paid_at,
                quantity_paid: paidQty,
                quantity_pending: pendingQty,
                pending_total: pendingLineTotal,
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
            order_code: cleanOrderCode((o as any).order_code) ?? null,
            order_type: o.order_type,
            is_special: isSpecial,
            is_tray_order: isTrayOrder,
            locked_for_editing: Boolean(o.locked_for_editing),
            created_by: o.created_by ?? null,
            created_by_name: o.created_by ? (creatorNameMap[o.created_by] ?? "Usuario") : null,
            cliente: o.cliente_id ? (clientesMap[o.cliente_id] ?? null) : null,
            special_total_manual: specialManualTotal,
            special_real_total: specialRealTotal,
            special_paid_amount: specialPaidAmount,
            special_pending_amount: isSpecial ? specialPendingAmount : roundMoney(mappedItems.reduce((sum, item) => sum + item.pending_total, 0)),
            table_name:
              o.order_type === "DINE_IN" && o.table_id
                ? resolveTableName(o.table_id, (o as any).table_name_snapshot)
                : null,
            table_name_snapshot: (o as any).table_name_snapshot,
            split_code: o.split_id ? splitsMap[o.split_id] : null,
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
        await dbInsert("payment_methods", {
          id: cashMethodId,
          branch_id: activeBranchId,
          name: "Efectivo",
          is_active: true,
        });

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

      const settings = await dbSelect<any>("system_settings" as any, {
        select: "key, value",
        filters: [{ column: "key", op: "in", value: [branchKey, globalKey] }]
      });

      const byKey = new Map((settings ?? []).map((row) => [row.key, row.value]));
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
      completedPaymentsFilters?.scope ?? "ALL",
      completedPaymentsFilters?.cashierName ?? "ALL",
    ],
    queryFn: async (): Promise<CompletedPaymentsResult> => {
      if (!activeBranchId) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStartIso = today.toISOString();
      const shiftOpenedAt = shiftQuery.data?.opened_at ?? null;
      const scope = completedPaymentsFilters?.scope ?? "ALL";

      const effectiveStartIso = shiftOpenedAt ?? todayStartIso;
      const effectiveEndIso = shiftQuery.data?.closed_at
        ? new Date(shiftQuery.data.closed_at).getTime() < Date.now()
          ? shiftQuery.data.closed_at
          : new Date().toISOString()
        : new Date().toISOString();

      const branchOrders = await dbSelect<any>("orders", {
        select: "id, order_type, is_special",
        filters: [{ column: "branch_id", op: "eq", value: activeBranchId }]
      });

      const filteredBranchOrders = (branchOrders ?? []).filter((order) => {
        if (scope === "ALL") return true;
        if (scope === "SPECIAL") return Boolean(order.is_special);
        if (scope === "TABLE") return !order.is_special && order.order_type === "DINE_IN";
        if (scope === "TAKEOUT") return !order.is_special && order.order_type === "TAKEOUT";
        return true;
      });

      const branchOrderIds = filteredBranchOrders.map((order) => order.id);
      if (branchOrderIds.length === 0) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const paymentsFilters: any[] = [
        { column: "order_id", op: "in", value: branchOrderIds },
        { column: "created_at", op: "gte", value: effectiveStartIso },
      ];

      // Solo aplicar límite superior de fecha si el turno ya está cerrado.
      // Si el turno está abierto, no filtramos por fecha de cierre para evitar
      // excluir pagos de reemplazo creados por el trigger del servidor,
      // cuyo created_at puede ser ligeramente posterior al timestamp del cliente.
      if (shiftQuery.data?.closed_at) {
        paymentsFilters.push({ column: "created_at", op: "lte", value: effectiveEndIso });
      }

      const filterCashierId = completedPaymentsFilters?.cashierName ?? "ALL";
      if (filterCashierId !== "ALL") {
        paymentsFilters.push({ column: "created_by", op: "eq", value: filterCashierId });
      }

      const allPaymentsInRange = await dbSelect<any>("payments", {
        select: "id, created_at, amount, notes, order_id, payment_method_id, created_by, status",
        filters: paymentsFilters,
        orderBy: { column: "created_at", ascending: false }
      });

      if (!allPaymentsInRange || allPaymentsInRange.length === 0) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }


      const orderIdSet = new Set<string>(allPaymentsInRange.map((p) => p.order_id));
      const orderIds = Array.from(orderIdSet);
      const methodIdSet = new Set<string>(allPaymentsInRange.map((p) => p.payment_method_id));
      const methodIds = Array.from(methodIdSet);
      const createdByIdSet = new Set<string>(allPaymentsInRange.map((p) => p.created_by));
      const createdByIds = Array.from(createdByIdSet);
      
      const selectedPaymentItems = await dbSelect<any>("payment_items", {
        select: "id, payment_id, order_item_id, quantity_paid, unit_price, total_amount",
        filters: [{ column: "payment_id", op: "in", value: allPaymentsInRange.map((payment) => payment.id) }]
      });

      const itemIdsFromNotes = allPaymentsInRange
        .map((payment) => parsePaymentNotes(payment.notes).itemId)
        .filter((itemId): itemId is string => Boolean(itemId));
      const itemIdsSet = new Set<string>([
        ...itemIdsFromNotes,
        ...(selectedPaymentItems ?? []).map((item) => item.order_item_id),
      ]);
      const itemIds = Array.from(itemIdsSet);

      const [orders, methods, profiles, allOrderPayments, allOrderItems] = await Promise.all([
        dbSelect<any>("orders", {
          select: "id, order_number, order_code, order_type, table_id, split_id, branch_id, status, is_special, special_total_manual, created_by, table_name_snapshot",
          filters: [
            { column: "id", op: "in", value: orderIds },
            { column: "branch_id", op: "eq", value: activeBranchId }
          ]
        }),
        dbSelect<any>("payment_methods", { select: "id, name", filters: [{ column: "id", op: "in", value: methodIds }] }),
        dbSelect<any>("profiles", { select: "id, first_name, full_name, username", filters: [{ column: "id", op: "in", value: createdByIds }] }),
        dbSelect<any>("payments", { select: "order_id, amount, notes, status", filters: [{ column: "order_id", op: "in", value: orderIds }] }),
        dbSelect<any>("order_items", { select: "id, order_id, total, status, description_snapshot, quantity, unit_price, tray_item_type", filters: [{ column: "order_id", op: "in", value: orderIds }] }),
      ]);

      const tableIdSet = new Set<string>(orders.map((o) => o.table_id).filter(Boolean));
      const tableIds = Array.from(tableIdSet);
      const splitIdSet = new Set<string>(orders.map((o) => o.split_id).filter(Boolean));
      const splitIds = Array.from(splitIdSet);

      const [tables, splits] = await Promise.all([
        tableIds.length > 0
          ? dbSelect<any>("restaurant_tables", { select: "id, name, visual_order", filters: [{ column: "id", op: "in", value: tableIds }] })
          : Promise.resolve([]),
        splitIds.length > 0
          ? dbSelect<any>("table_splits", { select: "id, split_code", filters: [{ column: "id", op: "in", value: splitIds }] })
          : Promise.resolve([]),
      ]);

      const ordersMap = Object.fromEntries(orders.map((o) => [o.id, o]));
      const methodsMap = Object.fromEntries(methods.map((m) => [m.id, m.name]));
      const profilesMap = Object.fromEntries(profiles.map((p) => [p.id, p.first_name || p.full_name || p.username || "Usuario"]));
      const orderCreatorIds = Array.from(new Set((orders ?? []).map((order: any) => order.created_by).filter(Boolean))) as string[];
      const orderCreatorProfiles = orderCreatorIds.length > 0
        ? await dbSelect<any>("profiles", {
            select: "id, first_name, full_name, username, email",
            filters: [{ column: "id", op: "in", value: orderCreatorIds }],
          })
        : [];
      const orderCreatorNameMap = buildUserDisplayMap(orderCreatorProfiles);
      const tablesMap = Object.fromEntries((tables ?? []).map((t: any) => [t.id, { name: t.name, visual_order: t.visual_order }]));
      const splitsMap = Object.fromEntries((splits ?? []).map((s: any) => [s.id, s.split_code]));
      const itemsMap = Object.fromEntries(allOrderItems.map((i) => [i.id, i]));
      const orderHasDispatchedMap: Record<string, boolean> = {};

      for (const item of allOrderItems) {
        if (item.status === "KITCHEN_DISPATCHED") {
          orderHasDispatchedMap[item.order_id] = true;
        }
      }

      const allOrderItemIds = allOrderItems.map((item) => item.id).filter(Boolean);
      if (allOrderItemIds.length > 0) {
        const dispatchEvents = await dbSelect<any>("order_item_dispatch_events", {
          select: "order_item_id",
          filters: [
            { column: "order_item_id", op: "in", value: allOrderItemIds },
            { column: "status", op: "eq", value: "APPLIED" },
          ],
        });

        for (const event of dispatchEvents ?? []) {
          const item = itemsMap[event.order_item_id];
          if (item?.order_id) {
            orderHasDispatchedMap[item.order_id] = true;
          }
        }
      }

      const cashMovementRows = await dbSelect<any>("cash_movements", {
        select: "payment_id, denomination_id, movement_type, qty_delta",
        filters: [{ column: "payment_id", op: "in", value: allPaymentsInRange.map((payment) => payment.id) }],
      });
      const voidRequestRows = await dbSelect<any>("payment_void_requests", {
        select: "payment_id, cash_refund_detail, status",
        filters: [
          { column: "payment_id", op: "in", value: allPaymentsInRange.map((payment) => payment.id) },
          { column: "status", op: "eq", value: "executed" },
        ],
      });
      const denominationIds = Array.from(new Set([
        ...(cashMovementRows ?? []).map((row: any) => row.denomination_id).filter(Boolean),
        ...(voidRequestRows ?? []).flatMap((row: any) =>
          Array.isArray(row.cash_refund_detail)
            ? row.cash_refund_detail.map((entry: any) => entry?.denomination_id).filter(Boolean)
            : [],
        ),
      ]));
      const movementDenoms = denominationIds.length > 0
        ? await dbSelect<any>("denominations", {
            select: "id, label, value, image_url",
            filters: [{ column: "id", op: "in", value: denominationIds }],
          })
        : [];
      const movementDenomMap = Object.fromEntries([
        ...((shiftQuery.data?.denoms ?? []).map((denom: any) => [
          denom.denomination_id,
          { id: denom.denomination_id, label: denom.label, value: denom.value, image_url: denom.image_url },
        ])),
        ...((movementDenoms ?? []).map((denom: any) => [denom.id, denom])),
      ]);
      const buildDetailLine = (denominationId: string, qty: number): CashMovementDetailLine | null => {
        const denom = movementDenomMap[denominationId];
        const normalizedQty = Math.max(0, Math.floor(Number(qty ?? 0)));
        const value = Number(denom?.value ?? 0);
        if (!denominationId || normalizedQty <= 0 || value <= 0) return null;
        return {
          denomination_id: denominationId,
          label: denom?.label ?? `$${value.toFixed(2)}`,
          value,
          qty: normalizedQty,
          total: roundMoney(normalizedQty * value),
          image_url: denom?.image_url ?? null,
        };
      };
      const compactDetailLines = (lines: Array<CashMovementDetailLine | null>): CashMovementDetailLine[] => {
        const map = new Map<string, CashMovementDetailLine>();
        for (const line of lines) {
          if (!line) continue;
          const current = map.get(line.denomination_id);
          if (!current) {
            map.set(line.denomination_id, line);
            continue;
          }
          current.qty += line.qty;
          current.total = roundMoney(current.qty * current.value);
        }
        return Array.from(map.values()).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
      };
      const cashChangeDetailByPayment: Record<string, CashMovementDetailLine[]> = {};
      const cashReceivedDetailByPayment: Record<string, CashMovementDetailLine[]> = {};
      for (const row of cashMovementRows ?? []) {
        if (!row.payment_id) continue;
        const line = buildDetailLine(row.denomination_id, row.qty_delta);
        if (!line) continue;
        if (row.movement_type === "CHANGE_OUT") {
          cashChangeDetailByPayment[row.payment_id] = compactDetailLines([...(cashChangeDetailByPayment[row.payment_id] ?? []), line]);
        }
        if (row.movement_type === "PAYMENT_IN") {
          cashReceivedDetailByPayment[row.payment_id] = compactDetailLines([...(cashReceivedDetailByPayment[row.payment_id] ?? []), line]);
        }
      }
      const cashRefundDetailByPayment: Record<string, CashMovementDetailLine[]> = {};
      for (const row of voidRequestRows ?? []) {
        if (!row.payment_id || !Array.isArray(row.cash_refund_detail)) continue;
        cashRefundDetailByPayment[row.payment_id] = compactDetailLines(
          row.cash_refund_detail.map((entry: any) => buildDetailLine(String(entry?.denomination_id ?? ""), Number(entry?.qty ?? 0))),
        );
      }
      for (const payment of allPaymentsInRange) {
        const meta = parsePaymentNotes(payment.notes);
        if ((cashReceivedDetailByPayment[payment.id] ?? []).length === 0 && meta.cashReceivedDenoms.length > 0) {
          cashReceivedDetailByPayment[payment.id] = compactDetailLines(
            meta.cashReceivedDenoms.map((entry) => buildDetailLine(entry.denomination_id, entry.qty)),
          );
        }
        if ((cashChangeDetailByPayment[payment.id] ?? []).length === 0 && meta.cashChangeDenoms.length > 0) {
          cashChangeDetailByPayment[payment.id] = compactDetailLines(
            meta.cashChangeDenoms.map((entry) => buildDetailLine(entry.denomination_id, entry.qty)),
          );
        }
      }

      const resolveTableName = (tableId: string | null, snapshotName?: string | null): string | null => {
        if (tableId && (tablesMap as any)[tableId]) {
          const t = (tablesMap as any)[tableId];
          const baseName = (t.name || "Mesa").trim();
          const hasNumber = /\d/.test(baseName);
          return hasNumber ? baseName : `${baseName} ${Number(t.visual_order ?? 0) + 1}`;
        }
        return snapshotName || "Mesa";
      };
      const orderPaidMap: Record<string, number> = {};
      const orderRealTotalMap: Record<string, number> = {};
      const orderHasVoidedPaymentsMap: Record<string, boolean> = {};
      
      for (const payment of allOrderPayments) {
        const meta = parsePaymentNotes(payment.notes);
        if (meta.voided || meta.reversed || payment.status === "voided" || payment.status === "reversed") {
          orderHasVoidedPaymentsMap[payment.order_id] = true;
        }
        if (meta.reversed || meta.voided || payment.status === "voided" || payment.status === "reversed" || meta.transferProofPending) continue;
        orderPaidMap[payment.order_id] = roundMoney((orderPaidMap[payment.order_id] || 0) + Number(payment.amount));
      }
      for (const item of allOrderItems) {
        if (item.status === "CANCELLED" || item.status === "DRAFT") continue;
        orderRealTotalMap[item.order_id] = roundMoney((orderRealTotalMap[item.order_id] || 0) + Number(item.total));
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
      const openings = [...(shiftQuery.data?.openingHistory ?? [])]
        .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());

      const resolvePaymentOpeningStatus = (createdAt: string): "abierta" | "cerrada" | "anulada" | null => {
        const createdAtMs = new Date(createdAt).getTime();
        const matchedOpening = openings.find((opening) => {
          const openedAtMs = new Date(opening.opened_at).getTime();
          const closedAtMs = opening.closed_at ? new Date(opening.closed_at).getTime() : Number.POSITIVE_INFINITY;
          return openedAtMs <= createdAtMs && createdAtMs <= closedAtMs;
        });
        return matchedOpening?.status ?? null;
      };

      // Mapa rápido de id→payment para resolver reemplazos
      const paymentMapById: Record<string, any> = {};
      for (const p of allPaymentsInRange) {
        paymentMapById[p.id] = p;
      }

      for (const payment of allPaymentsInRange) {
        const order = ordersMap[payment.order_id];
        if (!order) continue;

        const meta = parsePaymentNotes(payment.notes);

        // Si este pago es un reemplazo (REPLACEMENT_FOR_VOID:...), usamos la info
        // del pedido ORIGINAL para mostrarlo con el mismo código/mesa que el pago anulado.
        const replacedPaymentId = String(payment.notes ?? "").match(/^REPLACEMENT_FOR_VOID:([a-f0-9-]+)/i)?.[1] ?? null;
        const originalPayment = replacedPaymentId ? paymentMapById[replacedPaymentId] : null;
        const originalOrder = originalPayment ? ordersMap[originalPayment.order_id] : null;
        // displayOrder: para código/mesa usamos el pedido original; para totales usamos el sucesor
        const displayOrder = originalOrder ?? order;

        const orderRealTotal = orderRealTotalMap[payment.order_id] ?? 0;
        const orderTotal = order.is_special && order.special_total_manual != null
          ? Number(order.special_total_manual)
          : orderRealTotal;
        const paidAmount = orderPaidMap[payment.order_id] ?? 0;
        const pendingAmount = Math.max(0, orderTotal - paidAmount);

        let status: CompletedPaymentStatus = "APPLIED";
        if (meta.reversed || payment.status === "reversed") {
          status = "REVERSED";
        } else if (meta.voided || payment.status === "voided") {
          status = "VOIDED";
        }

        const itemRows = paymentItemsByPayment[payment.id] ?? [];

        if (itemRows.length > 0) {
          for (const paymentItem of itemRows) {
            const item = itemsMap[paymentItem.order_item_id];
            const paymentOpeningStatus = resolvePaymentOpeningStatus(payment.created_at);
            rows.push({
              id: payment.id,
              payment_group_id: parsePaymentNotes(payment.notes).paymentGroupId ?? payment.id,
              created_at: payment.created_at,
              cashier_id: payment.created_by ?? null,
              cashier_name: profilesMap[payment.created_by] ?? "Usuario",
              amount: Number(payment.amount),
              method_name: methodsMap[payment.payment_method_id] ?? "Metodo",
              order_id: displayOrder.id,
              order_number: displayOrder.order_number,
              order_code: cleanOrderCode((displayOrder as any).order_code) ?? null,
              order_type: displayOrder.order_type,
              is_special: Boolean(displayOrder.is_special),
              created_by: (displayOrder as any).created_by ?? null,
              created_by_name: (displayOrder as any).created_by ? (orderCreatorNameMap[(displayOrder as any).created_by] ?? "Usuario") : null,
              table_name:
                displayOrder.order_type === "DINE_IN"
                  ? resolveTableName(displayOrder.table_id, (displayOrder as any).table_name_snapshot)
                  : null,
              split_code: displayOrder.split_id ? splitsMap[displayOrder.split_id] ?? null : null,
              order_total: orderTotal,
              order_paid_amount: paidAmount,
              order_pending_amount: pendingAmount,
              order_status: displayOrder.status,
              status,
              notes: payment.notes,
              tendered_amount: meta.tenderedAmount,
              payment_item_id: paymentItem.id,
              item_id: paymentItem.order_item_id,
              item_description: item?.description_snapshot ?? null,
              item_quantity: item?.quantity ?? null,
              item_paid_quantity: paymentItem.quantity_paid,
              tray_item_type: item?.tray_item_type ?? null,
              item_amount: paymentItem.total_amount,
              reversal_requested: meta.reversalRequested,
              order_has_dispatched_items: Boolean(orderHasDispatchedMap[order.id]),
              order_has_voided_payments: Boolean(orderHasVoidedPaymentsMap[order.id]),
              payment_opening_status: paymentOpeningStatus,
              cash_received_detail: cashReceivedDetailByPayment[payment.id] ?? [],
              cash_change_detail: cashChangeDetailByPayment[payment.id] ?? [],
              cash_refund_detail: cashRefundDetailByPayment[payment.id] ?? [],
            });
          }
        } else {
          const legacyItem = meta.itemId ? itemsMap[meta.itemId] : undefined;
          const paymentOpeningStatus = resolvePaymentOpeningStatus(payment.created_at);
          rows.push({
            id: payment.id,
            payment_group_id: parsePaymentNotes(payment.notes).paymentGroupId ?? payment.id,
            created_at: payment.created_at,
            cashier_id: payment.created_by ?? null,
            cashier_name: profilesMap[payment.created_by] ?? "Usuario",
            amount: Number(payment.amount),
            method_name: methodsMap[payment.payment_method_id] ?? "Metodo",
            order_id: displayOrder.id,
            order_number: displayOrder.order_number,
            order_code: cleanOrderCode((displayOrder as any).order_code) ?? null,
            order_type: displayOrder.order_type,
            is_special: Boolean(displayOrder.is_special),
            created_by: (displayOrder as any).created_by ?? null,
            created_by_name: (displayOrder as any).created_by ? (orderCreatorNameMap[(displayOrder as any).created_by] ?? "Usuario") : null,
            table_name:
              displayOrder.order_type === "DINE_IN"
                ? resolveTableName(displayOrder.table_id, (displayOrder as any).table_name_snapshot)
                : null,
            split_code: displayOrder.split_id ? splitsMap[displayOrder.split_id] ?? null : null,
            order_total: orderTotal,
            order_paid_amount: paidAmount,
            order_pending_amount: pendingAmount,
            order_status: displayOrder.status,
            status,
            notes: payment.notes,
            tendered_amount: meta.tenderedAmount,
            payment_item_id: null,
            item_id: meta.itemId,
            item_description: isSpecialOrderNote(payment.notes) ? "Cobro especial" : legacyItem?.description_snapshot ?? null,
            item_quantity: isSpecialOrderNote(payment.notes) ? null : legacyItem?.quantity ?? null,
            item_paid_quantity: isSpecialOrderNote(payment.notes) ? null : legacyItem?.quantity ?? null,
            tray_item_type: isSpecialOrderNote(payment.notes) ? null : legacyItem?.tray_item_type ?? null,
            item_amount: Number(payment.amount),
            reversal_requested: meta.reversalRequested,
            order_has_dispatched_items: Boolean(orderHasDispatchedMap[payment.order_id]),
            order_has_voided_payments: orderHasVoidedPaymentsMap[payment.order_id] || false,
            payment_opening_status: paymentOpeningStatus,
            cash_received_detail: cashReceivedDetailByPayment[payment.id] ?? [],
            cash_change_detail: cashChangeDetailByPayment[payment.id] ?? [],
            cash_refund_detail: cashRefundDetailByPayment[payment.id] ?? [],
          });
        }
      }
      const methodSummary = buildMethodSummaryFromPayments(allPaymentsInRange, methodsMap);

      const collectedTotal = roundMoney(methodSummary.reduce((sum, row) => sum + row.amount, 0));

      return { rows, total: allPaymentsInRange.length, methodSummary, collectedTotal };
    },
    enabled: !!activeBranchId && !!shiftQuery.data?.id,
    refetchInterval: 10000,
    placeholderData: (prev: any) => prev,
  });

  const cashRegisterTemplatesQuery = useQuery({
    queryKey: ["cash-register-templates", activeBranchId],
    enabled: !!activeBranchId,
    queryFn: async (): Promise<CashRegisterTemplate[]> => {
      if (!activeBranchId) return [];

      const data = await dbSelect<any>("cash_register_templates", {
        select: "id, name, is_active, cash_register_template_denoms(denomination_id, qty)",
        branchId: activeBranchId,
        filters: [
          { column: "is_active", op: "eq", value: true }
        ],
        orderBy: { column: "name", ascending: true }
      });

      return ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        name: row.name,
        is_active: Boolean(row.is_active),
        counts: Array.isArray(row.cash_register_template_denoms)
          ? row.cash_register_template_denoms.map((item: any) => ({
              denomination_id: String(item.denomination_id),
              qty: Math.max(0, Math.trunc(Number(item.qty ?? 0))),
            }))
          : [],
      }));
    },
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

      console.log("RPC Payload:", { p_shift_id: shift.id, p_cashier_id: user.id, p_branch_id: activeBranchId, p_denoms: normalizedDenomCounts });
      const { data, error } = await supabase.rpc("open_cash_register" as any, {
        p_shift_id: shift.id,
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_denoms: normalizedDenomCounts,
      });
      console.log("RPC Result:", { data, error });
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
    mutationFn: async ({ orderId, itemSelections, paymentSplits, tenderedSplits, isSpecial = false, specialAmount, receivedTotal, totalAmount, cashReceivedDenoms, cashChangeDenoms, preparedTransferProofSession, clienteId }: PayOrderParams) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (itemSelections.length === 0) throw new Error("Selecciona al menos un item para cobrar");
      if (paymentSplits.length === 0) throw new Error("Selecciona al menos un metodo de pago");

      const itemIds = itemSelections.map((item) => item.itemId);
      const invalidSelection = itemSelections.find((item) => item.amount <= 0 || item.quantity <= 0 || !Number.isInteger(item.quantity));
      if (invalidSelection) throw new Error("Todos los items seleccionados deben tener cantidad valida");

      const methodIdSet = new Set([...paymentSplits.map((split) => split.methodId), ...tenderedSplits.map((split) => split.methodId)]);
      const methodIds = Array.from(methodIdSet);

      const appliedTotal = roundMoney(paymentSplits.reduce((sum, split) => sum + Number(split.amount), 0));
      if (Math.abs(appliedTotal - totalAmount) > 0.01) {
        throw new Error("La suma aplicada no coincide con el total del cobro");
      }

      const selectionsAmountSum = roundMoney(itemSelections.reduce((sum, item) => sum + Number(item.amount), 0));
      if (Math.abs(selectionsAmountSum - totalAmount) > 0.02) {
        throw new Error("La suma de montos por linea no coincide con el total del cobro");
      }

      const tenderedTotal = roundMoney(tenderedSplits.reduce((sum, split) => sum + Number(split.amount), 0));
      if (Math.abs(tenderedTotal - receivedTotal) > 0.01) {
        throw new Error("Inconsistencia detectada en el total recibido");
      }
      if (receivedTotal + 0.001 < totalAmount) {
        throw new Error("El total recibido es menor al total del cobro");
      }

      const [
        selectedMethods,
        orderData,
        appliedCancelledByItem,
        allDbItems,
        paidRowsData,
        activePaymentsByOrder,
        operationalMaps,
      ] = await Promise.all([
        dbSelect<any>("payment_methods", {
          select: "id, name",
          filters: [{ column: "id", op: "in", value: methodIds }],
          skipLocalCache: true,
        }),
        dbSelect<any>("orders", {
          select: "id, order_type, status, is_special, is_tray_order, special_total_manual, table_id, created_by",
          filters: [{ column: "id", op: "eq", value: orderId }],
          skipLocalCache: true,
        }).then((res) => res[0]),
        fetchAppliedCancelledQuantityByOrderItem(itemIds, { skipLocalCache: true }),
        dbSelect<any>("order_items", {
          select: "id, quantity, unit_price, total, status, paid_at",
          filters: [{ column: "order_id", op: "eq", value: orderId }],
          skipLocalCache: true,
        }),
        fetchActivePaymentItemsForOrderItems(itemIds, { skipLocalCache: true }),
        fetchActivePaymentsTotalByOrder([orderId], { skipLocalCache: true }),
        fetchOperationalMapsForOrders([orderId]),
      ]);

      if (selectedMethods.length !== methodIds.length) {
        throw new Error("Hay metodos de pago invalidos en la operacion");
      }

      const cashMethods = selectedMethods.filter((method) => isCashPaymentMethodName(method.name));
      const transferMethodIds = new Set(
        selectedMethods
          .filter((method) => isTransferPaymentMethodName(method.name))
          .map((method) => method.id),
      );
      if (cashMethods.length > 1) throw new Error("Solo puede existir un pago en efectivo por cobro");
      const cashMethodId = cashMethods[0]?.id ?? null;
      const effectiveCashReceivedDenoms = cashMethodId ? cashReceivedDenoms : [];
      /** Cambio puede existir con solo transferencia (sobrepago); antes se descartaba al no haber tramo efectivo. */
      const effectiveCashChangeDenoms = Array.isArray(cashChangeDenoms) ? cashChangeDenoms : [];

      if (!orderData) throw new Error("Orden no encontrada");
      if (orderData.status === "DRAFT") {
        throw new Error("Una orden borrador no puede cobrarse en caja.");
      }

      const orderIsSpecial = Boolean(orderData.is_special);
      if (Boolean(isSpecial) !== orderIsSpecial) {
        throw new Error("El tipo de cobro no coincide con la orden");
      }

      if (orderIsSpecial && (!Number.isFinite(Number(specialAmount)) || Number(specialAmount) <= 0)) {
        throw new Error("Selecciona lineas validas para cobrar la orden especial");
      }

      const dbItems = allDbItems.filter(item => itemIds.includes(item.id));
      const paidQtyMap = aggregatePaidQuantityByOrderItem(paidRowsData);
      const dbItemMap = Object.fromEntries(dbItems.map((item) => [item.id, item]));

      for (const itemSelection of itemSelections) {
        const dbItem = dbItemMap[itemSelection.itemId];
        if (!dbItem || dbItem.status === "DRAFT") {
          throw new Error("Un item borrador no puede cobrarse en caja.");
        }
        const quantities = computeOperationalQuantities({
          quantityOrdered: Number(dbItem.quantity ?? 0),
          quantityReadyTotal: operationalMaps.readyMap[itemSelection.itemId] ?? 0,
          quantityDispatchedTotal: operationalMaps.dispatchedTotalMap[itemSelection.itemId] ?? 0,
          quantityCancelledPending: operationalMaps.cancelledPendingMap[itemSelection.itemId] ?? appliedCancelledByItem[itemSelection.itemId] ?? 0,
          quantityCancelledReady: operationalMaps.cancelledReadyMap[itemSelection.itemId] ?? 0,
          quantityCancelledDispatched: operationalMaps.cancelledDispatchedMap[itemSelection.itemId] ?? 0,
        });
        const activeOrderedQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
        const payableQty = orderIsSpecial
          ? activeOrderedQty
          : getPayableQuantityForOrderType(
              orderData.order_type as "DINE_IN" | "TAKEOUT" | "EXPRESS",
              quantities,
              activeWorkflowMode,
            );
        const alreadyPaidQty = resolvePaidQuantity({
          payableQuantity: payableQty,
          orderedQuantity: Number(dbItem.quantity ?? 0),
          paidQuantityFromPayments: paidQtyMap[itemSelection.itemId] ?? 0,
          paidAt: dbItem.paid_at,
          allowPaidAtFallback: false,
        });
        const pendingPayableQty = Math.max(0, payableQty - alreadyPaidQty);

        if (itemSelection.quantity > pendingPayableQty) {
          throw new Error(`En el item "${dbItem.id.slice(0, 5)}" quieres cobrar ${itemSelection.quantity} pero solo hay ${pendingPayableQty} pendiente.`);
        }

        if (orderData.order_type === "EXPRESS" && itemSelection.quantity < pendingPayableQty) {
          throw new Error("Las ordenes Express solo admiten cobro total de la orden");
        }

        if (orderData.order_type === "EXTRA" && itemSelection.quantity < pendingPayableQty) {
          throw new Error("Las ordenes Extra solo admiten cobro total de la orden");
        }

        if (Math.abs(Number(dbItem.unit_price) - itemSelection.unitPrice) > 0.01) {
          throw new Error("Inconsistencia detectada en el precio unitario del item");
        }
      }

      if (orderData.order_type === "EXTRA" && !orderIsSpecial) {
        for (const dbItem of allDbItems.filter((item) => item.status !== "DRAFT")) {
          const quantities = computeOperationalQuantities({
            quantityOrdered: Number(dbItem.quantity ?? 0),
            quantityReadyTotal: operationalMaps.readyMap[dbItem.id] ?? 0,
            quantityDispatchedTotal: operationalMaps.dispatchedTotalMap[dbItem.id] ?? 0,
            quantityCancelledPending: operationalMaps.cancelledPendingMap[dbItem.id] ?? appliedCancelledByItem[dbItem.id] ?? 0,
            quantityCancelledReady: operationalMaps.cancelledReadyMap[dbItem.id] ?? 0,
            quantityCancelledDispatched: operationalMaps.cancelledDispatchedMap[dbItem.id] ?? 0,
          });
          const activeOrderedQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
          const payableQty = getPayableQuantityForOrderType(
            "EXTRA",
            quantities,
            activeWorkflowMode,
          );
          const alreadyPaidQty = resolvePaidQuantity({
            payableQuantity: payableQty,
            orderedQuantity: Number(dbItem.quantity ?? 0),
            paidQuantityFromPayments: paidQtyMap[dbItem.id] ?? 0,
            paidAt: dbItem.paid_at,
            allowPaidAtFallback: false,
          });
          const pendingPayableQty = Math.max(0, payableQty - alreadyPaidQty);
          if (pendingPayableQty <= 0) continue;

          const selection = itemSelections.find((item) => item.itemId === dbItem.id);
          if (!selection || selection.quantity !== pendingPayableQty) {
            throw new Error("Las ordenes Extra solo admiten cobro total de la orden");
          }
        }
      }



      if (orderIsSpecial) {
        const configuredSpecialTotal = orderData.special_total_manual;
        if (configuredSpecialTotal == null) {
          throw new Error("La orden especial aun no tiene un total manual configurado");
        }

        const specialPendingAmount = roundMoney(Math.max(0, Number(configuredSpecialTotal) - Number(activePaymentsByOrder[orderId] ?? 0)));
        if (roundMoney(Number(specialAmount ?? totalAmount)) > specialPendingAmount + 0.01) {
          throw new Error("No puedes cobrar mas de lo pendiente en la orden especial");
        }
      }

      const now = new Date().toISOString();
      const shouldMarkSpecialAsPaid =
        orderIsSpecial
        && orderData.special_total_manual != null
        && roundMoney(Number(activePaymentsByOrder[orderId] ?? 0) + appliedTotal) >= roundMoney(Number(orderData.special_total_manual));
      const paymentGroupId = preparedTransferProofSession?.paymentGroupId ?? generateUUID();
      const tenderedByMethod = Object.fromEntries(tenderedSplits.map((split) => [split.methodId, roundMoney(split.amount)]));
      let anchorPaymentId: string | null = null;
      let cashPaymentId: string | null = null;

      const insertCashMovementCompat = async (payload: {
        shift_id: string;
        movement_type: "OPENING" | "PAYMENT_IN" | "CHANGE_OUT";
        qty_delta: number;
        payment_id?: string | null;
        denomination_id?: string | null;
        created_at?: string | null;
      }) => {
        const { error: rpcError } = await supabase.rpc("registrar_movimiento_caja_operativo" as any, {
          p_shift_id: payload.shift_id,
          p_movement_type: payload.movement_type,
          p_qty_delta: payload.qty_delta,
          p_payment_id: payload.payment_id ?? null,
          p_denomination_id: payload.denomination_id ?? null,
          p_created_at: payload.created_at ?? null,
        });

        if (!rpcError) return;
        if (!isMissingRpcSignature(rpcError as any, "registrar_movimiento_caja_operativo")) throw rpcError;

        await dbInsert(
          "cash_movements",
          {
            id: generateUUID(),
            shift_id: payload.shift_id,
            movement_type: payload.movement_type,
            qty_delta: payload.qty_delta,
            payment_id: payload.payment_id ?? null,
            denomination_id: payload.denomination_id ?? null,
            created_at: payload.created_at ?? new Date().toISOString(),
          },
          { hotPath: true },
        );
      };

      if (preparedTransferProofSession) {
        const payments = await dbSelect<any>("payments", {
          select: "id, order_id, payment_method_id, amount, notes",
          filters: [{ column: "id", op: "in", value: preparedTransferProofSession.paymentIds }],
          skipLocalCache: true,
        });
        
        for (const payment of payments) {
          const meta = parsePaymentNotes(payment.notes);
          if (meta.itemsAnchor) anchorPaymentId = payment.id;
          
          const updatedNotes = appendNoteMarker(payment.notes, "TRANSFER_PROOF_PENDING:0");
          await dbUpdate("payments", payment.id, { notes: updatedNotes });

          await dbInsertMany(
            "payment_items",
            itemSelections.map((itemSelection) => ({
              id: generateUUID(),
              payment_id: payment.id,
              order_item_id: itemSelection.itemId,
              quantity_paid: itemSelection.quantity,
              unit_price: itemSelection.unitPrice,
              total_amount: itemSelection.amount,
            })),
            { hotPath: true },
          );
        }

        for (const split of paymentSplits) {
          if (transferMethodIds.has(split.methodId)) continue;
          
          const paymentId = generateUUID();
          const isCash = isCashPaymentMethodName(selectedMethods.find(m => m.id === split.methodId)?.name);
          if (isCash) cashPaymentId = paymentId;

          await dbInsert(
            "payments",
            {
              id: paymentId,
              order_id: orderId,
              payment_method_id: split.methodId,
              amount: split.amount,
              change_amount: Math.max(0, Number(tenderedByMethod[split.methodId] ?? split.amount) - Number(split.amount)),
              notes: buildPaymentNote({
                paymentGroupId,
                index: anchorPaymentId ? 1 : 0,
                tenderedAmount: tenderedByMethod[split.methodId] ?? split.amount,
                appliedAmount: Number(split.amount),
                isSpecial: orderIsSpecial,
                cashReceivedDenoms: isCash ? effectiveCashReceivedDenoms : [],
                cashChangeDenoms: effectiveCashChangeDenoms,
              }),
              created_by: user.id,
              created_at: now,
            },
            { hotPath: true },
          );

          if (!anchorPaymentId) anchorPaymentId = paymentId;

          await dbInsertMany(
            "payment_items",
            itemSelections.map((itemSelection) => ({
              id: generateUUID(),
              payment_id: paymentId,
              order_item_id: itemSelection.itemId,
              quantity_paid: itemSelection.quantity,
              unit_price: itemSelection.unitPrice,
              total_amount: itemSelection.amount,
            })),
            { hotPath: true },
          );
        }
      } else {
        const paymentRows: RegisterPaymentRpcRow[] = [];
        const paymentItemRows: RegisterPaymentItemRpcRow[] = [];

        for (const [index, split] of paymentSplits.entries()) {
          const paymentId = generateUUID();
          const isCash = isCashPaymentMethodName(selectedMethods.find((m) => m.id === split.methodId)?.name);
          if (isCash) cashPaymentId = paymentId;
          if (index === 0) anchorPaymentId = paymentId;

          paymentRows.push({
            id: paymentId,
            order_id: orderId,
            payment_method_id: split.methodId,
            amount: split.amount,
            change_amount: Math.max(0, Number(tenderedByMethod[split.methodId] ?? split.amount) - Number(split.amount)),
            notes: buildPaymentNote({
              paymentGroupId,
              index,
              tenderedAmount: tenderedByMethod[split.methodId] ?? split.amount,
              appliedAmount: Number(split.amount),
              isSpecial: orderIsSpecial,
              cashReceivedDenoms: isCash ? effectiveCashReceivedDenoms : [],
              cashChangeDenoms: effectiveCashChangeDenoms,
            }),
            created_by: user.id,
            created_at: now,
          });

          for (const itemSelection of itemSelections) {
            paymentItemRows.push({
              id: generateUUID(),
              payment_id: paymentId,
              order_item_id: itemSelection.itemId,
              quantity_paid: itemSelection.quantity,
              unit_price: itemSelection.unitPrice,
              total_amount: itemSelection.amount,
            });
          }
        }

        await registerPaymentWithItemsCompat(paymentRows, paymentItemRows);
      }

      const paymentIdForChangeOut = cashPaymentId ?? anchorPaymentId;
      const cashMovementRows: CashMovementBatchRpcRow[] = [];

      if (cashPaymentId && effectiveCashReceivedDenoms.length > 0) {
        for (const denom of effectiveCashReceivedDenoms) {
          cashMovementRows.push({
            movement_type: "PAYMENT_IN",
            qty_delta: denom.qty,
            payment_id: cashPaymentId,
            denomination_id: denom.denomination_id,
            created_at: now,
          });
        }
      }

      if (paymentIdForChangeOut && effectiveCashChangeDenoms.length > 0) {
        for (const denom of effectiveCashChangeDenoms) {
          cashMovementRows.push({
            movement_type: "CHANGE_OUT",
            qty_delta: denom.qty,
            payment_id: paymentIdForChangeOut,
            denomination_id: denom.denomination_id,
            created_at: now,
          });
        }
      }

      await Promise.all([
        registerCashMovementsBatchCompat(shift.id, cashMovementRows, async (movement) => {
          await insertCashMovementCompat({
            shift_id: shift.id,
            movement_type: movement.movement_type,
            qty_delta: movement.qty_delta,
            payment_id: movement.payment_id,
            denomination_id: movement.denomination_id,
            created_at: movement.created_at,
          });
        }),
        shouldMarkSpecialAsPaid
          ? dbUpdate("orders", orderId, { status: "PAID", paid_at: now })
          : Promise.resolve(),
        clienteId
          ? dbUpdate("orders", orderId, { cliente_id: clienteId })
          : Promise.resolve(),
      ]);

      /** No bloquear el cierre del cobro en snapshot de mesa (lecturas/updates en cadena). */
      void ensureTableSnapshot(orderId);
    },
    onSuccess: (_data, variables) => {
      /** Deferir invalidaciones para que la UI pueda cerrar "Cobrando" y pintar el resultado antes de los refetch. */
      queueMicrotask(() => {
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["current-shift"] });
        qc.invalidateQueries({ queryKey: ["payable-orders"] });
        qc.invalidateQueries({ queryKey: ["express-orders"] });
        qc.invalidateQueries({ queryKey: ["extra-orders"] });
        qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
        qc.invalidateQueries({ queryKey: ["completed-payments"] });
        qc.invalidateQueries({ queryKey: ["cash-register-movements"] });
        qc.invalidateQueries({ queryKey: ["tables-with-status"] });
        qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
        qc.invalidateQueries({ queryKey: ["promociones-ordenes-elegibles"] });
        qc.invalidateQueries({ queryKey: getOrderQueryKey(variables.orderId) });
        toast.success("Pago registrado");
      });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const requestPaymentVoid = useMutation({
    mutationFn: async ({ paymentId, orderId, reason, paymentSelections, cashRefundDenoms, refundAmount }: {
      paymentId: string;
      orderId: string;
      reason: string;
      paymentSelections: PaymentVoidSelectionInput[];
      cashRefundDenoms: CashRefundDenomInput[];
      refundAmount: number;
    }) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      // Check for an existing pending request to avoid unique constraint violations
      const { data: existing } = await supabase
        .from("payment_void_requests")
        .select("id")
        .eq("payment_id", paymentId)
        .eq("status", "pending")
        .maybeSingle();

      const requestId = existing?.id || generateUUID();

      const { error } = await supabase.from("payment_void_requests").upsert({
        id: requestId,
        payment_id: paymentId,
        order_id: orderId,
        shift_id: shift.id,
        requested_by_user_id: user.id,
        reason: reason,
        status: "pending",
        refund_amount: refundAmount,
        payment_item_selections: paymentSelections.map((sel) => ({
          payment_item_id: sel.paymentEntryId,
          quantity: sel.quantity,
        })),
        cash_refund_detail: cashRefundDenoms as any,
      });

      if (error) throw error;

      return { requestId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      toast.success("Solicitud de anulacion enviada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const voidPaymentWithSupervisor = useMutation({
    mutationFn: async ({ paymentId, requestId, reason, supervisorIdentifier, supervisorPassword, paymentSelections, cashRefundDenoms }: {
      paymentId: string;
      requestId?: string;
      reason: string;
      supervisorIdentifier: string;
      supervisorPassword: string;
      paymentSelections: PaymentVoidSelectionInput[];
      cashRefundDenoms: CashRefundDenomInput[];
    }) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (!user) throw new Error("No user");

      const { data, error } = await supabase.functions.invoke("void-payment", {
        body: {
          payment_id: paymentId,
          request_id: requestId ?? undefined,
          current_shift_id: shift.id,
          reason: reason,
          supervisor_identifier: supervisorIdentifier,
          supervisor_password: supervisorPassword,
          payment_item_selections: paymentSelections.map((sel) => ({
            payment_item_id: sel.paymentEntryId,
            quantity: sel.quantity,
          })),
          cash_refund_detail: cashRefundDenoms,
        },
      });

      if (error || data?.error) {
        let msg = data?.error || error?.message || "Error al procesar la anulación";
        
        // Try to parse error.context if it's a FunctionsHttpError
        if (error && (error as any).context && typeof (error as any).context.json === 'function') {
          try {
             const contextJson = await (error as any).context.json();
             if (contextJson?.error) msg = contextJson.error;
          } catch(e) {}
        }
        
        throw new Error(msg);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["cash-register-movements"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      toast.success("Pago anulado exitosamente");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const closeCashRegister = useMutation({
    mutationFn: async (notes?: string) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");

      if (!activeBranchId) throw new Error("No branch selected");

      const { error } = await supabase.rpc("close_cash_register" as any, {
        p_shift_id: shift.id,
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_notes: notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      toast.success("Caja cerrada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const annulCashOpening = useMutation({
    mutationFn: async ({ openingId, reason }: { openingId: string; reason: string }) => {
      if (!user) throw new Error("No user");
      const { error } = await supabase.rpc("annul_cash_opening" as any, {
        p_opening_id: openingId,
        p_admin_id: user.id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      toast.success("Apertura anulada");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const registerCashMovement = useMutation({
    mutationFn: async (params: {
      type: "entrada" | "salida" | "cambio_denominacion";
      amount: number;
      reason: string;
      /** Alias usado por `CashRegisterMovementsDialog` / `ShiftSummary`. */
      detail?: CashRegisterMovementDetail | null;
      movement_detail?: CashRegisterMovementDetail | null;
    }) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (!user) throw new Error("No user");

      const movementDetail = params.movement_detail ?? params.detail ?? null;

      const { error } = await supabase.rpc("registrar_movimiento_caja", {
        p_turno_id: shift.id,
        p_tipo: params.type,
        p_monto: params.amount,
        p_motivo: params.reason,
        p_detail: movementDetail as import("@/integrations/supabase/types").Json | null,
      });
      if (error) throw error;
    },
    onSuccess: async (_, variables) => {
      try {
        await Promise.all([
          qc.refetchQueries({ queryKey: ["current-shift", activeBranchId] }),
          qc.refetchQueries({ queryKey: ["cash-register-movements"], exact: false }),
        ]);
      } catch (e) {
        console.warn("[useCaja] Refetch tras movimiento de caja:", e);
      }
      toast.success(variables.type === "cambio_denominacion" ? "Cambio registrado" : "Movimiento registrado");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const takeCajaControl = useMutation({
    mutationFn: async ({ sessionId, shiftId }: { sessionId: string; shiftId?: string }) => {
      const resolvedShiftId = shiftId || shiftQuery.data?.id;
      if (!resolvedShiftId || !user) throw new Error("Faltan datos");

      const { error } = await supabase.rpc("claim_cash_session_slot" as any, {
        p_shift_id: resolvedShiftId,
        p_session_id: sessionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      toast.success("Sesion de Caja activada");
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
    enabledShiftUsers: enabledShiftUsersQuery.data ?? [],
    isLoadingCaptureCandidates: captureCandidatesQuery.isLoading,
    cashRegisterTemplates: cashRegisterTemplatesQuery.data ?? [],
    pendingCaptureRequests: pendingCaptureRequestsQuery.data ?? [],
    isLoadingPendingCaptureRequests: pendingCaptureRequestsQuery.isLoading,
    refetchPendingCaptureRequests: pendingCaptureRequestsQuery.refetch,
    openCaptureRequest,
    prepareTransferProof: prepareTransferProof.mutateAsync,
    discardPreparedTransferProof: discardPreparedTransferProof.mutateAsync,
    getTransferProofReadiness,
    openCashRegister,
    payOrder,
    requestPaymentVoid,
    voidPaymentWithSupervisor,
    closeCashRegister,
    annulCashOpening,
    registerCashMovement,
    takeCajaControl: takeCajaControl.mutateAsync,
  };
}
