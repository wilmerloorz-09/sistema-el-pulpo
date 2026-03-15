import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dbSelect, dbInsert, dbUpdate, supabase } from "@/services/DatabaseService";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { generateUUID } from "@/lib/uuid";
import { dedupePaymentMethods, isCashPaymentMethodName } from "@/lib/paymentMethods";
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
  status: "OPEN" | "CLOSED";
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
  active_tables_count: number;
  denoms: ShiftDenom[];
}

export interface PayableOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  total: number;
  items: {
    id: string;
    description_snapshot: string;
    quantity: number;
    unit_price: number;
    total: number;
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
  receivedTotal: number;
  totalAmount: number;
  cashReceivedDenoms: { denomination_id: string; qty: number }[];
  cashChangeDenoms: { denomination_id: string; qty: number }[];
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
  quantity: number | null;
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
      quantity: null,
    };
  }

  const segments = notes.split("|").map((s) => s.trim());

  let itemId: string | null = null;
  let paymentGroupId: string | null = null;
  let itemsAnchor = false;
  let reversalRequested = false;
  let reversed = false;
  let voided = false;
  let quantity: number | null = null;

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
    if (segment.startsWith("QTY:")) {
      const parsedQty = Number(segment.replace("QTY:", "").trim());
      quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null;
    }
  }

  return { itemId, paymentGroupId, itemsAnchor, reversalRequested, reversed, voided, quantity };
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
        return meta.reversed || meta.voided;
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


type OrderStatus = Database["public"]["Enums"]["order_status"];

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

function deriveOrderOperationalStatus(
  items: Array<{
    quantity: number;
    readyQuantity?: number;
    dispatchedQuantity?: number;
    cancelledPendingQuantity?: number;
    cancelledReadyQuantity?: number;
  }>,
  fallbackStatus: OrderStatus,
): OrderStatus {
  let pendingPrepare = 0;
  let readyAvailable = 0;
  let dispatched = 0;
  let cancelledTotal = 0;
  let activeNotCancelled = 0;

  for (const item of items) {
    const quantities = computeOperationalQuantities({
      quantityOrdered: Number(item.quantity ?? 0),
      quantityReadyTotal: item.readyQuantity ?? 0,
      quantityDispatched: item.dispatchedQuantity ?? 0,
      quantityCancelledPending: item.cancelledPendingQuantity ?? 0,
      quantityCancelledReady: item.cancelledReadyQuantity ?? 0,
    });

    pendingPrepare += quantities.quantityPendingPrepare;
    readyAvailable += quantities.quantityReadyAvailable;
    dispatched += quantities.quantityDispatched;
    cancelledTotal += quantities.quantityCancelledTotal;
    activeNotCancelled += Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
  }

  if (activeNotCancelled <= 0 && cancelledTotal > 0) return "CANCELLED";
  if (pendingPrepare === 0 && readyAvailable === 0 && dispatched > 0) return "KITCHEN_DISPATCHED";
  if (pendingPrepare === 0 && readyAvailable > 0) return "READY";
  if (pendingPrepare > 0) return "SENT_TO_KITCHEN";
  return fallbackStatus;
}

function getPayableQuantityForOrderType(
  orderType: "DINE_IN" | "TAKEOUT",
  quantities: ReturnType<typeof computeOperationalQuantities>,
) {
  if (orderType === "TAKEOUT") {
    return Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
  }

  return quantities.quantityDispatched;
}

export function useCaja(completedPaymentsFilters?: CompletedPaymentsFilters) {
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();

  const denomsQuery = useQuery({
    queryKey: ["denominations", activeBranchId],
    queryFn: () =>
      dbSelect<Denomination>("denominations", {
        select: "id, label, denomination_type, value, display_order, image_url",
        branchId: activeBranchId,
        filters: [{ column: "is_active", op: "eq", value: true }],
        orderBy: { column: "display_order" },
      }),
    enabled: !!activeBranchId,
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

      const { data, error } = await supabase
        .from("cash_shifts")
        .select("id, status, opened_at, closed_at, notes, active_tables_count")
        .eq("branch_id", activeBranchId)
        .eq("status", "OPEN")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const denoms = await dbSelect<any>("cash_shift_denoms", {
        select: "id, denomination_id, qty_initial, qty_current",
        filters: [{ column: "shift_id", op: "eq", value: data.id }],
      });

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

      return { ...data, denoms: enriched } as CashShift;
    },
    enabled: !!activeBranchId && !!denomsQuery.data,
  });

  const ordersQuery = useQuery({
    queryKey: ["payable-orders", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [];

      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_number, order_code, order_type, table_id, split_id, status")
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
        .select("id, order_id, description_snapshot, quantity, unit_price, total, paid_at")
        .in("order_id", orderIds);
      if (itemsError) throw itemsError;

      const orderItemIds = (items ?? []).map((item) => item.id);
      const activePaymentItems = await fetchActivePaymentItemsForOrderItems(orderItemIds);
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
                quantityDispatched: operationalMaps.dispatchedMap[i.id] ?? 0,
                quantityCancelledPending: operationalMaps.cancelledPendingMap[i.id] ?? 0,
                quantityCancelledReady: operationalMaps.cancelledReadyMap[i.id] ?? 0,
              });

              const payableQty = getPayableQuantityForOrderType(o.order_type as "DINE_IN" | "TAKEOUT", quantities);
              const paidQty = resolvePaidQuantity({
                payableQuantity: payableQty,
                orderedQuantity: Number(i.quantity ?? 0),
                paidQuantityFromPayments: paidQtyMap[i.id] ?? 0,
                paidAt: i.paid_at,
              });
              const pendingQty = Math.max(0, payableQty - paidQty);

              return {
                id: i.id,
                description_snapshot: i.description_snapshot,
                quantity: payableQty,
                unit_price: Number(i.unit_price),
                total: computeLineAmount(payableQty, Number(i.unit_price)),
                paid_at: i.paid_at,
                quantity_paid: paidQty,
                quantity_pending: pendingQty,
                pending_total: computeLineAmount(pendingQty, Number(i.unit_price)),
              };
            })
            .filter((item) => item.quantity > 0 || item.quantity_paid > 0 || item.quantity_pending > 0);

          return {
            id: o.id,
            order_number: o.order_number,
            order_code: (o as any).order_code ?? null,
            order_type: o.order_type,
            table_name: o.table_id ? tablesMap[o.table_id] ?? null : null,
            split_code: o.split_id ? splitsMap[o.split_id] ?? null : null,
            total: mappedItems.reduce((sum, item) => sum + Number(item.total), 0),
            items: mappedItems,
          } as PayableOrder;
        })
        .filter((order) => order.items.some((item) => item.quantity_pending > 0));
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
      if (!activeBranchId || !shiftQuery.data?.id) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const fromIso = toIsoFromDateTimeLocal(completedPaymentsFilters?.fromDateTime ?? "");
      const toIso = toIsoFromDateTimeLocal(completedPaymentsFilters?.toDateTime ?? "");

      let movementQuery = supabase
        .from("cash_movements")
        .select("payment_id")
        .eq("shift_id", shiftQuery.data.id)
        .eq("movement_type", "PAYMENT_IN")
        .not("payment_id", "is", null);

      if (fromIso) movementQuery = movementQuery.gte("created_at", fromIso);
      if (toIso) movementQuery = movementQuery.lte("created_at", toIso);

      const { data: paymentMovements, error: movementError } = await movementQuery;
      if (movementError) throw movementError;

      const paymentIds = [...new Set((paymentMovements ?? []).map((m) => m.payment_id).filter(Boolean))] as string[];
      if (paymentIds.length === 0) {
        return { rows: [], total: 0, methodSummary: [], collectedTotal: 0 };
      }

      const buildPaymentsQuery = (withCount = false) => {
        let query = supabase
          .from("payments")
          .select("id, created_at, amount, notes, order_id, payment_method_id, created_by", withCount ? { count: "exact" } : undefined)
          .in("id", paymentIds);

        if (fromIso) query = query.gte("created_at", fromIso);
        if (toIso) query = query.lte("created_at", toIso);

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
          if (meta.reversed || meta.voided) continue;
          const current = summaryMap.get(payment.payment_method_id) ?? { amount: 0, paymentCount: 0 };
          current.amount += Number(payment.amount);
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
          .select("id, order_number, order_code, order_type, table_id, split_id, branch_id, status")
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
          ? supabase.from("order_items").select("id, description_snapshot, quantity, unit_price, total").in("id", itemIds)
          : Promise.resolve({ data: [] as { id: string; description_snapshot: string; quantity: number; unit_price: number; total: number }[] }),
      ]);

      const ordersMap = Object.fromEntries(orders.map((o) => [o.id, o]));
      const methodsMap = Object.fromEntries(methods.map((m) => [m.id, m.name]));
      const profilesMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || p.username || "Usuario"]));
      const tablesMap = Object.fromEntries((tables ?? []).map((t) => [t.id, t.name]));
      const splitsMap = Object.fromEntries((splits ?? []).map((s) => [s.id, s.split_code]));
      const itemsMap = Object.fromEntries((items ?? []).map((i) => [i.id, i]));

      const orderPaidMap: Record<string, number> = {};
      const orderTotalMap: Record<string, number> = {};
      for (const payment of allOrderPayments) {
        const meta = parsePaymentNotes(payment.notes);
        if (meta.reversed || meta.voided) continue;
        orderPaidMap[payment.order_id] = (orderPaidMap[payment.order_id] || 0) + Number(payment.amount);
      }
      for (const item of allOrderItems) {
        orderTotalMap[item.order_id] = (orderTotalMap[item.order_id] || 0) + Number(item.total);
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
        const orderTotal = orderTotalMap[payment.order_id] ?? 0;
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
            item_description: legacyItem?.description_snapshot ?? null,
            item_quantity: legacyItem?.quantity ?? null,
            item_paid_quantity: legacyItem?.quantity ?? null,
            item_amount: Number(payment.amount),
            reversal_requested: meta.reversalRequested,
          });
        }
      }

      const summaryMap = new Map<string, { amount: number; paymentCount: number }>();
      for (const payment of summaryPayments) {
        const meta = parsePaymentNotes(payment.notes);
        if (meta.reversed || meta.voided) continue;
        const current = summaryMap.get(payment.payment_method_id) ?? { amount: 0, paymentCount: 0 };
        current.amount += Number(payment.amount);
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

  const openShift = useMutation({
    mutationFn: async ({ counts: denomCounts, activeTableCount }: { counts: { denomination_id: string; qty: number }[]; activeTableCount: number }) => {
      if (!user) throw new Error("No user");
      if (!activeBranchId) throw new Error("No branch selected");

      const normalizedActiveTableCount = Math.max(0, Math.trunc(activeTableCount || 0));
      const normalizedDenomCounts = denomCounts.map((denom) => ({
        denomination_id: denom.denomination_id,
        qty: Math.max(0, Math.trunc(denom.qty || 0)),
      }));

      const { error } = await supabase.rpc("open_cash_shift_with_tables", {
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_active_tables_count: normalizedActiveTableCount,
        p_denoms: normalizedDenomCounts,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["branch-table-settings"] });
      toast.success("Turno abierto");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const payOrder = useMutation({
    mutationFn: async ({ orderId, itemSelections, paymentSplits, tenderedSplits, receivedTotal, totalAmount, cashReceivedDenoms, cashChangeDenoms }: PayOrderParams) => {
      if (!user) throw new Error("No user");
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (itemSelections.length === 0) throw new Error("Selecciona al menos un item para cobrar");
      if (paymentSplits.length === 0) throw new Error("Selecciona al menos un metodo de pago");

      const itemIds = itemSelections.map((item) => item.itemId);
      const invalidSelection = itemSelections.find((item) => item.amount <= 0 || item.quantity <= 0 || !Number.isInteger(item.quantity));
      if (invalidSelection) throw new Error("Todos los items seleccionados deben tener cantidad valida");

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
      if (cashMethods.length > 1) throw new Error("Solo puede existir un pago en efectivo por cobro");
      const cashMethodId = cashMethods[0]?.id ?? null;
      const cashSplit = cashMethodId ? paymentSplits.find((split) => split.methodId === cashMethodId) ?? null : null;
      const cashSplitAmount = roundMoney(cashSplit?.amount ?? 0);
      const effectiveCashReceivedDenoms = cashMethodId ? cashReceivedDenoms : [];
      const effectiveCashChangeDenoms = cashMethodId ? cashChangeDenoms : [];

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
        .select("order_type, status")
        .eq("id", orderId)
        .single();
      if (orderDataError) throw orderDataError;

      const { data: dbItems, error: dbItemsError } = await supabase
        .from("order_items")
        .select("id, quantity, unit_price, total, paid_at")
        .eq("order_id", orderId)
        .in("id", itemIds);
      if (dbItemsError) throw dbItemsError;
      if ((dbItems ?? []).length !== itemIds.length) {
        throw new Error("Hay items seleccionados que no pertenecen a la orden");
      }

      const paidRows = await fetchActivePaymentItemsForOrderItems(itemIds);
      const paidQtyMap = aggregatePaidQuantityByOrderItem(paidRows);
      const operationalMaps = await fetchOperationalMapsForOrders([orderId]);
      const dbItemMap = Object.fromEntries((dbItems ?? []).map((item) => [item.id, item]));

      for (const itemSelection of itemSelections) {
        const dbItem = dbItemMap[itemSelection.itemId];
        if (!dbItem) throw new Error("Item no encontrado en la orden");

        const quantities = computeOperationalQuantities({
          quantityOrdered: Number(dbItem.quantity ?? 0),
          quantityReadyTotal: operationalMaps.readyMap[itemSelection.itemId] ?? 0,
          quantityDispatched: operationalMaps.dispatchedMap[itemSelection.itemId] ?? 0,
          quantityCancelledPending: operationalMaps.cancelledPendingMap[itemSelection.itemId] ?? 0,
          quantityCancelledReady: operationalMaps.cancelledReadyMap[itemSelection.itemId] ?? 0,
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

      const now = new Date().toISOString();
      const paymentGroupId = generateUUID();
      const tenderedByMethod = Object.fromEntries(tenderedSplits.map((split) => [split.methodId, roundMoney(split.amount)]));
      let anchorPaymentId = null;

      for (const [index, paymentSplit] of paymentSplits.entries()) {
        const paymentId = generateUUID();
        if (index === 0) anchorPaymentId = paymentId;

        await dbInsert("payments", {
          id: paymentId,
          order_id: orderId,
          payment_method_id: paymentSplit.methodId,
          amount: paymentSplit.amount,
          notes: `GROUP:${paymentGroupId}|ITEMS_ANCHOR:${index === 0 ? 1 : 0}|TENDERED:${(tenderedByMethod[paymentSplit.methodId] ?? paymentSplit.amount).toFixed(2)}|APPLIED:${Number(paymentSplit.amount).toFixed(2)}`,
          created_by: user.id,
          created_at: now,
        });

        await dbInsert("cash_movements", {
          id: generateUUID(),
          shift_id: shift.id,
          payment_id: paymentId,
          movement_type: "PAYMENT_IN",
          qty_delta: 1,
          created_at: now,
        });
      }

      if (!anchorPaymentId) throw new Error("No se pudo registrar el pago");

      for (const itemSelection of itemSelections) {
        await dbInsert("payment_items", {
          id: generateUUID(),
          payment_id: anchorPaymentId,
          order_item_id: itemSelection.itemId,
          quantity_paid: itemSelection.quantity,
          unit_price: itemSelection.unitPrice,
          total_amount: itemSelection.amount,
          created_at: now,
        });
      }

      const denomChanges = {};
      for (const rd of effectiveCashReceivedDenoms) {
        denomChanges[rd.denomination_id] = (denomChanges[rd.denomination_id] || 0) + rd.qty;
      }
      for (const cd of effectiveCashChangeDenoms) {
        denomChanges[cd.denomination_id] = (denomChanges[cd.denomination_id] || 0) - cd.qty;
      }
      for (const [denomId, delta] of Object.entries(denomChanges)) {
        if (delta === 0) continue;
        const existing = shift.denoms.find((d) => d.denomination_id === denomId);
        if (existing) {
          await dbUpdate("cash_shift_denoms", existing.id, {
            qty_current: existing.qty_current + delta,
          });
        }
      }

      for (const cd of effectiveCashChangeDenoms) {
        await dbInsert("cash_movements", {
          id: generateUUID(),
          shift_id: shift.id,
          denomination_id: cd.denomination_id,
          movement_type: "CHANGE_OUT",
          qty_delta: cd.qty,
          created_at: now,
        });
      }

      const { data: orderItemsAfter, error: orderItemsAfterError } = await supabase
        .from("order_items")
        .select("id, quantity")
        .eq("order_id", orderId);
      if (orderItemsAfterError) throw orderItemsAfterError;

      const orderItemIdsAfter = (orderItemsAfter ?? []).map((item) => item.id);
      const paidRowsAfter = await fetchActivePaymentItemsForOrderItems(orderItemIdsAfter);
      const paidQtyMapAfter = aggregatePaidQuantityByOrderItem(paidRowsAfter);
      const operationalMapsAfter = await fetchOperationalMapsForOrders([orderId]);

      for (const orderItem of orderItemsAfter ?? []) {
        const quantities = computeOperationalQuantities({
          quantityOrdered: Number(orderItem.quantity ?? 0),
          quantityReadyTotal: operationalMapsAfter.readyMap[orderItem.id] ?? 0,
          quantityDispatched: operationalMapsAfter.dispatchedMap[orderItem.id] ?? 0,
          quantityCancelledPending: operationalMapsAfter.cancelledPendingMap[orderItem.id] ?? 0,
          quantityCancelledReady: operationalMapsAfter.cancelledReadyMap[orderItem.id] ?? 0,
        });
        const activeQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
        const paidQty = paidQtyMapAfter[orderItem.id] ?? 0;
        const isFullyPaid = activeQty <= 0 || paidQty >= activeQty;
        await dbUpdate("order_items", orderItem.id, { paid_at: isFullyPaid ? now : null });
      }

      const allFullyPaid = (orderItemsAfter ?? []).every((orderItem) => {
        const quantities = computeOperationalQuantities({
          quantityOrdered: Number(orderItem.quantity ?? 0),
          quantityReadyTotal: operationalMapsAfter.readyMap[orderItem.id] ?? 0,
          quantityDispatched: operationalMapsAfter.dispatchedMap[orderItem.id] ?? 0,
          quantityCancelledPending: operationalMapsAfter.cancelledPendingMap[orderItem.id] ?? 0,
          quantityCancelledReady: operationalMapsAfter.cancelledReadyMap[orderItem.id] ?? 0,
        });
        const activeQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
        return activeQty <= 0 || (paidQtyMapAfter[orderItem.id] ?? 0) >= activeQty;
      });

      const operationalStatusAfterPayment = deriveOrderOperationalStatus(
        (orderItemsAfter ?? []).map((orderItem) => ({
          quantity: Number(orderItem.quantity ?? 0),
          readyQuantity: operationalMapsAfter.readyMap[orderItem.id] ?? 0,
          dispatchedQuantity: operationalMapsAfter.dispatchedMap[orderItem.id] ?? 0,
          cancelledPendingQuantity: operationalMapsAfter.cancelledPendingMap[orderItem.id] ?? 0,
          cancelledReadyQuantity: operationalMapsAfter.cancelledReadyMap[orderItem.id] ?? 0,
        })),
        (orderData?.status ?? "SENT_TO_KITCHEN") as OrderStatus,
      );

      if (allFullyPaid) {
        if (orderData?.order_type === "TAKEOUT") {
          await dbUpdate("orders", orderId, {
            status: operationalStatusAfterPayment,
            paid_at: now,
          });
        } else {
          await dbUpdate("orders", orderId, {
            status: "PAID",
            paid_at: now,
          });
        }
      } else {
        const nextStatus = orderData?.order_type === "TAKEOUT" ? "KITCHEN_DISPATCHED" : operationalStatusAfterPayment;
        await dbUpdate("orders", orderId, { status: nextStatus, paid_at: null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Pago registrado");
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
        await updatePaymentNotes(payment.id, marker);
      }
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

        await updatePaymentNotes(payment.id, marker);
        affectedOrderIds.add(payment.order_id);
      }

      if (affectedOrderIds.size > 0) {
        const orderIds = [...affectedOrderIds];
        const now = new Date().toISOString();

        const { data: orderItems, error: orderItemsError } = await supabase
          .from("order_items")
          .select("id, order_id, quantity")
          .in("order_id", orderIds);
        if (orderItemsError) throw orderItemsError;

        const orderItemIds = (orderItems ?? []).map((item) => item.id);
        const paidRows = await fetchActivePaymentItemsForOrderItems(orderItemIds);
        const paidQtyMap = aggregatePaidQuantityByOrderItem(paidRows);
        const operationalMaps = await fetchOperationalMapsForOrders(orderIds);

        for (const orderItem of orderItems ?? []) {
          const quantities = computeOperationalQuantities({
            quantityOrdered: Number(orderItem.quantity ?? 0),
            quantityReadyTotal: operationalMaps.readyMap[orderItem.id] ?? 0,
            quantityDispatched: operationalMaps.dispatchedMap[orderItem.id] ?? 0,
            quantityCancelledPending: operationalMaps.cancelledPendingMap[orderItem.id] ?? 0,
            quantityCancelledReady: operationalMaps.cancelledReadyMap[orderItem.id] ?? 0,
          });
          const activeQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
          const isFullyPaid = activeQty <= 0 || (paidQtyMap[orderItem.id] ?? 0) >= activeQty;
          await dbUpdate("order_items", orderItem.id, { paid_at: isFullyPaid ? now : null });
        }

        const itemsByOrder: Record<string, { id: string; quantity: number }[]> = {};
        for (const orderItem of orderItems ?? []) {
          if (!itemsByOrder[orderItem.order_id]) itemsByOrder[orderItem.order_id] = [];
          itemsByOrder[orderItem.order_id].push({ id: orderItem.id, quantity: Number(orderItem.quantity) });
        }

        const { data: affectedOrders, error: affectedOrdersError } = await supabase
          .from("orders")
          .select("id, order_type, status")
          .in("id", orderIds);
        if (affectedOrdersError) throw affectedOrdersError;

        for (const order of affectedOrders ?? []) {
          const allFullyPaid = (itemsByOrder[order.id] ?? []).every((item) => {
            const quantities = computeOperationalQuantities({
              quantityOrdered: item.quantity,
              quantityReadyTotal: operationalMaps.readyMap[item.id] ?? 0,
              quantityDispatched: operationalMaps.dispatchedMap[item.id] ?? 0,
              quantityCancelledPending: operationalMaps.cancelledPendingMap[item.id] ?? 0,
              quantityCancelledReady: operationalMaps.cancelledReadyMap[item.id] ?? 0,
            });
            const activeQty = Math.max(0, quantities.quantityOrdered - quantities.quantityCancelledTotal);
            return activeQty <= 0 || (paidQtyMap[item.id] ?? 0) >= activeQty;
          });

          const operationalStatus = deriveOrderOperationalStatus(
            (itemsByOrder[order.id] ?? []).map((item) => ({
              quantity: item.quantity,
              readyQuantity: operationalMaps.readyMap[item.id] ?? 0,
              dispatchedQuantity: operationalMaps.dispatchedMap[item.id] ?? 0,
              cancelledPendingQuantity: operationalMaps.cancelledPendingMap[item.id] ?? 0,
              cancelledReadyQuantity: operationalMaps.cancelledReadyMap[item.id] ?? 0,
            })),
            order.status as OrderStatus,
          );

          if (allFullyPaid) {
            if (order.order_type === "TAKEOUT") {
              await dbUpdate("orders", order.id, {
                status: operationalStatus,
                paid_at: now,
              });
            } else {
              await dbUpdate("orders", order.id, {
                status: "PAID",
                paid_at: now,
              });
            }
          } else {
            const nextStatus = order.order_type === "TAKEOUT" ? "KITCHEN_DISPATCHED" : operationalStatus;
            await dbUpdate("orders", order.id, {
              status: nextStatus,
              paid_at: null,
            });
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Pago reversado correctamente");
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
      for (const targetId of targetIds) {
        await updatePaymentNotes(targetId, marker);
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
      toast.success(vars.approved ? "Solicitud de reverso aprobada" : "Solicitud de reverso rechazada");
    },
    onError: (err: any) => toast.error(err.message),
  });
  const closeShift = useMutation({
    mutationFn: async (notes?: string) => {
      const shift = shiftQuery.data;
      if (!shift) throw new Error("No hay turno abierto");
      if (!activeBranchId) throw new Error("No branch selected");

      const { error } = await supabase.rpc("close_cash_shift_with_tables", {
        p_shift_id: shift.id,
        p_branch_id: activeBranchId,
        p_notes: notes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      toast.success("Turno cerrado");
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    denominations: denomsQuery.data ?? [],
    shift: shiftQuery.data,
    isLoadingShift: shiftQuery.isLoading || denomsQuery.isLoading,
    payableOrders: ordersQuery.data ?? [],
    paymentMethods: methodsQuery.data ?? [],
    completedPayments: completedPaymentsQuery.data?.rows ?? [],
    completedPaymentsTotal: completedPaymentsQuery.data?.total ?? 0,
    completedPaymentsMethodSummary: completedPaymentsQuery.data?.methodSummary ?? [],
    completedPaymentsCollectedTotal: completedPaymentsQuery.data?.collectedTotal ?? 0,
    isLoadingCompletedPayments: completedPaymentsQuery.isLoading,
    cashierReverseWindowMinutes: cashierReverseWindowQuery.data ?? DEFAULT_CASHIER_REVERSE_WINDOW_MINUTES,
    branchReferenceTableCount: branchTableSettingsQuery.data?.reference_table_count ?? 0,
    openShift,
    payOrder,
    requestPaymentReversal,
    reversePayment,
    approvePaymentReversal,
    closeShift,
  };
}




































