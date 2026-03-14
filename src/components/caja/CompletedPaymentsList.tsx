import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import PaymentReversalModal, { type ReversalPaymentData } from "@/components/caja/PaymentReversalModal";
import PaymentStatusBadge from "@/components/caja/PaymentStatusBadge";
import type { CompletedPayment, CompletedPaymentsFilters, CompletedPaymentsMethodSummary, PaymentMethod } from "@/hooks/useCaja";
import { canManage, canOperate, type PermissionMap } from "@/lib/permissions";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  CreditCard,
  Download,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react";

type ActionType = "approve" | "reject";

interface PaymentGroup {
  paymentId: string;
  created_at: string;
  cashier_name: string;
  amount: number;
  status: CompletedPayment["status"];
  notes: string | null;
  method_name: string;
  reversal_requested: boolean;
  order: {
    id: string;
    number: number;
    code: string | null;
    type: "DINE_IN" | "TAKEOUT";
    table_name: string | null;
    split_code: string | null;
    total: number;
    paid: number;
    pending: number;
    status: string;
  };
  items: {
    id: string;
    paymentEntryId: string;
    product_name: string;
    quantity: number;
    amount: number;
    method_name: string;
    status: CompletedPayment["status"];
  }[];
}

interface Props {
  payments: CompletedPayment[];
  total: number;
  methodSummary: CompletedPaymentsMethodSummary[];
  collectedTotal: number;
  paymentMethods: PaymentMethod[];
  loading?: boolean;
  filters: CompletedPaymentsFilters;
  permissions: PermissionMap;
  actionLoading?: boolean;
  cashierReverseWindowMinutes: number;
  onFiltersChange: (next: CompletedPaymentsFilters) => void;
  onRequestReversal: (paymentId: string, reason: string, paymentEntryIds?: string[]) => Promise<void>;
  onReversePayment: (paymentId: string, reason: string, paymentEntryIds?: string[]) => Promise<void>;
  onApproveReversal: (paymentId: string, approve: boolean, reason: string, paymentEntryIds?: string[]) => Promise<void>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function exportCsv(rows: CompletedPayment[]) {
  const header = ["Fecha", "Hora", "Orden", "Tipo", "Mesa/Split", "Metodo", "Item", "Monto", "Estado", "Cajero"];
  const csvRows = rows.map((row) => {
    const date = new Date(row.created_at);
    const fecha = date.toLocaleDateString("es-EC");
    const hora = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    const orden = row.order_code ?? `#${row.order_number}`;
    const tipo = row.order_type;
    const mesaSplit = row.split_code ?? row.table_name ?? "Para llevar";
    const metodo = row.method_name;
    const item = row.item_description ?? "";
    const monto = row.amount.toFixed(2);
    const estado = row.status;
    const cajero = row.cashier_name;
    return [fecha, hora, orden, tipo, mesaSplit, metodo, item, monto, estado, cajero]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",");
  });

  const csvContent = [header.join(","), ...csvRows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateLabel = new Date().toISOString().slice(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `pagos-realizados-${dateLabel}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function canCashierReverseDirectly(createdAt: string, windowMinutes: number): boolean {
  const minutes = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60);
  return minutes <= windowMinutes;
}

function getPermissionFlags(permissions: PermissionMap) {
  const canOperateCaja = canOperate(permissions, "caja");
  const canManageAdmin = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");

  return {
    canOperateCaja,
    canManageAdmin,
    canRequestReversal: canOperateCaja || canManageAdmin,
    canApproveReversal: canManageAdmin,
  };
}

export default function CompletedPaymentsList({
  payments,
  total,
  methodSummary,
  collectedTotal,
  paymentMethods,
  loading = false,
  filters,
  permissions,
  cashierReverseWindowMinutes,
  actionLoading = false,
  onFiltersChange,
  onRequestReversal,
  onReversePayment,
  onApproveReversal,
}: Props) {
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{ open: boolean; mode: "request" | "execute"; payment: ReversalPaymentData | null }>({
    open: false,
    mode: "request",
    payment: null,
  });
  const [actionDialog, setActionDialog] = useState<{ open: boolean; type: ActionType; paymentId: string | null; paymentEntryIds: string[] }>({
    open: false,
    type: "approve",
    paymentId: null,
    paymentEntryIds: [],
  });
  const [actionReason, setActionReason] = useState("");

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
          order: {
            id: row.order_id,
            number: row.order_number,
            code: row.order_code,
            type: row.order_type,
            table_name: row.table_name,
            split_code: row.split_code,
            total: row.order_total,
            paid: row.order_paid_amount,
            pending: row.order_pending_amount,
            status: row.order_status,
          },
          items: [],
        });
      }

      map.get(row.id)!.items.push({
        id: row.item_id ?? row.id,
        paymentEntryId: row.id,
        product_name: row.item_description ?? "Item no especificado",
        quantity: row.item_paid_quantity ?? row.item_quantity ?? 1,
        amount: row.item_amount,
        method_name: row.method_name,
        status: row.status,
      });
    }

    return Array.from(map.values());
  }, [payments]);

  const orderSummaries = useMemo(() => {
    const map = new Map<string, PaymentGroup["order"]>();
    for (const payment of groupedPayments) {
      if (!map.has(payment.order.id)) {
        map.set(payment.order.id, payment.order);
      }
    }
    return Array.from(map.values());
  }, [groupedPayments]);

  const selectedOrder = useMemo(() => {
    if (orderSummaries.length === 0) return null;
    const resolvedOrderId = selectedOrderId ?? orderSummaries[0].id;
    return orderSummaries.find((order) => order.id === resolvedOrderId) ?? orderSummaries[0];
  }, [orderSummaries, selectedOrderId]);

  const filteredGroups = useMemo(() => {
    if (!selectedOrder) return groupedPayments;
    return groupedPayments.filter((group) => group.order.id === selectedOrder.id);
  }, [groupedPayments, selectedOrder]);

  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const currentPage = Math.min(filters.page, totalPages);

  const setFilter = (next: Partial<CompletedPaymentsFilters>) => {
    onFiltersChange({ ...filters, ...next, page: next.page ?? 1 });
  };

  const setPage = (page: number) => {
    onFiltersChange({ ...filters, page: Math.max(1, Math.min(page, totalPages)) });
  };

  const openModalForPayment = (payment: PaymentGroup, mode: "request" | "execute") => {
    const methods = [...new Set(payment.items.map((item) => item.method_name))].join(", ");
    const tableLabel = payment.order.type === "TAKEOUT" ? "Para llevar" : payment.order.split_code ?? payment.order.table_name ?? "Mesa";

    setModalState({
      open: true,
      mode,
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
          amount: item.amount,
          methodName: item.method_name,
          status: item.status,
        })),
      },
    });
  };

  const closeAction = () => {
    setActionDialog({ open: false, type: "approve", paymentId: null, paymentEntryIds: [] });
    setActionReason("");
  };

  const executeAction = async () => {
    if (!actionDialog.paymentId || !actionReason.trim()) return;
    await onApproveReversal(actionDialog.paymentId, actionDialog.type === "approve", actionReason, actionDialog.paymentEntryIds);
    closeAction();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-[24px] border border-violet-200 bg-gradient-to-r from-white via-violet-50/70 to-white p-4 shadow-[0_18px_45px_-38px_rgba(139,92,246,0.65)]">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <input value={filters.orderQuery} onChange={(e) => setFilter({ orderQuery: e.target.value })} placeholder="Buscar por orden o mesa" className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm" />
          <select value={filters.methodId} onChange={(e) => setFilter({ methodId: e.target.value })} className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm">
            <option value="ALL">Todos los metodos</option>
            {paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>{method.name}</option>
            ))}
          </select>
          <input type="datetime-local" value={filters.fromDateTime} onChange={(e) => setFilter({ fromDateTime: e.target.value })} className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm" />
          <input type="datetime-local" value={filters.toDateTime} onChange={(e) => setFilter({ toDateTime: e.target.value })} className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm" />
        </div>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <select value={filters.sortBy} onChange={(e) => setFilter({ sortBy: e.target.value as CompletedPaymentsFilters["sortBy"] })} className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm">
            <option value="created_at">Ordenar por fecha</option>
            <option value="amount">Ordenar por monto</option>
          </select>
          <select value={filters.sortDir} onChange={(e) => setFilter({ sortDir: e.target.value as CompletedPaymentsFilters["sortDir"] })} className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm">
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>
          <select value={String(filters.pageSize)} onChange={(e) => setFilter({ pageSize: Number(e.target.value) })} className="h-10 rounded-2xl border border-violet-200 bg-white/90 px-3 text-sm shadow-sm">
            <option value="10">10 por pagina</option>
            <option value="20">20 por pagina</option>
            <option value="50">50 por pagina</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Total DB: {total} pago(s) - Pagina {currentPage} de {totalPages}</p>
          <button onClick={() => exportCsv(payments)} disabled={payments.length === 0} className="flex h-9 items-center gap-1.5 rounded-2xl border border-violet-200 bg-white/90 px-3 text-xs font-semibold shadow-sm disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Exportar CSV (pagina)
          </button>
        </div>
      </div>

      {methodSummary.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-bold text-foreground">Cobrado por metodo</h3>
              <p className="text-xs text-muted-foreground">Resumen segun los filtros actuales.</p>
            </div>
            <div className="w-full sm:w-[280px]">
              <MetricCard title="Total cobrado" value={`$${collectedTotal.toFixed(2)}`} description="Resumen segun filtros activos" icon={<CreditCard className="h-5 w-5" />} tone="emerald" className="py-2.5" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {methodSummary.map((method) => (
              <MetricCard
                key={method.methodId}
                title={method.methodName}
                value={`$${method.amount.toFixed(2)}`}
                description="Cobrado por este metodo"
                badge={`${method.paymentCount} pago(s)`}
                icon={<CreditCard className="h-5 w-5" />}
                tone="violet"
                className="py-3"
              />
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Consultando pagos realizados...</p>
        </div>
      ) : groupedPayments.length === 0 ? (
        <div className="py-10 text-center">
          <CreditCard className="mx-auto mb-2 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Sin pagos para los filtros consultados</p>
        </div>
      ) : (
        <>
          {selectedOrder && (
            <div className="space-y-3 rounded-[24px] border border-violet-200 bg-gradient-to-r from-white via-violet-50/55 to-white p-4 shadow-[0_18px_45px_-38px_rgba(139,92,246,0.55)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-bold text-foreground">Resumen de cuenta</h3>
                <select value={selectedOrder.id} onChange={(e) => setSelectedOrderId(e.target.value)} className="h-9 rounded-2xl border border-violet-200 bg-white/90 px-3 text-xs shadow-sm">
                  {orderSummaries.map((order) => (
                    <option key={order.id} value={order.id}>{order.code ?? `#${order.number}`} - {order.split_code ?? order.table_name ?? "Para llevar"}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard title="Orden" value={selectedOrder.code ?? `#${selectedOrder.number}`} description="Cuenta seleccionada" icon={<History className="h-5 w-5" />} tone="slate" className="py-2.5" />
                <MetricCard title="Mesa" value={selectedOrder.split_code ?? selectedOrder.table_name ?? "Para llevar"} description="Origen de la orden" icon={selectedOrder.type === "TAKEOUT" ? <ShoppingBag className="h-5 w-5" /> : <UtensilsCrossed className="h-5 w-5" />} tone="sky" className="py-2.5" />
                <MetricCard title="Total cuenta" value={`$${selectedOrder.total.toFixed(2)}`} description="Importe completo" icon={<CreditCard className="h-5 w-5" />} tone="violet" className="py-2.5" />
                <MetricCard title="Total pagado" value={`$${selectedOrder.paid.toFixed(2)}`} description="Pagos aplicados" icon={<ShieldCheck className="h-5 w-5" />} tone="emerald" className="py-2.5" />
                <MetricCard title="Saldo pendiente" value={`$${selectedOrder.pending.toFixed(2)}`} description="Monto aun por cobrar" icon={<Clock3 className="h-5 w-5" />} tone="amber" className="py-2.5" />
              </div>
            </div>
          )}

          <div className="space-y-2">
            {filteredGroups.map((payment) => {
              const expanded = expandedPaymentId === payment.paymentId;
              const label = payment.order.type === "TAKEOUT" ? "Para llevar" : payment.order.split_code ?? payment.order.table_name ?? "Mesa";
              const blockedByState = payment.status === "REVERSED" || payment.status === "VOIDED";
              const withinWindow = canCashierReverseDirectly(payment.created_at, cashierReverseWindowMinutes);
              const canExecute = permissionFlags.canManageAdmin || (permissionFlags.canOperateCaja && withinWindow);
              const canRequest = permissionFlags.canRequestReversal && !canExecute;
              const entryIds = payment.items.map((item) => item.paymentEntryId);

              return (
                <div key={payment.paymentId} className="space-y-2 rounded-[24px] border border-violet-200 bg-gradient-to-r from-white via-violet-50/45 to-white p-3 shadow-[0_16px_40px_-36px_rgba(139,92,246,0.55)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-violet-200 bg-white/90 shadow-sm">
                      {payment.order.type === "TAKEOUT" ? <ShoppingBag className="h-4 w-4 text-violet-600" /> : <UtensilsCrossed className="h-4 w-4 text-violet-600" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-foreground">{label}</span>
                        <Badge variant="secondary" className="text-[10px]">{payment.order.code ?? `#${payment.order.number}`}</Badge>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        <Clock3 className="h-3 w-3" /> {formatDateTime(payment.created_at)}
                        <span>- Cajero: {payment.cashier_name}</span>
                        <span>- Metodo: {payment.method_name}</span>
                      </p>
                    </div>
                    <div className="rounded-2xl border border-violet-200 bg-white/90 px-3 py-2 shadow-sm">
                      <span className="font-display text-base font-black text-foreground">${payment.amount.toFixed(2)}</span>
                    </div>
                    <button onClick={() => setExpandedPaymentId(expanded ? null : payment.paymentId)} className="flex h-9 w-9 items-center justify-center rounded-2xl border border-violet-200 bg-white/90 shadow-sm" title="Ver detalle">
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>

                  {expanded && (
                    <div className="space-y-2 rounded-2xl border border-violet-200 bg-white/80 p-3">
                      <p className="text-xs font-medium text-muted-foreground">Items cubiertos</p>
                      <div className="space-y-1">
                        {payment.items.map((item) => (
                          <div key={item.id + item.paymentEntryId} className="grid grid-cols-1 gap-2 rounded-2xl border border-violet-100 bg-violet-50/45 p-3 text-sm md:grid-cols-5">
                            <span className="font-medium text-foreground">{item.product_name}</span>
                            <span className="text-muted-foreground">Cant: {item.quantity}</span>
                            <span className="text-muted-foreground">Metodo: {item.method_name}</span>
                            <span className="text-muted-foreground">Estado: {item.status}</span>
                            <span className="text-right font-semibold">${item.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {!blockedByState && canExecute && (
                          <button className="flex h-8 items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-medium text-red-700" onClick={() => openModalForPayment(payment, "execute")}>
                            <RotateCcw className="h-3.5 w-3.5" />
                            {permissionFlags.canManageAdmin ? "Ejecutar reverso" : "Reversar pago"}
                          </button>
                        )}

                        {!blockedByState && canRequest && (
                          <button className="flex h-8 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-medium text-amber-700" onClick={() => openModalForPayment(payment, "request")}>
                            <RotateCcw className="h-3.5 w-3.5" /> Solicitar reverso
                          </button>
                        )}

                        {permissionFlags.canApproveReversal && payment.reversal_requested && payment.status !== "REVERSED" && (
                          <>
                            <button className="flex h-8 items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-3 text-xs font-medium text-green-700" onClick={() => setActionDialog({ open: true, type: "approve", paymentId: payment.paymentId, paymentEntryIds: entryIds })}>
                              <ShieldCheck className="h-3.5 w-3.5" /> Aprobar reverso
                            </button>
                            <button className="flex h-8 items-center gap-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-xs font-medium text-gray-700" onClick={() => setActionDialog({ open: true, type: "reject", paymentId: payment.paymentId, paymentEntryIds: entryIds })}>
                              <History className="h-3.5 w-3.5" /> Rechazar solicitud
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className="h-9 rounded-2xl border border-violet-200 bg-white/90 px-4 text-xs font-semibold shadow-sm disabled:opacity-50">Anterior</button>
            <button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= totalPages} className="h-9 rounded-2xl border border-violet-200 bg-white/90 px-4 text-xs font-semibold shadow-sm disabled:opacity-50">Siguiente</button>
          </div>
        </>
      )}

      <PaymentReversalModal
        open={modalState.open}
        onOpenChange={(open) => setModalState((prev) => ({ ...prev, open }))}
        mode={modalState.mode}
        payment={modalState.payment}
        loading={actionLoading}
        allowPartial={true}
        titleOverride={modalState.mode === "request" ? "Solicitar reverso" : undefined}
        onSubmit={async ({ paymentId, reason, paymentEntryIds }) => {
          if (modalState.mode === "request") {
            await onRequestReversal(paymentId, reason, paymentEntryIds);
            return;
          }
          await onReversePayment(paymentId, reason, paymentEntryIds);
        }}
      />

      <Dialog open={actionDialog.open} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionDialog.type === "approve" ? "Aprobar solicitud de reverso" : "Rechazar solicitud de reverso"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Ingresa una observacion obligatoria para continuar.</p>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Motivo..." rows={4} />
          </div>
          <DialogFooter>
            <button onClick={closeAction} className="h-9 rounded-lg border border-border px-3 text-sm" disabled={actionLoading}>Cancelar</button>
            <button onClick={executeAction} disabled={actionLoading || !actionReason.trim()} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
