import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import PaymentReversalModal, { type ReversalPaymentData } from "@/components/caja/PaymentReversalModal";
import SupervisorAuthorizationDialog from "@/components/caja/SupervisorAuthorizationDialog";
import PaymentStatusBadge from "@/components/caja/PaymentStatusBadge";
import type {
  CashRefundDenomInput,
  CompletedPayment,
  CompletedPaymentsFilters,
  CompletedPaymentsScope,
  PaymentVoidSelectionInput,
  ShiftDenom,
} from "@/hooks/useCaja";
import { getOrderKind, getOrderOriginLabel } from "@/lib/orderPresentation";
import { canManage, canOperate, type PermissionMap } from "@/lib/permissions";
import { ChevronDown, ChevronUp, Clock3, CreditCard, Loader2, ReceiptText, RotateCcw, ShoppingBag, UtensilsCrossed } from "lucide-react";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

interface PaymentGroup {
  paymentId: string;
  created_at: string;
  cashier_name: string;
  amount: number;
  status: CompletedPayment["status"];
  notes: string | null;
  method_name: string;
  reversal_requested: boolean;
  order_has_voided_payments: boolean;
  payment_opening_status: CompletedPayment["payment_opening_status"];
  order: {
    id: string;
    number: number;
    code: string | null;
    type: "DINE_IN" | "TAKEOUT";
    is_special: boolean;
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
  }[];
}

interface Props {
  payments: CompletedPayment[];
  total: number;
  collectedTotal: number;
  loading?: boolean;
  filters: CompletedPaymentsFilters;
  permissions: PermissionMap;
  actionLoading?: boolean;
  onFiltersChange: (next: CompletedPaymentsFilters) => void;
  shiftDenoms: ShiftDenom[];
  onRequestVoid: (
    paymentId: string,
    reason: string,
    paymentSelections: PaymentVoidSelectionInput[],
    cashRefundDenoms: CashRefundDenomInput[],
  ) => Promise<string>;
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

function getPermissionFlags(permissions: PermissionMap) {
  const canOperateCaja = canOperate(permissions, "caja");
  const canManageAdmin = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");

  return {
    canOperateCaja,
    canManageAdmin,
    canStartVoid: canOperateCaja || canManageAdmin,
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

export default function CompletedPaymentsList({
  payments,
  total,
  collectedTotal,
  loading = false,
  filters,
  permissions,
  shiftDenoms,
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

  const permissionFlags = getPermissionFlags(permissions);

  const groupedPayments = useMemo<PaymentGroup[]>(() => {
    const map = new Map<string, PaymentGroup>();

    for (const row of payments) {
      const existing = map.get(row.id);
      if (!existing) {
        map.set(row.id, {
          paymentId: row.id,
          created_at: row.created_at,
          cashier_name: row.cashier_name,
          amount: row.amount,
          status: row.status,
          notes: row.notes,
          method_name: row.method_name,
          reversal_requested: row.reversal_requested,
          order_has_voided_payments: row.order_has_voided_payments,
          payment_opening_status: row.payment_opening_status,
          order: {
            id: row.order_id,
            number: row.order_number ?? 0,
            code: row.order_code,
            type: row.order_type,
            is_special: row.is_special,
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
      });
    }

    return Array.from(map.values());
  }, [payments]);

  const cashierOptions = useMemo(
    () =>
      Array.from(new Set(groupedPayments.map((payment) => payment.cashier_name).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, "es")),
    [groupedPayments],
  );

  const visiblePayments = useMemo(() => {
    if (filters.cashierName === "ALL") return groupedPayments;
    return groupedPayments.filter((payment) => payment.cashier_name === filters.cashierName);
  }, [filters.cashierName, groupedPayments]);

  const visibleTotal = visiblePayments.length;
  const visibleCollectedTotal = visiblePayments.reduce((sum, payment) => sum + payment.amount, 0);

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

    setModalState({
      open: true,
      mode: "request",
      payment: {
        paymentId: payment.paymentId,
        orderId: payment.order.id,
        orderCode: payment.order.code,
        orderNumber: payment.order.number,
        tableLabel,
        createdAt: payment.created_at,
        cashierName: payment.cashier_name,
        amount: payment.amount,
        status: payment.status,
        notes: payment.notes,
        methodsSummary: methods || payment.method_name,
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
              {cashierOptions.map((cashierName) => (
                <option key={cashierName} value={cashierName}>
                  {cashierName}
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
              const blockedByState = isVoidedOrReversed || payment.reversal_requested || payment.order_has_voided_payments || blockedByClosedOpening;
              const itemsLabel = `${payment.items.length} ${payment.items.length === 1 ? "item" : "items"}`;

              return (
                <div key={payment.paymentId} className={index % 2 === 0 ? "bg-white" : "bg-slate-100/70"}>
                  <div
                    onClick={() => setExpandedPaymentId((current) => (current === payment.paymentId ? null : payment.paymentId))}
                    className="group grid cursor-pointer gap-3 px-5 py-3.5 transition-colors hover:bg-slate-100/50 sm:grid-cols-[auto_minmax(150px,1fr)_100px_minmax(160px,0.9fr)_minmax(110px,0.7fr)_minmax(240px,1.2fr)_112px] sm:items-center sm:px-8"
                  >
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors group-hover:bg-slate-100 group-hover:text-slate-800"
                      aria-label={expanded ? "Ocultar detalle" : "Mostrar detalle"}
                    >
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                          {orderKind === "takeout" ? (
                            <ShoppingBag className="h-4 w-4" />
                          ) : orderKind === "special" ? (
                            <CreditCard className="h-4 w-4" />
                          ) : (
                            <UtensilsCrossed className="h-4 w-4" />
                          )}
                        </span>
                        <p className="truncate text-lg font-semibold tracking-[-0.02em] text-slate-950">{label}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
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

                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-bold tracking-[0.08em] text-slate-700">
                        {payment.order.code ?? `#${payment.order.number}`}
                      </p>
                    </div>

                    <div className="sm:text-right">
                      <p className="text-[1.45rem] font-semibold tracking-[-0.03em] text-slate-950">${payment.amount.toFixed(2)}</p>
                    </div>

                    <div className="min-w-0 sm:text-right">
                      <span className="inline-flex items-center gap-1 text-sm text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatDateTime(payment.created_at)}
                      </span>
                    </div>


                    <div className="sm:justify-self-end">
                      {!blockedByState && permissionFlags.canStartVoid && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openModalForPayment(payment);
                          }}
                          className="flex h-9 items-center gap-2 rounded-full border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 shadow-none hover:bg-red-100"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Anular
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

                        <div className="flex flex-wrap gap-2">
                          {!blockedByState && permissionFlags.canStartVoid && (
                            <button
                              type="button"
                              className="flex h-10 items-center gap-2 rounded-2xl border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700"
                              onClick={() => openModalForPayment(payment)}
                            >
                              <RotateCcw className="h-4 w-4" />
                              Anular pago
                            </button>
                          )}
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
          submitLabelOverride={
            modalState.mode === "request"
              ? "Solicitar autorizacion de supervisor"
              : "Confirmar anulacion"
          }
          initialDraft={modalState.draft}
          autoOpenConfirm={modalState.autoOpenConfirm}
          onSubmit={async ({ paymentId, reason, paymentSelections, cashRefundDenoms }) => {
            if (modalState.mode === "request") {
              const itemList = modalState.payment?.items ?? [];
              const selectedAmount = paymentSelections.reduce((sum, selection) => {
                const item = itemList.find((entry) => entry.paymentEntryId === selection.paymentEntryId);
                const unitAmount = item && item.quantity > 0 ? item.amount / item.quantity : 0;
                return sum + unitAmount * selection.quantity;
              }, 0);

            const requestId = await onRequestVoid(paymentId, reason, paymentSelections, cashRefundDenoms);
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
            return;
          }

            setModalState({
              open: false,
              mode: "request",
              payment: null,
            draft: null,
            autoOpenConfirm: false,
          });
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
    </div>
  );
}
