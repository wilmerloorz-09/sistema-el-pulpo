import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import PaymentReversalModal, { type ReversalPaymentData } from "@/components/caja/PaymentReversalModal";
import type { CompletedPayment, CompletedPaymentsFilters, PaymentMethod } from "@/hooks/useCaja";
import type { Database } from "@/integrations/supabase/types";
import PaymentStatusBadge from "@/components/caja/PaymentStatusBadge";
import {
  CreditCard,
  ShoppingBag,
  UtensilsCrossed,
  Clock3,
  Download,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ShieldCheck,
  History,
  Loader2,
} from "lucide-react";

type AppRole = Database["public"]["Enums"]["app_role"];

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
  paymentMethods: PaymentMethod[];
  loading?: boolean;
  filters: CompletedPaymentsFilters;
  activeRole: AppRole | null;
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

function getRolePermissions(role: AppRole | null) {
  const isCashier = role === "cajero";
  const isSupervisor = role === "admin" || role === "superadmin";

  return {
    isCashier,
    isSupervisor,
    canRequestReversal: isCashier || isSupervisor,
    canApproveReversal: isSupervisor,
  };
}

function canCashierReverseDirectly(createdAt: string, windowMinutes: number): boolean {
  const minutes = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60);
  return minutes <= windowMinutes;
}

export default function CompletedPaymentsList({
  payments,
  total,
  paymentMethods,
  loading = false,
  filters,
  activeRole,
  cashierReverseWindowMinutes,
  actionLoading = false,
  onFiltersChange,
  onRequestReversal,
  onReversePayment,
  onApproveReversal,
}: Props) {
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [modalState, setModalState] = useState<{
    open: boolean;
    mode: "request" | "execute";
    payment: ReversalPaymentData | null;
  }>({ open: false, mode: "request", payment: null });

  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    type: ActionType;
    paymentId: string | null;
    paymentEntryIds: string[];
  }>({ open: false, type: "approve", paymentId: null, paymentEntryIds: [] });
  const [actionReason, setActionReason] = useState("");

  const permissions = getRolePermissions(activeRole);

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

      const target = map.get(row.id)!;
      target.items.push({
        id: row.item_id ?? row.id,
        paymentEntryId: row.payment_item_id ?? row.id,
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
    const tableLabel =
      payment.order.type === "TAKEOUT"
        ? "Para llevar"
        : payment.order.split_code ?? payment.order.table_name ?? "Mesa";

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

  const openActionDialog = (type: ActionType, paymentId: string, paymentEntryIds: string[]) => {
    setActionReason("");
    setActionDialog({ open: true, type, paymentId, paymentEntryIds });
  };

  const closeAction = () => {
    setActionDialog({ open: false, type: "approve", paymentId: null, paymentEntryIds: [] });
    setActionReason("");
  };

  const executeAction = async () => {
    if (!actionDialog.paymentId || !actionReason.trim()) return;

    if (actionDialog.type === "approve") {
      await onApproveReversal(actionDialog.paymentId, true, actionReason, actionDialog.paymentEntryIds);
    }
    if (actionDialog.type === "reject") {
      await onApproveReversal(actionDialog.paymentId, false, actionReason, actionDialog.paymentEntryIds);
    }

    closeAction();
  };

  const actionTitleMap: Record<ActionType, string> = {
    approve: "Aprobar solicitud de reverso",
    reject: "Rechazar solicitud de reverso",
  };

  const handleModalSubmit = async (params: {
    paymentId: string;
    reason: string;
    paymentEntryIds: string[];
  }) => {
    if (modalState.mode === "request") {
      await onRequestReversal(params.paymentId, params.reason, params.paymentEntryIds);
      return;
    }
    await onReversePayment(params.paymentId, params.reason, params.paymentEntryIds);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border p-3 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            value={filters.orderQuery}
            onChange={(e) => setFilter({ orderQuery: e.target.value })}
            placeholder="Buscar por orden o mesa"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          />

          <select
            value={filters.methodId}
            onChange={(e) => setFilter({ methodId: e.target.value })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="ALL">Todos los metodos</option>
            {paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.name}
              </option>
            ))}
          </select>

          <input
            type="datetime-local"
            value={filters.fromDateTime}
            onChange={(e) => setFilter({ fromDateTime: e.target.value })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          />

          <input
            type="datetime-local"
            value={filters.toDateTime}
            onChange={(e) => setFilter({ toDateTime: e.target.value })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={filters.sortBy}
            onChange={(e) => setFilter({ sortBy: e.target.value as CompletedPaymentsFilters["sortBy"] })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="created_at">Ordenar por fecha</option>
            <option value="amount">Ordenar por monto</option>
          </select>

          <select
            value={filters.sortDir}
            onChange={(e) => setFilter({ sortDir: e.target.value as CompletedPaymentsFilters["sortDir"] })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="desc">Descendente</option>
            <option value="asc">Ascendente</option>
          </select>

          <select
            value={String(filters.pageSize)}
            onChange={(e) => setFilter({ pageSize: Number(e.target.value) })}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
          >
            <option value="10">10 por pagina</option>
            <option value="20">20 por pagina</option>
            <option value="50">50 por pagina</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Total DB: {total} pago(s) - Pagina {currentPage} de {totalPages}
          </p>
          <button
            onClick={() => exportCsv(payments)}
            disabled={payments.length === 0}
            className="h-8 px-3 rounded-lg border border-border text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> Exportar CSV (pagina)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Consultando pagos realizados...</p>
        </div>
      ) : groupedPayments.length === 0 ? (
        <div className="text-center py-10">
          <CreditCard className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm font-medium text-muted-foreground">Sin pagos para los filtros consultados</p>
        </div>
      ) : (
        <>
          {selectedOrder && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-display text-sm font-bold text-foreground">Resumen de cuenta</h3>
                <select
                  value={selectedOrder.id}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs"
                >
                  {orderSummaries.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.code ?? `#${order.number}`} - {order.split_code ?? order.table_name ?? "Para llevar"}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">Orden</p>
                  <p className="font-semibold">{selectedOrder.code ?? `#${selectedOrder.number}`}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">Mesa</p>
                  <p className="font-semibold">{selectedOrder.split_code ?? selectedOrder.table_name ?? "Para llevar"}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-xs text-muted-foreground">Total cuenta</p>
                  <p className="font-semibold">${selectedOrder.total.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-green-50 p-2">
                  <p className="text-xs text-muted-foreground">Total pagado</p>
                  <p className="font-semibold text-green-700">${selectedOrder.paid.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-amber-50 p-2">
                  <p className="text-xs text-muted-foreground">Saldo pendiente</p>
                  <p className="font-semibold text-amber-700">${selectedOrder.pending.toFixed(2)}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {filteredGroups.map((payment) => {
              const expanded = expandedPaymentId === payment.paymentId;
              const label =
                payment.order.type === "TAKEOUT"
                  ? "Para llevar"
                  : payment.order.split_code ?? payment.order.table_name ?? "Mesa";

              const blockedByState = payment.status === "REVERSED" || payment.status === "VOIDED";
              const withinWindow = canCashierReverseDirectly(payment.created_at, cashierReverseWindowMinutes);
              const canExecuteByRole = permissions.isSupervisor || (permissions.isCashier && withinWindow);
              const canRequestByRole = permissions.canRequestReversal && !canExecuteByRole;
              const entryIds = payment.items.map((item) => item.paymentEntryId);

              return (
                <div key={payment.paymentId} className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {payment.order.type === "TAKEOUT" ? (
                        <ShoppingBag className="h-4 w-4 text-primary" />
                      ) : (
                        <UtensilsCrossed className="h-4 w-4 text-primary" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">{label}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {payment.order.code ?? `#${payment.order.number}`}
                        </Badge>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                        <Clock3 className="h-3 w-3" /> {formatDateTime(payment.created_at)}
                        <span>- Cajero: {payment.cashier_name}</span>
                        <span>- Metodo: {payment.method_name}</span>
                      </p>
                    </div>

                    <span className="font-display text-base font-bold text-foreground">${payment.amount.toFixed(2)}</span>

                    <button
                      onClick={() => setExpandedPaymentId(expanded ? null : payment.paymentId)}
                      className="h-8 w-8 rounded-lg border border-border flex items-center justify-center"
                      title="Ver detalle"
                    >
                      {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>

                  {expanded && (
                    <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Items cubiertos</p>
                      <div className="space-y-1">
                        {payment.items.map((item) => (
                          <div key={item.id + item.paymentEntryId} className="grid grid-cols-1 md:grid-cols-5 gap-2 text-sm rounded-md bg-background p-2 border border-border">
                            <span className="font-medium text-foreground">{item.product_name}</span>
                            <span className="text-muted-foreground">Cant: {item.quantity}</span>
                            <span className="text-muted-foreground">Metodo: {item.method_name}</span>
                            <span className="text-muted-foreground">Estado: {item.status}</span>
                            <span className="font-semibold text-right">${item.amount.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {!blockedByState && canExecuteByRole && (
                          <button
                            className="h-8 px-3 rounded-lg border border-red-300 bg-red-50 text-red-700 text-xs font-medium flex items-center gap-1"
                            onClick={() => openModalForPayment(payment, "execute")}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            {permissions.isSupervisor ? "Ejecutar reverso" : "Reversar pago"}
                          </button>
                        )}

                        {!blockedByState && canRequestByRole && (
                          <button
                            className="h-8 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium flex items-center gap-1"
                            onClick={() => openModalForPayment(payment, "request")}
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Solicitar reverso
                          </button>
                        )}

                        {permissions.canApproveReversal && payment.reversal_requested && payment.status !== "REVERSED" && (
                          <>
                            <button
                              className="h-8 px-3 rounded-lg border border-green-300 bg-green-50 text-green-700 text-xs font-medium flex items-center gap-1"
                              onClick={() => openActionDialog("approve", payment.paymentId, entryIds)}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" /> Aprobar reverso
                            </button>
                            <button
                              className="h-8 px-3 rounded-lg border border-gray-300 bg-gray-50 text-gray-700 text-xs font-medium flex items-center gap-1"
                              onClick={() => openActionDialog("reject", payment.paymentId, entryIds)}
                            >
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
            <button
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="h-8 px-3 rounded-lg border border-border text-xs disabled:opacity-50"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="h-8 px-3 rounded-lg border border-border text-xs disabled:opacity-50"
            >
              Siguiente
            </button>
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
        onSubmit={handleModalSubmit}
      />

      <Dialog open={actionDialog.open} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionTitleMap[actionDialog.type]}</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Ingresa una observacion obligatoria para continuar.</p>
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Motivo..."
              rows={4}
            />
          </div>

          <DialogFooter>
            <button
              onClick={closeAction}
              className="h-9 px-3 rounded-lg border border-border text-sm"
              disabled={actionLoading}
            >
              Cancelar
            </button>
            <button
              onClick={executeAction}
              disabled={actionLoading || !actionReason.trim()}
              className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}








