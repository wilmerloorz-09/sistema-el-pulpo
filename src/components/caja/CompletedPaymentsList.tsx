import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DenominationVisual from "@/components/caja/DenominationVisual";
import PaymentReversalModal, { type ReversalPaymentData } from "@/components/caja/PaymentReversalModal";
import SupervisorAuthorizationDialog from "@/components/caja/SupervisorAuthorizationDialog";
import PaymentStatusBadge from "@/components/caja/PaymentStatusBadge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import QRCode from "qrcode";
import type {
  CashRefundDenomInput,
  CashShiftCaptureCandidate,
  CompletedPayment,
  CompletedPaymentsFilters,
  CompletedPaymentsScope,
  PaymentVoidSelectionInput,
  ShiftDenom,
} from "@/hooks/useCaja";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { roundMoney } from "@/lib/paymentQuantity";
import { canManage, canOperate, type PermissionMap } from "@/lib/permissions";
import { printPaymentReceipt } from "@/lib/thermalPrint";
import type { PaymentReceiptData } from "@/lib/paymentReceiptData";
import PaymentReceipt from "@/components/caja/PaymentReceipt";
import { ChevronDown, ChevronUp, Clock3, CreditCard, Loader2, ReceiptText, RotateCcw, ShoppingBag, UserRound, UtensilsCrossed, Printer, ScanSearch, Undo2, Info } from "lucide-react";

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
  payment_opening_status: CompletedPayment["payment_opening_status"];
  cash_received_detail: CompletedPayment["cash_received_detail"];
  cash_change_detail: CompletedPayment["cash_change_detail"];
  cash_refund_detail: CompletedPayment["cash_refund_detail"];
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
  ) => Promise<{ requestId: string }>;
  onVoidWithSupervisor: (
    paymentId: string,
    requestId: string,
    reason: string,
    supervisorIdentifier: string,
    supervisorPassword: string,
    paymentSelections: PaymentVoidSelectionInput[],
    cashRefundDenoms: CashRefundDenomInput[],
  ) => Promise<void>;
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
    selectedAmount: 0,
    supervisorIdentifier: "",
    supervisorPassword: "",
  });
  const [changeDetailState, setChangeDetailState] = useState<{
    open: boolean;
    title: string;
    showReceived: boolean;
    receivedAmount: number;
    receivedLines: CompletedPayment["cash_received_detail"];
    changeLines: CompletedPayment["cash_change_detail"];
    refundLines: CompletedPayment["cash_refund_detail"];
    undocumentedChange: number;
  }>({
    open: false,
    title: "Detalle de cambio",
    showReceived: true,
    receivedAmount: 0,
    receivedLines: [],
    changeLines: [],
    refundLines: [],
    undocumentedChange: 0,
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
          payment_opening_status: row.payment_opening_status,
          cash_received_detail: row.cash_received_detail,
          cash_change_detail: row.cash_change_detail,
          cash_refund_detail: row.cash_refund_detail,
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

    // Calculate the most recent activity timestamp for each order group (by order.id, code or number)
    const latestActivityByOrder = new Map<string, number>();
    for (const payment of grouped) {
      const orderKey = payment.order.id || payment.order.code || String(payment.order.number);
      const paymentTime = new Date(payment.created_at).getTime();
      const currentMax = latestActivityByOrder.get(orderKey) ?? 0;
      if (paymentTime > currentMax) {
        latestActivityByOrder.set(orderKey, paymentTime);
      }
    }

    return grouped.sort((a, b) => {
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

  const handleDiagnostics = async (payment: PaymentGroup) => {
    try {
      const { data: order } = await supabase
        .from("orders")
        .select("id, status, paid_at, order_type, total")
        .eq("id", payment.order.id)
        .single();

      const { data: items } = await supabase
        .from("order_items")
        .select("id, description_snapshot, quantity, paid_at, status")
        .eq("order_id", payment.order.id);

      const { data: payments } = await supabase
        .from("payments")
        .select("id, amount, notes, created_at")
        .eq("order_id", payment.order.id);

      const paymentIds = (payments ?? []).map(p => p.id);
      let paymentItems: any[] = [];
      if (paymentIds.length > 0) {
        const { data: pi } = await supabase
          .from("payment_items")
          .select("id, payment_id, order_item_id, quantity_paid, total_amount")
          .in("payment_id", paymentIds);
        paymentItems = pi ?? [];
      }

      const { data: snapshot } = await supabase
        .rpc("get_order_operational_snapshot" as any, { p_order_id: payment.order.id });

      const report = {
        order,
        items,
        payments,
        paymentItems,
        snapshot
      };

      console.log("DIAGNOSTICS REPORT:", report);
      alert(JSON.stringify(report, null, 2));
    } catch (e: any) {
      alert("Error en diagnóstico: " + e.message);
    }
  };

  const handleReprint = async (payment: PaymentGroup) => {
    let token_promocion: string | null = null;
    let qrCodeDataUrl: string | null = null;
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

          // @ts-ignore - The join works but types might not be perfectly inferred
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

    if (token_promocion) {
      try {
        const url = `https://sistema-el-pulpo.vercel.app/promociones/registro?t=${token_promocion}`;
        qrCodeDataUrl = await QRCode.toDataURL(url, { width: 120, margin: 1 });
      } catch (qrErr) {
        console.error("Error generating QR code for reprint:", qrErr);
      }
    }

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
      token_promocion,
      qrCodeDataUrl,
      clienteCedula,
      clienteNombre,
    };

    setReprintData(receipt);
    alert(`DEBUG REPRINT: token = ${token_promocion}, status = ${dbOrder?.status}, paid_at = ${dbOrder?.paid_at}, qr = ${qrCodeDataUrl ? "OK" : "null"}`);
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
                <option value={currentUserId}>Mi caja</option>
              )}
              {cashierUsers
                .filter((u) => u.id !== currentUserId)
                .map((cashier) => (
                <option key={cashier.id} value={cashier.id}>
                  {cashier.full_name} @{cashier.username}
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
              const blockedByState = isVoidedOrReversed || payment.reversal_requested || blockedByClosedOpening;
              const itemsLabel = `${payment.items.length} ${payment.items.length === 1 ? "item" : "items"}`;
              const groupCash = cashAggregateByGroupId.get(payment.paymentGroupId) ?? {
                receivedAmount: getReceivedAmount(payment),
                receivedLines: payment.cash_received_detail,
                changeLines: payment.cash_change_detail,
                refundLines: payment.cash_refund_detail,
                undocumentedChange: (() => {
                  const t = payment.tendered_amount ?? 0;
                  const impl = roundMoney(Math.max(0, t - payment.amount));
                  const fromDen = sumDetailLines(payment.cash_change_detail);
                  return roundMoney(Math.max(0, impl - fromDen));
                })(),
              };
              const hasCashTrace =
                groupCash.receivedAmount > 0.005
                || groupCash.receivedLines.length > 0
                || groupCash.changeLines.length > 0
                || groupCash.refundLines.length > 0
                || groupCash.undocumentedChange > 0.005;
              const rowChangeTitle = isVoidedOrReversed
                ? "Detalle de devolucion"
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
                      {hasCashTrace && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setChangeDetailState({
                              open: true,
                              title: rowChangeTitle,
                              showReceived: !isVoidedOrReversed,
                              receivedAmount: groupCash.receivedAmount,
                              receivedLines: groupCash.receivedLines,
                              changeLines: groupCash.changeLines,
                              refundLines: groupCash.refundLines,
                              undocumentedChange: groupCash.undocumentedChange,
                            });
                          }}
                          className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-cyan-400 text-white shadow-[0_4px_14px_0_rgba(6,182,212,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(6,182,212,0.23)] active:scale-95"
                          title="Ver detalle de efectivo"
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
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDiagnostics(payment);
                        }}
                        className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-400 text-white shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] active:scale-95"
                        title="Ver diagnóstico de base de datos"
                      >
                        <Info className="h-5 w-5 transition-transform group-hover/btn:scale-110" />
                      </button>
                      {!blockedByState && permissionFlags.canStartVoid && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openModalForPayment(payment);
                          }}
                          className="group/btn flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-rose-600 to-orange-400 text-white shadow-[0_4px_14px_0_rgba(225,29,72,0.39)] transition-all hover:scale-110 hover:shadow-[0_6px_20px_rgba(225,29,72,0.23)] active:scale-95"
                          title="Anular pago"
                        >
                          <Undo2 className="h-5 w-5 transition-transform group-hover/btn:-rotate-45" />
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
        <DialogContent className="max-w-[calc(100vw-1rem)] rounded-[24px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{changeDetailState.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {changeDetailState.showReceived && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-950">Total recibido del cliente</span>
                  <span className="text-lg font-bold text-emerald-700">{formatCurrency(changeDetailState.receivedAmount)}</span>
                </div>
                {changeDetailState.receivedLines.length === 0 && (
                  <p className="mt-1 text-xs font-medium text-emerald-800/70">
                    {changeDetailState.changeLines.length > 0
                      ? "Sin efectivo recibido en caja desglosado (p. ej. transferencia). Si hubo cambio en efectivo, se muestra abajo."
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
                  <span className="text-sm font-semibold text-slate-950">Cambio entregado al cliente</span>
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

            {changeDetailState.refundLines.length > 0 && (
              <div className="rounded-2xl border border-red-200 bg-red-50/60 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-950">Devuelto al cliente</span>
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
          onSubmit={async ({ paymentId, reason, paymentSelections, cashRefundDenoms, refundAmount }) => {
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
                );
                setModalState({ open: false, mode: "request", payment: null, draft: null, autoOpenConfirm: false });
                setPendingAuthorization({
                  open: false,
                  requestId: null,
                  payment: null,
                  reason: "",
                  paymentSelections: [],
                  cashRefundDenoms: [],
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
            );

            setPendingAuthorization({
              open: false,
              requestId: null,
              payment: null,
              reason: "",
              paymentSelections: [],
              cashRefundDenoms: [],
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
