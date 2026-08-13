import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DenominationVisual from "@/components/caja/DenominationVisual";
import PaymentReversalModal, { type ReversalPaymentData } from "@/components/caja/PaymentReversalModal";
import SupervisorAuthorizationDialog from "@/components/caja/SupervisorAuthorizationDialog";
import PaymentStatusBadge from "@/components/caja/PaymentStatusBadge";
import PaymentMethodIcons from "@/components/caja/PaymentMethodIcons";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildPromocionReciboExtras } from "@/lib/promocionesRecibo";
import type {
  CashRefundDenomInput,
  CashShiftCaptureCandidate,
  CompletedPayment,
  CompletedPaymentsFilters,
  CompletedPaymentsScope,
  PaymentRefundMethod,
  PaymentVoidSelectionInput,
  ShiftDenom,
} from "@/hooks/useCaja";
import { getUserDisplayName } from "@/lib/userDisplay";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { roundMoney } from "@/lib/paymentQuantity";
import { canManage, canOperate, type PermissionMap } from "@/lib/permissions";
import { printPaymentReceipt } from "@/lib/thermalPrint";
import type { PaymentReceiptData } from "@/lib/paymentReceiptData";
import PaymentReceipt from "@/components/caja/PaymentReceipt";
import { ChevronDown, ChevronUp, Clock3, CreditCard, Landmark, Loader2, ReceiptText, RotateCcw, ShoppingBag, UserRound, UtensilsCrossed, Printer, ScanSearch, Undo2 } from "lucide-react";
import { isTransferPaymentMethodName } from "@/lib/paymentMethods";
import { cn } from "@/lib/utils";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

interface PaymentGroup {
  paymentId: string;
  /** Cobro completo (transferencia + efectivo, etc.); mismo valor en todas las filas del mismo grupo. */
  paymentGroupId: string;
  created_at: string;
  cashier_id: string | null;
  cashier_name: string;
  amount: number;
  status: CompletedPayment["status"];
  notes: string | null;
  tendered_amount: number | null;
  method_name: string;
  order_has_dispatched_items: boolean;
  reversal_requested: boolean;
  order_has_voided_payments: boolean;
  successor_order_id: string | null;
  payment_opening_status: CompletedPayment["payment_opening_status"];
  cash_received_detail: CompletedPayment["cash_received_detail"];
  cash_change_detail: CompletedPayment["cash_change_detail"];
  cash_refund_detail: CompletedPayment["cash_refund_detail"];
  banco_id: string | null;
  banco_nombre: string | null;
  numero_transferencia: string | null;
  comprobante_urls: string[];
  order: {
    id: string;
    number: number;
    code: string | null;
    type: "DINE_IN" | "TAKEOUT";
    is_special: boolean;
    created_by_name: string | null;
    table_name: string | null;
    split_code: string | null;
  };
  items: {
    id: string;
    paymentEntryId: string;
    product_name: string;
    quantity: number;
    tray_item_type?: "A" | "B" | "C" | null;
    amount: number;
    method_name: string;
    status: CompletedPayment["status"];
    tendered_amount: number | null;
    cash_received_detail: CompletedPayment["cash_received_detail"];
    cash_change_detail: CompletedPayment["cash_change_detail"];
    cash_refund_detail: CompletedPayment["cash_refund_detail"];
  }[];
}

interface Props {
  payments: CompletedPayment[];
  total: number;
  collectedTotal: number;
  loading?: boolean;
  filters: CompletedPaymentsFilters;
  permissions: PermissionMap;
  /** Si viene del padre (p. ej. turno con can_use_caja), tiene prioridad sobre solo permiso de módulo caja. */
  canVoidPayments?: boolean;
  actionLoading?: boolean;
  onFiltersChange: (next: CompletedPaymentsFilters) => void;
  shiftDenoms: ShiftDenom[];
  cashierUsers: CashShiftCaptureCandidate[];
  currentUserId: string | null;
  onRequestVoid: (
    paymentId: string,
    orderId: string,
    reason: string,
    paymentSelections: PaymentVoidSelectionInput[],
    cashRefundDenoms: CashRefundDenomInput[],
    refundAmount: number,
    refundMethod: PaymentRefundMethod,
    cashChangeReturnDenoms?: CashRefundDenomInput[],
  ) => Promise<{ requestId: string }>;
  onVoidWithSupervisor: (
    paymentId: string,
    requestId: string,
    reason: string,
    supervisorIdentifier: string,
    supervisorPassword: string,
    paymentSelections: PaymentVoidSelectionInput[],
    cashRefundDenoms: CashRefundDenomInput[],
    cashChangeReturnDenoms?: CashRefundDenomInput[],
  ) => Promise<void>;
  /** Re-cobrar la orden de la fila (misma orden anulada; legacy: sucesora si aplica). */
  onChargeOrder?: (args: { orderId: string; successorOrderId: string | null }) => void;
  canChargePayments?: boolean;
}

const scopeOptions: { value: CompletedPaymentsScope; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "TABLE", label: "Mesa" },
  { value: "TAKEOUT", label: "Para llevar" },
  { value: "SPECIAL", label: "Especial" },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPermissionFlags(permissions: PermissionMap, canVoidPayments?: boolean) {
  const canOperateCaja = canOperate(permissions, "caja");
  const canManageAdmin = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");

  return {
    canOperateCaja,
    canManageAdmin,
    canStartVoid: canVoidPayments ?? (canOperateCaja || canManageAdmin),
  };
}

function getEmptyMessage(scope: CompletedPaymentsScope) {
  switch (scope) {
    case "TABLE":
      return "No hay pagos de mesa en el turno de hoy.";
    case "TAKEOUT":
      return "No hay pagos para llevar en el turno de hoy.";
    case "SPECIAL":
      return "No hay pagos especiales en el turno de hoy.";
    default:
      return "No hay pagos registrados en el turno de hoy.";
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function sumDetailLines(lines: CompletedPayment["cash_change_detail"]) {
  return lines.reduce((sum, line) => sum + line.total, 0);
}

function mergeCashDetailLines(lines: CompletedPayment["cash_change_detail"]): CompletedPayment["cash_change_detail"] {
  const map = new Map<string, (typeof lines)[number]>();
  for (const line of lines) {
    const cur = map.get(line.denomination_id);
    if (!cur) {
      map.set(line.denomination_id, { ...line });
      continue;
    }
    cur.qty += line.qty;
    cur.total = roundMoney(cur.qty * cur.value);
  }
  return Array.from(map.values()).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
}

function buildCashAggregateForGroup(headers: CompletedPayment[]) {
  const receivedLines = mergeCashDetailLines(headers.flatMap((h) => h.cash_received_detail));
  const changeLines = mergeCashDetailLines(headers.flatMap((h) => h.cash_change_detail));
  const refundLines = mergeCashDetailLines(headers.flatMap((h) => h.cash_refund_detail));

  let tenderedSum = 0;
  let hasAnyTendered = false;
  for (const h of headers) {
    if (h.tendered_amount != null && Number.isFinite(Number(h.tendered_amount))) {
      tenderedSum += Number(h.tendered_amount);
      hasAnyTendered = true;
    }
  }
  const detailReceivedTotal = sumDetailLines(receivedLines);
  const receivedAmount = hasAnyTendered
    ? roundMoney(tenderedSum)
    : detailReceivedTotal > 0
      ? detailReceivedTotal
      : roundMoney(headers.reduce((s, h) => s + h.amount, 0));

  /** Sobrepago (p. ej. transferencia $10 por orden $5,25) cuando no hay movimientos/notas de cambio — corrige históricos. */
  const totalTenderedAll = roundMoney(headers.reduce((s, h) => s + (h.tendered_amount ?? 0), 0));
  const totalAppliedAll = roundMoney(headers.reduce((s, h) => s + h.amount, 0));
  const impliedChange = roundMoney(Math.max(0, totalTenderedAll - totalAppliedAll));
  const changeFromDenoms = sumDetailLines(changeLines);
  const undocumentedChange = roundMoney(Math.max(0, impliedChange - changeFromDenoms));

  return { receivedAmount, receivedLines, changeLines, refundLines, undocumentedChange };
}

function getReceivedAmount(payment: Pick<PaymentGroup, "tendered_amount" | "amount" | "cash_received_detail">) {
  const detailTotal = sumDetailLines(payment.cash_received_detail);
  return payment.tendered_amount ?? (detailTotal > 0 ? detailTotal : payment.amount);
}

export default function CompletedPaymentsList({
  payments,
  total,
  collectedTotal,
  loading = false,
  filters,
  permissions,
  canVoidPayments,
  shiftDenoms,
  cashierUsers,
  currentUserId,
  actionLoading = false,
  onFiltersChange,
  onRequestVoid,
  onVoidWithSupervisor,
  onChargeOrder,
  canChargePayments = false,
}: Props) {
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{
    open: boolean;
    mode: "request" | "execute";
    payment: ReversalPaymentData | null;
    draft: {
      reason: string;
      paymentSelections: PaymentVoidSelectionInput[];
      cashRefundDenoms: CashRefundDenomInput[];
      cashChangeReturnDenoms?: CashRefundDenomInput[];
      refundMethod?: PaymentRefundMethod | null;
    } | null;
    autoOpenConfirm: boolean;
  }>({
    open: false,
    mode: "request",
    payment: null,
    draft: null,
    autoOpenConfirm: false,
  });
  const [preAuthorization, setPreAuthorization] = useState<{
    open: boolean;
    paymentGroup: PaymentGroup | null;
  }>({
    open: false,
    paymentGroup: null,
  });

  const [pendingAuthorization, setPendingAuthorization] = useState<{
    open: boolean;
    requestId: string | null;
    payment: ReversalPaymentData | null;
    reason: string;
    paymentSelections: PaymentVoidSelectionInput[];
    cashRefundDenoms: CashRefundDenomInput[];
    cashChangeReturnDenoms: CashRefundDenomInput[];
    selectedAmount: number;
    supervisorIdentifier: string;
    supervisorPassword: string;
  }>({
    open: false,
    requestId: null,
    payment: null,
    reason: "",
    paymentSelections: [],
    cashRefundDenoms: [],
    cashChangeReturnDenoms: [],
    selectedAmount: 0,
    supervisorIdentifier: "",
    supervisorPassword: "",
  });
  type TransferDetailEntry = {
    paymentId: string;
    amount: number;
    bancoNombre: string | null;
    numeroTransferencia: string | null;
    comprobanteUrls: string[];
  };

  const [changeDetailState, setChangeDetailState] = useState<{
    open: boolean;
    title: string;
    isVoided: boolean;
    paidAmount: number;
    showReceived: boolean;
    receivedAmount: number;
    receivedLines: CompletedPayment["cash_received_detail"];
    changeLines: CompletedPayment["cash_change_detail"];
    refundLines: CompletedPayment["cash_refund_detail"];
    undocumentedChange: number;
    transferDetails: TransferDetailEntry[];
  }>({
    open: false,
    title: "Detalle de cambio",
    isVoided: false,
    paidAmount: 0,
    showReceived: true,
    receivedAmount: 0,
    receivedLines: [],
    changeLines: [],
    refundLines: [],
    undocumentedChange: 0,
    transferDetails: [],
  });
  const [reprintData, setReprintData] = useState<PaymentReceiptData | null>(null);

  const permissionFlags = getPermissionFlags(permissions, canVoidPayments);

  const groupedPayments = useMemo<PaymentGroup[]>(() => {
    const map = new Map<string, PaymentGroup>();

    for (const row of payments) {
      const existing = map.get(row.id);
      if (!existing) {
        map.set(row.id, {
          paymentId: row.id,
          paymentGroupId: row.payment_group_id ?? row.id,
          created_at: row.created_at,
          cashier_id: row.cashier_id ?? null,
          cashier_name: row.cashier_name,
          amount: row.amount,
          status: row.status,
          notes: row.notes,
          tendered_amount: row.tendered_amount,
          method_name: row.method_name,
          reversal_requested: row.reversal_requested,
          order_has_dispatched_items: row.order_has_dispatched_items,
          order_has_voided_payments: row.order_has_voided_payments,
          successor_order_id: row.successor_order_id ?? null,
          payment_opening_status: row.payment_opening_status,
          cash_received_detail: row.cash_received_detail,
          cash_change_detail: row.cash_change_detail,
          cash_refund_detail: row.cash_refund_detail,
          banco_id: row.banco_id ?? null,
          banco_nombre: row.banco_nombre ?? null,
          numero_transferencia: row.numero_transferencia ?? null,
          comprobante_urls: row.comprobante_urls ?? [],
          order: {
            id: row.order_id,
            number: row.order_number ?? 0,
            code: row.order_code,
            type: row.order_type,
            is_special: row.is_special,
            created_by_name: row.created_by_name,
            table_name: row.table_name,
            split_code: row.split_code,
          },
          items: [],
        });
      } else if (!map.get(row.id)!.successor_order_id && row.successor_order_id) {
        map.get(row.id)!.successor_order_id = row.successor_order_id;
      }

      map.get(row.id)!.items.push({
        id: row.item_id ?? row.id,
        paymentEntryId: row.payment_item_id ?? row.id,
        product_name: row.item_description ?? "Item no especificado",
        quantity: row.item_paid_quantity ?? row.item_quantity ?? 1,
        tray_item_type: row.tray_item_type ?? null,
        amount: row.item_amount,
        method_name: row.method_name,
        status: row.status,
        tendered_amount: row.tendered_amount,
        cash_received_detail: row.cash_received_detail,
        cash_change_detail: row.cash_change_detail,
        cash_refund_detail: row.cash_refund_detail,
      });
    }

    const grouped = Array.from(map.values());

    // Si la misma orden ya tiene un cobro vigente, no mostrar filas Anulado/Reversado:
    // anular + re-cobrar debe dejar una sola fila (Pagado), no dos con el mismo código.
    const ordersWithActivePayment = new Set(
      grouped
        .filter((payment) => payment.status === "APPLIED" || payment.status === "PARTIAL")
        .map((payment) => payment.order.id),
    );
    const visibleGrouped = grouped.filter((payment) => {
      const isVoidedOrReversed = payment.status === "VOIDED" || payment.status === "REVERSED";
      if (!isVoidedOrReversed) return true;
      return !ordersWithActivePayment.has(payment.order.id);
    });

    // Calculate the most recent activity timestamp for each order group (by order.id, code or number)
    const latestActivityByOrder = new Map<string, number>();
    for (const payment of visibleGrouped) {
      const orderKey = payment.order.id || payment.order.code || String(payment.order.number);
      const paymentTime = new Date(payment.created_at).getTime();
      const currentMax = latestActivityByOrder.get(orderKey) ?? 0;
      if (paymentTime > currentMax) {
        latestActivityByOrder.set(orderKey, paymentTime);
      }
    }

    return visibleGrouped.sort((a, b) => {
      const orderKeyA = a.order.id || a.order.code || String(a.order.number);
      const orderKeyB = b.order.id || b.order.code || String(b.order.number);

      const maxTimeA = latestActivityByOrder.get(orderKeyA) ?? 0;
      const maxTimeB = latestActivityByOrder.get(orderKeyB) ?? 0;

      // 1. Group together by the order's most recent activity (latest activity order first)
      if (maxTimeA !== maxTimeB) {
        return maxTimeB - maxTimeA;
      }

      // 2. Within the same order, put active payments (APPLIED) first and voided/reversed next
      const isVoidedA = a.status === "VOIDED" || a.status === "REVERSED";
      const isVoidedB = b.status === "VOIDED" || b.status === "REVERSED";

      if (isVoidedA !== isVoidedB) {
        return isVoidedA ? 1 : -1;
      }

      // 3. Secondary fallback order by individual payment created_at descending
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [payments]);

  const cashAggregateByGroupId = useMemo(() => {
    const uniqueHeaderByPaymentId = new Map<string, CompletedPayment>();
    for (const row of payments) {
      if (!uniqueHeaderByPaymentId.has(row.id)) {
        uniqueHeaderByPaymentId.set(row.id, row);
      }
    }
    const headersByGroup = new Map<string, CompletedPayment[]>();
    for (const header of uniqueHeaderByPaymentId.values()) {
      const gid = header.payment_group_id ?? header.id;
      if (!headersByGroup.has(gid)) headersByGroup.set(gid, []);
      headersByGroup.get(gid)!.push(header);
    }
    const result = new Map<string, ReturnType<typeof buildCashAggregateForGroup>>();
    for (const [gid, headers] of headersByGroup) {
      result.set(gid, buildCashAggregateForGroup(headers));
    }
    return result;
  }, [payments]);

  /** Metodos de todo el cobro (mismo payment_group_id), p. ej. efectivo + transferencia. */
  const methodsByGroupId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of payments) {
      const gid = row.payment_group_id ?? row.id;
      const name = String(row.method_name ?? "").trim();
      if (!name) continue;
      const list = map.get(gid) ?? [];
      if (!list.includes(name)) list.push(name);
      map.set(gid, list);
    }
    return map;
  }, [payments]);

  /** Detalle de transferencia de todo el cobro (mismo payment_group_id). */
  const transferDetailByGroupId = useMemo(() => {
    const map = new Map<string, TransferDetailEntry[]>();
    const seenPaymentIds = new Set<string>();

    for (const row of payments) {
      if (seenPaymentIds.has(row.id)) continue;
      seenPaymentIds.add(row.id);

      const isTransfer =
        isTransferPaymentMethodName(row.method_name)
        || Boolean(row.banco_id)
        || Boolean(row.numero_transferencia)
        || (row.comprobante_urls?.length ?? 0) > 0;

      if (!isTransfer) continue;

      const gid = row.payment_group_id ?? row.id;
      const list = map.get(gid) ?? [];
      list.push({
        paymentId: row.id,
        amount: Number(row.amount ?? 0),
        bancoNombre: row.banco_nombre ?? null,
        numeroTransferencia: row.numero_transferencia ?? null,
        comprobanteUrls: row.comprobante_urls ?? [],
      });
      map.set(gid, list);
    }
    return map;
  }, [payments]);

  const visiblePayments = useMemo(() => {
    if (filters.cashierName === "ALL") return groupedPayments;
    return groupedPayments.filter((payment) => {
      const matchingRow = payments.find((r) => r.id === payment.paymentId);
      return matchingRow?.cashier_id === filters.cashierName;
    });
  }, [filters.cashierName, groupedPayments, payments]);

  const visibleTotal = visiblePayments.filter((p) => {
    const normalizedStatus = (p.status?.toString() || "").toUpperCase();
    return normalizedStatus !== "VOIDED" && normalizedStatus !== "REVERSED";
  }).length;

  const visibleCollectedTotal = visiblePayments.reduce((sum, payment) => {
    const normalizedStatus = (payment.status?.toString() || "").toUpperCase();
    if (normalizedStatus === "VOIDED" || normalizedStatus === "REVERSED") {
      return sum;
    }
    return sum + payment.amount;
  }, 0);

  const openModalForPayment = (payment: PaymentGroup) => {
    const methodSet = new Set<string>(payment.items.map((item) => item.method_name));
    const methods = Array.from(methodSet).join(", ");
    const tableLabel = getCajaOrderOriginLabel({
      orderType: payment.order.type,
      tableName: payment.order.table_name,
      splitCode: payment.order.split_code,
      isSpecial: payment.order.is_special,
      isTrayOrder: (payment.order as { is_tray_order?: boolean | null }).is_tray_order,
    });

    const isForeignCashier = payment.cashier_id !== currentUserId;

    if (isForeignCashier) {
      setPreAuthorization({ open: true, paymentGroup: payment });
      return;
    }

    setModalState({
      open: true,
      mode: "request",
      payment: {
        paymentId: payment.paymentId,
        orderId: payment.order.id,
        orderCode: getOrderRef(payment.order.code, payment.order.number),
        orderNumber: payment.order.number,
        tableLabel,
        createdAt: payment.created_at,
        cashierName: payment.cashier_name,
        cashierId: payment.cashier_id,
        amount: payment.amount,
        status: payment.status,
        notes: payment.notes,
        methodsSummary: methods || payment.method_name,
        orderHasDispatchedItems: payment.order_has_dispatched_items,
        requiresSupervisor: isForeignCashier,
        cashReceivedDetail: payment.cash_received_detail ?? [],
        cashChangeDetail: payment.cash_change_detail ?? [],
        items: payment.items.map((item) => ({
          id: item.id,
          paymentEntryId: item.paymentEntryId,
          productName: item.product_name,
          quantity: item.quantity,
          tray_item_type: item.tray_item_type ?? null,
          amount: item.amount,
          methodName: item.method_name,
          status: item.status,
        })),
      },
      draft: null,
      autoOpenConfirm: false,
    });
  };

  const handleReprint = async (payment: PaymentGroup) => {
    let token_promocion: string | null = null;
    let clienteCedula: string | undefined = undefined;
    let clienteNombre: string | undefined = undefined;

    let dbOrder: any = null;
    let attempts = 0;
    while (attempts < 5) {
      attempts++;
      try {
        const { data: orderData } = await supabase
          .from("orders")
          .select(`
            token_promocion,
            status,
            paid_at,
            cliente_id,
            clientes ( cedula, nombres, apellidos )
          `)
          .eq("id", payment.order.id)
          .single();

        if (orderData) {
          dbOrder = orderData;
          if (orderData.token_promocion) {
            token_promocion = orderData.token_promocion;
          }

          // @ts-expect-error - The join works but generated relation types are incomplete.
          const cliente = orderData.clientes;
          if (cliente && !Array.isArray(cliente)) {
            clienteCedula = cliente.cedula;
            clienteNombre = `${cliente.nombres} ${cliente.apellidos ?? ""}`.trim() || undefined;
          }
          break;
        }
      } catch (err) {
        console.error(`Reprint attempt ${attempts} failed to fetch order extra details:`, err);
      }
      if (attempts < 5) {
        await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 300));
      }
    }

    const promocionExtras = await buildPromocionReciboExtras(token_promocion);

    const receiptItemsMap = new Map<string, { description: string; quantity: number; unitPrice: number; amount: number }>();
    for (const item of payment.items) {
      const unitPrice = item.quantity > 0 ? item.amount / item.quantity : 0;
      const key = `${item.product_name}_${unitPrice}`;
      const existing = receiptItemsMap.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        existing.amount += item.amount;
      } else {
        receiptItemsMap.set(key, {
          description: item.product_name,
          quantity: item.quantity,
          unitPrice,
          amount: item.amount,
        });
      }
    }

    const methodMap = new Map<string, number>();
    for (const item of payment.items) {
      methodMap.set(item.method_name, (methodMap.get(item.method_name) || 0) + item.amount);
    }
    const paymentsArr = Array.from(methodMap.entries()).map(([methodName, appliedAmount]) => ({
      methodName,
      appliedAmount,
    }));

    const receipt: PaymentReceiptData = {
      orderNumber: getOrderRef(payment.order.code, payment.order.number),
      tableName: payment.order.table_name ?? undefined,
      orderType: payment.order.type,
      isSpecial: payment.order.is_special,
      isTrayOrder: (payment.order as any).is_tray_order,
      items: Array.from(receiptItemsMap.values()),
      payments: paymentsArr,
      totalAmount: payment.amount,
      totalReceived: payment.tendered_amount ?? payment.amount,
      changeAmount: Math.max(0, (payment.tendered_amount ?? payment.amount) - payment.amount),
      createdAt: payment.created_at,
      ...promocionExtras,
      clienteCedula,
      clienteNombre,
    };

    setReprintData(receipt);
    setTimeout(() => {
      printPaymentReceipt(receipt).catch((e) => toast.error("Error al reimprimir: " + e.message));
    }, 100);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[26px] border border-orange-200 bg-gradient-to-r from-white via-orange-50/50 to-white p-4 shadow-[0_20px_45px_-40px_rgba(249,115,22,0.55)]">
        <div className="flex flex-wrap items-center justify-between gap-3">

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={filters.scope}
              onChange={(event) => onFiltersChange({ ...filters, scope: event.target.value as CompletedPaymentsScope })}
              className="h-10 min-w-[150px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none transition-colors hover:border-slate-300"
            >
              {scopeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label === "ALL" ? "Todos" : option.label}
                </option>
              ))}
            </select>

            <select
              value={filters.cashierName}
              onChange={(event) => onFiltersChange({ ...filters, cashierName: event.target.value })}
              className="h-10 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none transition-colors hover:border-slate-300"
            >
              <option value="ALL">Todos los cajeros</option>
              {currentUserId && (
                cashierUsers.some((cashier) => cashier.id === currentUserId)
                || filters.cashierName === currentUserId
              ) && (
                <option value={currentUserId}>Mi caja</option>
              )}
              {cashierUsers
                .filter((u) => u.id !== currentUserId)
                .map((cashier) => (
                <option key={cashier.id} value={cashier.id}>
                  {getUserDisplayName(cashier)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="rounded-2xl border border-orange-200 bg-white px-3 py-2 text-sm shadow-sm">
              <span className="text-muted-foreground">Pagos</span>
              <p className="text-center font-semibold text-foreground">{visibleTotal}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm shadow-sm">
              <span className="text-muted-foreground">Total cobrado</span>
              <p className="text-right font-semibold text-foreground">{formatCurrency(visibleCollectedTotal)}</p>
            </div>
          </div>

        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Consultando pagos del turno...</p>
        </div>
      ) : visiblePayments.length === 0 ? (
        <div className="rounded-[26px] border border-slate-200 bg-white p-8 text-center shadow-[0_18px_40px_-36px_rgba(15,23,42,0.35)]">
          <ReceiptText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">{getEmptyMessage(filters.scope)}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_55px_-42px_rgba(15,23,42,0.34)]">
          <div className="divide-y divide-slate-200">
            {visiblePayments.map((payment, index) => {
              const expanded = expandedPaymentId === payment.paymentId;
              const label = getCajaOrderOriginLabel({
                orderType: payment.order.type,
                tableName: payment.order.table_name,
                splitCode: payment.order.split_code,
                isSpecial: payment.order.is_special,
                isTrayOrder: (payment.order as { is_tray_order?: boolean | null }).is_tray_order,
              });
              const orderKind = getOrderKind({
                orderType: payment.order.type,
                isSpecial: payment.order.is_special,
              });
              const normalizedStatus = (payment.status?.toString() || "").toUpperCase();
              const isVoidedOrReversed = normalizedStatus === "REVERSED" || normalizedStatus === "VOIDED";
              const blockedByClosedOpening = payment.payment_opening_status === "cerrada" || payment.payment_opening_status === "anulada";
              const blockedByPriorOrderVoid = payment.order_has_voided_payments && !isVoidedOrReversed;
              const blockedByState = payment.reversal_requested || blockedByClosedOpening || blockedByPriorOrderVoid;
              const voidButtonTitle = blockedByPriorOrderVoid
                ? "Esta orden ya tuvo una anulación de pago"
                : payment.reversal_requested
                  ? "La anulación está pendiente"
                  : blockedByClosedOpening
                    ? "No se puede anular un pago de una caja cerrada"
                    : "Anular pago";
              const itemsLabel = `${payment.items.length} ${payment.items.length === 1 ? "item" : "items"}`;
              const groupCash =           cashAggregateByGroupId.get(payment.paymentGroupId) ?? {
                receivedAmount: getReceivedAmount(payment),
                receivedLines: payment.cash_received_detail ?? [],
                changeLines: payment.cash_change_detail ?? [],
                refundLines: payment.cash_refund_detail ?? [],
                undocumentedChange: (() => {
                  const t = payment.tendered_amount ?? 0;
                  const impl = roundMoney(Math.max(0, t - payment.amount));
                  const fromDen = sumDetailLines(payment.cash_change_detail ?? []);
                  return roundMoney(Math.max(0, impl - fromDen));
                })(),
              };
              const hasCashTrace =
                groupCash.receivedAmount > 0.005
                || groupCash.receivedLines.length > 0
                || groupCash.changeLines.length > 0
                || groupCash.refundLines.length > 0
                || groupCash.undocumentedChange > 0.005;
              const groupTransferDetails = transferDetailByGroupId.get(payment.paymentGroupId) ?? [];
              const hasTransferDetail = groupTransferDetails.length > 0;
              const hasPaymentDetail = hasCashTrace || hasTransferDetail;
              const rowChangeTitle = isVoidedOrReversed
                ? "Detalle del cobro y anulacion"
                : hasCashTrace && hasTransferDetail
                  ? "Detalle de pago (efectivo y transferencia)"
                  : hasTransferDetail
                    ? "Detalle de transferencia"
                    : groupCash.changeLines.length > 0 || groupCash.undocumentedChange > 0.005
                      ? "Detalle de pago y cambio"
                      : groupCash.receivedLines.length > 0
                        ? "Detalle de efectivo recibido"
                        : "Detalle del pago";

              return (
                <div key={payment.paymentId} className={index % 2 === 0 ? "bg-white" : "bg-slate-100/70"}>
                  <div
                    onClick={() => setExpandedPaymentId((current) => (current === payment.paymentId ? null : payment.paymentId))}
                    className="group flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-slate-100/50 cursor-pointer sm:px-8"
                  >
                    {/* Left Section: Chevron + Icon + Details */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors group-hover:bg-slate-100 group-hover:text-slate-800"
                        aria-label={expanded ? "Ocultar detalle" : "Mostrar detalle"}
                      >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>

                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                        {orderKind === "takeout" ? (
                          <ShoppingBag className="h-5 w-5" />
                        ) : orderKind === "special" ? (
                          <CreditCard className="h-5 w-5" />
                        ) : (
                          <UtensilsCrossed className="h-5 w-5" />
                        )}
                      </span>

                      <div className="flex flex-col min-w-0 gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-lg font-semibold tracking-[-0.02em] text-slate-950">{label}</p>
                          <p className="font-mono text-sm font-bold tracking-[0.08em] text-slate-700">
                            {getOrderRef(payment.order.code, payment.order.number)}
                          </p>
                          <PaymentStatusBadge status={payment.status} />
                          <PaymentMethodIcons
                            methodNames={
                              methodsByGroupId.get(payment.paymentGroupId)
                              ?? (payment.items.length > 0
                                ? payment.items.map((item) => item.method_name)
                                : [payment.method_name])
                            }
                          />
                          {payment.reversal_requested && !isVoidedOrReversed && (
                            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                              Anulación Pendiente
                            </Badge>
                          )}
                          {blockedByClosedOpening && (
                            <Badge className="border-slate-200 bg-slate-100 text-slate-700">
                              Caja cerrada
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatDateTime(payment.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle Section: Amount and Detail Button */}
                    <div className="flex flex-row items-center justify-between lg:justify-end gap-4 shrink-0 pl-11 lg:pl-0 mt-2 lg:mt-0">
                      <p className="text-[1.45rem] font-semibold tracking-[-0.03em] text-slate-950">${payment.amount.toFixed(2)}</p>
                    </div>

                    {/* Right Section: Actions */}
                    <div className="flex items-center justify-start lg:justify-end gap-3 pl-11 lg:pl-0 shrink-0 mt-2 lg:mt-0">
                      {hasPaymentDetail && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setChangeDetailState({
                              open: true,
                              title: rowChangeTitle,
                              isVoided: isVoidedOrReversed,
                              paidAmount: payment.amount,
                              // Siempre mostrar lo recibido si hay rastro de efectivo
                              // (también en anulados: sin eso el vuelto + devolución parece un solo monto).
                              showReceived: hasCashTrace,
                              receivedAmount: groupCash.receivedAmount,
                              receivedLines: groupCash.receivedLines,
                              changeLines: groupCash.changeLines,
                              refundLines: groupCash.refundLines,
                              undocumentedChange: groupCash.undocumentedChange,
                              transferDetails: groupTransferDetails,
                            });
                          }}
                          className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-cyan-400 text-white shadow-[0_4px_14px_0_rgba(6,182,212,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(6,182,212,0.23)] active:scale-95"
                          title={rowChangeTitle}
                        >
                          <ScanSearch className="h-5 w-5 transition-transform group-hover/btn:scale-110" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleReprint(payment);
                        }}
                        className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 text-white shadow-[0_4px_14px_0_rgba(16,185,129,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(16,185,129,0.23)] active:scale-95"
                        title="Reimprimir ticket"
                      >
                        <Printer className="h-5 w-5 transition-transform group-hover/btn:scale-110" />
                      </button>
                      {!isVoidedOrReversed && permissionFlags.canStartVoid && (
                        <button
                          type="button"
                          disabled={blockedByState}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (blockedByState) return;
                            openModalForPayment(payment);
                          }}
                          className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-rose-600 to-orange-400 text-white shadow-[0_4px_14px_0_rgba(225,29,72,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(225,29,72,0.23)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:scale-100 disabled:hover:shadow-[0_4px_14px_0_rgba(225,29,72,0.39)]"
                          title={voidButtonTitle}
                          aria-label={voidButtonTitle}
                        >
                          <Undo2 className="h-5 w-5 transition-transform group-hover/btn:-rotate-45" />
                        </button>
                      )}
                      {isVoidedOrReversed && canChargePayments && onChargeOrder && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onChargeOrder({
                              orderId: payment.order.id,
                              successorOrderId: payment.successor_order_id,
                            });
                          }}
                          className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-green-700 to-lime-500 text-white shadow-[0_4px_14px_0_rgba(21,128,61,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(21,128,61,0.23)] active:scale-95"
                          title="Cobrar orden"
                        >
                          <CreditCard className="h-5 w-5 transition-transform group-hover/btn:scale-110" />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-slate-200 px-4 py-4 sm:px-8">
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatDateTime(payment.created_at)}
                            </span>
                            <span>Cajero: {payment.cashier_name}</span>
                            {payment.order.created_by_name && (
                              <span className="inline-flex items-center gap-1">
                                <UserRound className="h-3.5 w-3.5" />
                                {payment.order.created_by_name}
                              </span>
                            )}
                            <span>Metodo: {payment.method_name}</span>
                            <span>{itemsLabel}</span>
                          </p>
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                          <div className="hidden grid-cols-[minmax(0,1.8fr)_120px_110px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 sm:grid">
                            <span>Detalle</span>
                            <span>Metodo</span>
                            <span className="text-right">Estado</span>
                            <span className="text-right">Monto</span>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {payment.items.map((item) => (
                                <div
                                  key={item.id + item.paymentEntryId}
                                  className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.8fr)_120px_110px_110px] sm:gap-3"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-slate-900">
                                      {item.tray_item_type === "C" ? item.product_name : `${item.quantity}x ${item.product_name}`}
                                    </p>
                                  </div>
                                  <div className="text-sm text-slate-600">{item.method_name}</div>
                                  <div className="sm:text-right"><PaymentStatusBadge status={item.status} /></div>
                                  <div className="font-semibold text-slate-900 sm:text-right">${item.amount.toFixed(2)}</div>
                                </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Dialog
        open={changeDetailState.open}
        onOpenChange={(open) => setChangeDetailState((current) => ({ ...current, open }))}
      >
        <DialogContent
          className={cn(
            "max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem),720px)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px]",
            changeDetailState.transferDetails.length > 0 ? "sm:max-w-lg" : "sm:max-w-md",
          )}
        >
          <DialogHeader>
            <DialogTitle>{changeDetailState.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {changeDetailState.isVoided && changeDetailState.paidAmount > 0.005 && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-600">Monto cobrado (anulado)</span>
                  <span className="text-base font-bold tabular-nums text-slate-950">
                    {formatCurrency(changeDetailState.paidAmount)}
                  </span>
                </div>
              </div>
            )}

            {changeDetailState.transferDetails.length > 0 && (
              <div className="space-y-3">
                {changeDetailState.transferDetails.map((transfer) => (
                  <div
                    key={transfer.paymentId}
                    className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm shadow-sky-500/40">
                        <Landmark className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-950">Transferencia</p>
                        <p className="text-xs text-sky-900/70">Monto aplicado al cobro</p>
                      </div>
                      <span className="text-lg font-bold text-sky-700">
                        {formatCurrency(transfer.amount)}
                      </span>
                    </div>

                    <div className="space-y-1.5 rounded-xl bg-white/80 px-3 py-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-slate-500">Banco</span>
                        <span className="text-right font-semibold text-slate-950">
                          {transfer.bancoNombre || "—"}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-slate-500">N.º transferencia</span>
                        <span className="break-all text-right font-semibold text-slate-950">
                          {transfer.numeroTransferencia || "—"}
                        </span>
                      </div>
                    </div>

                    {transfer.comprobanteUrls.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
                          Comprobante
                        </p>
                        {transfer.comprobanteUrls.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-hidden rounded-xl border border-sky-200 bg-white"
                          >
                            <img
                              src={url}
                              alt="Comprobante de transferencia"
                              className="max-h-72 w-full object-contain"
                            />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs font-medium text-sky-900/70">
                        No hay foto de comprobante asociada a este pago.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {(changeDetailState.showReceived
              || changeDetailState.changeLines.length > 0
              || changeDetailState.undocumentedChange > 0.005) && (
              <>
                {changeDetailState.isVoided && (
                  <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Al cobrar
                  </p>
                )}

                {changeDetailState.showReceived && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-950">Cliente entrego</span>
                      <span className="text-lg font-bold text-emerald-700">{formatCurrency(changeDetailState.receivedAmount)}</span>
                    </div>
                    {changeDetailState.receivedLines.length === 0 && (
                      <p className="mt-1 text-xs font-medium text-emerald-800/70">
                        {changeDetailState.changeLines.length > 0
                          ? "Sin desglose de efectivo recibido (p. ej. transferencia). Si hubo vuelto en efectivo, se muestra abajo."
                          : "No se registro desglose de monedas o billetes recibidos."}
                      </p>
                    )}
                  </div>
                )}

                {changeDetailState.showReceived && changeDetailState.receivedLines.length > 0 && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-950">Monedas y billetes recibidos</span>
                      <span className="text-lg font-bold text-emerald-700">{formatCurrency(sumDetailLines(changeDetailState.receivedLines))}</span>
                    </div>
                    <div className="space-y-1.5">
                      {changeDetailState.receivedLines.map((line) => (
                        <div key={line.denomination_id} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-2 py-1.5 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <DenominationVisual
                              label={line.label}
                              imageUrl={line.image_url}
                              className="h-9 w-9 rounded-xl"
                              iconClassName="h-4 w-4"
                            />
                            <span className="truncate text-slate-900">{line.qty}x {line.label}</span>
                          </div>
                          <span className="font-semibold text-slate-950">{formatCurrency(line.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {changeDetailState.changeLines.length > 0 && (
                  <div className="rounded-2xl border border-orange-200 bg-orange-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-slate-950">
                          {changeDetailState.isVoided ? "Cambio (vuelto al cobrar)" : "Cambio entregado al cliente"}
                        </span>
                        {changeDetailState.isVoided && (
                          <p className="mt-0.5 text-[11px] text-orange-900/70">
                            Vuelto del cobro original, no es parte de la anulacion.
                          </p>
                        )}
                      </div>
                      <span className="text-lg font-bold text-orange-700">{formatCurrency(sumDetailLines(changeDetailState.changeLines))}</span>
                    </div>
                    <div className="space-y-1.5">
                      {changeDetailState.changeLines.map((line) => (
                        <div key={line.denomination_id} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-2 py-1.5 text-sm">
                          <div className="flex min-w-0 items-center gap-2">
                            <DenominationVisual
                              label={line.label}
                              imageUrl={line.image_url}
                              className="h-9 w-9 rounded-xl"
                              iconClassName="h-4 w-4"
                            />
                            <span className="truncate text-slate-900">{line.qty}x {line.label}</span>
                          </div>
                          <span className="font-semibold text-slate-950">{formatCurrency(line.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {changeDetailState.undocumentedChange > 0.005 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-950">
                        {changeDetailState.changeLines.length > 0
                          ? "Cambio adicional sin desglose"
                          : changeDetailState.isVoided
                            ? "Cambio al cobrar (sin desglose)"
                            : "Cambio entregado (sin desglose)"}
                      </span>
                      <span className="text-lg font-bold text-amber-800">
                        {formatCurrency(changeDetailState.undocumentedChange)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-amber-900/75">
                      Calculado como total recibido menos monto aplicado al cobro (registro previo sin movimientos de cambio en caja).
                    </p>
                  </div>
                )}
              </>
            )}

            {changeDetailState.refundLines.length > 0 && (
              <>
                {changeDetailState.isVoided && (
                  <p className="px-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Al anular
                  </p>
                )}
                <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-slate-950">
                        {changeDetailState.isVoided ? "Devuelto al anular" : "Devuelto al cliente"}
                      </span>
                      {changeDetailState.isVoided && (
                        <p className="mt-0.5 text-[11px] text-red-900/70">
                          Reembolso del monto cobrado ({formatCurrency(changeDetailState.paidAmount)}).
                        </p>
                      )}
                    </div>
                    <span className="text-lg font-bold text-red-700">{formatCurrency(sumDetailLines(changeDetailState.refundLines))}</span>
                  </div>
                  <div className="space-y-1.5">
                    {changeDetailState.refundLines.map((line) => (
                      <div key={line.denomination_id} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-2 py-1.5 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <DenominationVisual
                            label={line.label}
                            imageUrl={line.image_url}
                            className="h-9 w-9 rounded-xl"
                            iconClassName="h-4 w-4"
                          />
                          <span className="truncate text-slate-900">{line.qty}x {line.label}</span>
                        </div>
                        <span className="font-semibold text-slate-950">{formatCurrency(line.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {modalState.payment ? (
        <PaymentReversalModal
          open={modalState.open}
          onOpenChange={(open) =>
            setModalState((prev) => ({
              ...prev,
              open,
              autoOpenConfirm: open ? prev.autoOpenConfirm : false,
            }))
          }
          mode={modalState.mode}
          payment={modalState.payment}
          shiftDenoms={shiftDenoms}
          loading={actionLoading}
          allowPartial={true}
          titleOverride="Anular pago"
          initialDraft={modalState.draft}
          autoOpenConfirm={modalState.autoOpenConfirm}
          onSubmit={async ({
            paymentId,
            reason,
            paymentSelections,
            cashRefundDenoms,
            cashChangeReturnDenoms,
            refundAmount,
            refundMethod,
          }) => {
            try {
              const itemList = modalState.payment?.items ?? [];
              const selectedAmount = paymentSelections.reduce((sum, selection) => {
                const item = itemList.find((entry) => entry.paymentEntryId === selection.paymentEntryId);
                const unitAmount = item && item.quantity > 0 ? item.amount / item.quantity : 0;
                return sum + unitAmount * selection.quantity;
              }, 0);

              const requestIdResponse = await onRequestVoid(
                paymentId,
                modalState.payment?.orderId ?? "",
                reason,
                paymentSelections,
                cashRefundDenoms,
                refundAmount,
                refundMethod,
                cashChangeReturnDenoms,
              );
              const requestId = requestIdResponse.requestId;

              if (!modalState.payment?.orderHasDispatchedItems && !modalState.payment?.requiresSupervisor) {
                // Direct reversal - same cashier, no dispatched items, no supervisor needed
                await onVoidWithSupervisor(
                  paymentId,
                  requestId,
                  reason,
                  "",
                  "",
                  paymentSelections,
                  cashRefundDenoms,
                  cashChangeReturnDenoms,
                );
                setModalState({ open: false, mode: "request", payment: null, draft: null, autoOpenConfirm: false });
                return;
              }

              // Requires supervisor authorization
              if (modalState.payment?.requiresSupervisor && pendingAuthorization.supervisorPassword) {
                // We already have pre-authorization credentials from the initial step
                await onVoidWithSupervisor(
                  paymentId,
                  requestId,
                  reason,
                  pendingAuthorization.supervisorIdentifier,
                  pendingAuthorization.supervisorPassword,
                  paymentSelections,
                  cashRefundDenoms,
                  cashChangeReturnDenoms,
                );
                setModalState({ open: false, mode: "request", payment: null, draft: null, autoOpenConfirm: false });
                setPendingAuthorization({
                  open: false,
                  requestId: null,
                  payment: null,
                  reason: "",
                  paymentSelections: [],
                  cashRefundDenoms: [],
                  cashChangeReturnDenoms: [],
                  selectedAmount: 0,
                  supervisorIdentifier: "",
                  supervisorPassword: "",
                });
                return;
              }

              // Otherwise, we need to ask for supervisor authorization now (for dispatched items)
              setModalState({
                open: true,
                mode: "request",
                payment: modalState.payment,
                draft: {
                  reason,
                  paymentSelections,
                  cashRefundDenoms,
                  cashChangeReturnDenoms,
                  refundMethod,
                },
                autoOpenConfirm: false,
              });
              setPendingAuthorization({
                open: true,
                requestId,
                payment: modalState.payment,
                reason,
                paymentSelections,
                cashRefundDenoms,
                cashChangeReturnDenoms,
                selectedAmount,
                supervisorIdentifier: "",
                supervisorPassword: "",
              });
            } catch (error: any) {
              toast.error(error?.message || "Error al procesar la anulacion");
              throw error;
            }
          }}
        />
      ) : null}

      {preAuthorization.open ? (
        <SupervisorAuthorizationDialog
          open={preAuthorization.open}
          onOpenChange={(open) => setPreAuthorization((prev) => ({ ...prev, open }))}
          loading={actionLoading}
          paymentLabel={
            preAuthorization.paymentGroup
              ? `${getCajaOrderOriginLabel({
                  orderType: preAuthorization.paymentGroup.order.type,
                  tableName: preAuthorization.paymentGroup.order.table_name,
                  splitCode: preAuthorization.paymentGroup.order.split_code,
                  isSpecial: preAuthorization.paymentGroup.order.is_special,
                  isTrayOrder: (preAuthorization.paymentGroup.order as any).is_tray_order,
                })} - ${getOrderRef(preAuthorization.paymentGroup.order.code, preAuthorization.paymentGroup.order.number)}`
              : "Pago"
          }
          amountLabel={
            preAuthorization.paymentGroup ? formatCurrency(preAuthorization.paymentGroup.amount) : formatCurrency(0)
          }
          shiftLabel="Turno actual"
          cashierName={preAuthorization.paymentGroup?.cashier_name ?? "No identificado"}
          paymentMethod={Array.from(new Set(preAuthorization.paymentGroup?.items.map((i) => i.method_name))).join(", ") || "Metodo"}
          reason="Autorización requerida para anular un pago cobrado por otro cajero."
          onConfirm={async ({ identifier, password }) => {
            if (!preAuthorization.paymentGroup) return;

            // Validate credentials first!
            const { data, error: validationError } = await supabase.functions.invoke("login-with-identifier", {
              body: { identifier, password },
            });

            if (validationError || data?.error) {
              throw new Error(data?.error || "Credenciales invalidas");
            }

            const payment = preAuthorization.paymentGroup;
            const tableLabel = getCajaOrderOriginLabel({
              orderType: payment.order.type,
              tableName: payment.order.table_name,
              splitCode: payment.order.split_code,
              isSpecial: payment.order.is_special,
              isTrayOrder: (payment.order as { is_tray_order?: boolean | null }).is_tray_order,
            });
            const methodSet = new Set<string>(payment.items.map((item) => item.method_name));
            const methods = Array.from(methodSet).join(", ");

            // We store the credentials to be used when the user submits the actual void modal
            setPendingAuthorization((prev) => ({
              ...prev,
              supervisorIdentifier: identifier,
              supervisorPassword: password,
            }));

            setModalState({
              open: true,
              mode: "execute",
              payment: {
                paymentId: payment.paymentId,
                orderId: payment.order.id,
                orderCode: getOrderRef(payment.order.code, payment.order.number),
                orderNumber: payment.order.number,
                tableLabel,
                createdAt: payment.created_at,
                cashierName: payment.cashier_name,
                cashierId: payment.cashier_id,
                amount: payment.amount,
                status: payment.status,
                notes: payment.notes,
                methodsSummary: methods || payment.method_name,
                orderHasDispatchedItems: payment.order_has_dispatched_items,
                requiresSupervisor: true,
                cashReceivedDetail: payment.cash_received_detail ?? [],
                cashChangeDetail: payment.cash_change_detail ?? [],
                items: payment.items.map((item) => ({
                  id: item.id,
                  paymentEntryId: item.paymentEntryId,
                  productName: item.product_name,
                  quantity: item.quantity,
                  tray_item_type: item.tray_item_type ?? null,
                  amount: item.amount,
                  methodName: item.method_name,
                  status: item.status,
                })),
              },
              draft: null,
              autoOpenConfirm: false,
            });

            setPreAuthorization({ open: false, paymentGroup: null });
          }}
        />
      ) : null}

      {pendingAuthorization.open ? (
        <SupervisorAuthorizationDialog
          open={pendingAuthorization.open}
          onOpenChange={(open) =>
            setPendingAuthorization((current) =>
              open
                ? {
                    ...current,
                    open,
                  }
                : {
                    open: false,
                    requestId: null,
                    payment: null,
                    reason: "",
                    paymentSelections: [],
                    cashRefundDenoms: [],
                    cashChangeReturnDenoms: [],
                    selectedAmount: 0,
                    supervisorIdentifier: "",
                    supervisorPassword: "",
                  },
            )
          }
          loading={actionLoading}
          paymentLabel={
            pendingAuthorization.payment
              ? `${pendingAuthorization.payment.tableLabel} - ${pendingAuthorization.payment.orderCode ?? `#${pendingAuthorization.payment.orderNumber}`}`
              : "Pago"
          }
          amountLabel={
            pendingAuthorization.payment
              ? formatCurrency(pendingAuthorization.selectedAmount || pendingAuthorization.payment.amount)
              : formatCurrency(0)
          }
          shiftLabel="Turno actual"
          cashierName={pendingAuthorization.payment?.cashierName ?? "No identificado"}
          paymentMethod={pendingAuthorization.payment?.methodsSummary ?? "Metodo"}
          reason={pendingAuthorization.reason}
          onConfirm={async ({ identifier, password }) => {
            if (!pendingAuthorization.payment || !pendingAuthorization.requestId) return;

            await onVoidWithSupervisor(
              pendingAuthorization.payment.paymentId,
              pendingAuthorization.requestId,
              pendingAuthorization.reason,
              identifier,
              password,
              pendingAuthorization.paymentSelections,
              pendingAuthorization.cashRefundDenoms,
              pendingAuthorization.cashChangeReturnDenoms,
            );

            setPendingAuthorization({
              open: false,
              requestId: null,
              payment: null,
              reason: "",
              paymentSelections: [],
              cashRefundDenoms: [],
              cashChangeReturnDenoms: [],
              selectedAmount: 0,
              supervisorIdentifier: "",
              supervisorPassword: "",
            });
            setModalState({
              open: false,
              mode: "request",
              payment: null,
              draft: null,
              autoOpenConfirm: false,
            });
          }}
        />
      ) : null}

      {reprintData ? <PaymentReceipt {...reprintData} /> : null}
    </div>
  );
}
