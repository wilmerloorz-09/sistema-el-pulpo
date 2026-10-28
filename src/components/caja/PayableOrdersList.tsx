import { useEffect, useState } from "react";
import type { Denomination, PayableOrder, PreparedTransferProofSession, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { ChevronDown, ChevronUp, CreditCard, Loader2, ReceiptText, RefreshCw, ShoppingBag, Soup, UtensilsCrossed, UserRound } from "lucide-react";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import { cn } from "@/lib/utils";
import PaymentDialog from "./PaymentDialog";
import PaymentDialogV2 from "./PaymentDialogV2";
import { USE_PAYMENT_DIALOG_V2 } from "@/lib/cajaPaymentUi";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

import { toast } from "sonner";

interface Props {
  orders: PayableOrder[];
  paymentMethods: { id: string; name: string }[];
  denominations: Denomination[];
  shiftDenoms: ShiftDenom[];
  onPay: (params: PayOrderParams) => Promise<any> | void;
  onPrepareTransferProof: (params: {
    orderId: string;
    paymentSplits: PayOrderParams["paymentSplits"];
    tenderedSplits: PayOrderParams["tenderedSplits"];
    isSpecial?: boolean;
  }) => Promise<PreparedTransferProofSession>;
  onDiscardPreparedTransferProof: (session: PreparedTransferProofSession) => Promise<any> | void;
  getTransferProofReadiness: (paymentIds: string[]) => Promise<{ ready: boolean; uploadedCount: number; totalCount: number }>;
  paying: boolean;
  readOnly?: boolean;
  autoOpenOrderId?: string | null;
  onAutoOpenOrderConsumed?: () => void;
  onTakeControl?: () => void;
  onRefreshPayableOrders?: () => void | Promise<void>;
  refreshingPayableOrders?: boolean;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export default function PayableOrdersList({
  orders,
  paymentMethods,
  denominations,
  shiftDenoms,
  onPay,
  onPrepareTransferProof,
  onDiscardPreparedTransferProof,
  getTransferProofReadiness,
  paying,
  readOnly = false,
  autoOpenOrderId,
  onAutoOpenOrderConsumed,
  onTakeControl,
  onRefreshPayableOrders,
  refreshingPayableOrders = false,
}: Props) {
  const [selectedOrder, setSelectedOrder] = useState<PayableOrder | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [undispatchedBlockOrder, setUndispatchedBlockOrder] = useState<PayableOrder | null>(null);

  // Eliminamos el auto-open para que sea manual y no interfiera con otros modulos
  useEffect(() => {
    if (!selectedOrder) return;

    const refreshedOrder = orders.find((order) => order.id === selectedOrder.id) ?? null;
    if (refreshedOrder) {
      setSelectedOrder(refreshedOrder);
    }
  }, [orders, selectedOrder?.id]);

  const pendingUnits = (order: PayableOrder) =>
    order.items.reduce((sum, item) => sum + item.quantity_pending, 0);

  const totalPendingAmount = orders.reduce(
    (sum, order) =>
      sum
      + (
        order.is_special
          ? order.special_pending_amount
          : order.items.reduce((orderSum, item) => orderSum + item.pending_total, 0)
      ),
    0,
  );
  const totalPendingUnits = orders.reduce((sum, order) => sum + pendingUnits(order), 0);

  return (
    <>
      <section className="space-y-4 sm:space-y-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white sm:rounded-[26px]">
          <div className="flex flex-nowrap items-center justify-between gap-2 overflow-x-auto px-2.5 py-1.5 text-[11px] sm:grid sm:grid-cols-3 sm:gap-0 sm:overflow-visible sm:px-8 sm:py-5 sm:text-sm">
            <div className="shrink-0 sm:px-4">
              <p className="inline-flex items-center gap-1 text-slate-500 sm:gap-2">
                <ReceiptText className="h-3 w-3 shrink-0 text-slate-400 sm:h-4 sm:w-4" />
                <span>
                  <span className="sm:hidden">Ordenes: </span>
                  <span className="hidden sm:inline">Ordenes por cobrar: </span>
                  <span className="font-semibold text-slate-950">{orders.length}</span>
                </span>
              </p>
            </div>
            <div className="shrink-0 sm:border-l sm:border-r sm:border-slate-200 sm:px-6">
              <p className="inline-flex items-center gap-1 text-slate-500 sm:gap-2">
                <UtensilsCrossed className="h-3 w-3 shrink-0 text-slate-400 sm:h-4 sm:w-4" />
                <span>
                  <span className="sm:hidden">Pend.: </span>
                  <span className="hidden sm:inline">Unidades pendientes: </span>
                  <span className="font-semibold text-slate-950">{totalPendingUnits}</span>
                </span>
              </p>
            </div>
            <div className="shrink-0 sm:px-6">
              <p className="inline-flex items-center gap-1 text-slate-500 sm:gap-2">
                <CreditCard className="h-3 w-3 shrink-0 text-slate-400 sm:h-4 sm:w-4" />
                <span>
                  Total: <span className="font-semibold text-slate-950">{formatCurrency(totalPendingAmount)}</span>
                </span>
              </p>
            </div>
          </div>
        </div>

        <section className="space-y-2.5 sm:space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-slate-950 sm:text-[1.5rem]">Ordenes por cobrar</h2>
              {readOnly && (
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <p className="text-sm text-slate-500">
                    Modo consulta. No puedes registrar cobros en esta sesión.
                  </p>
                  {onTakeControl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onTakeControl}
                      className="h-8 rounded-full border-amber-200 bg-amber-50 text-xs font-bold text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                    >
                      Tomar control de esta sesión
                    </Button>
                  )}
                </div>
              )}
            </div>
            {onRefreshPayableOrders && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (refreshingPayableOrders) return;
                  void onRefreshPayableOrders();
                }}
                disabled={refreshingPayableOrders}
                className="h-8 shrink-0 rounded-full border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {refreshingPayableOrders ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Actualizar
              </Button>
            )}
          </div>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-12 text-center sm:px-6 sm:py-16">
              {autoOpenOrderId ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-base font-medium text-slate-900">Preparando cuenta para cobrar...</p>
                  <p className="text-sm text-slate-500">Espera un momento mientras cargamos los items.</p>
                </div>
              ) : (
                <>
                  <p className="text-base font-medium text-slate-900">Sin ordenes por cobrar</p>
                  <p className="mt-2 text-sm text-slate-500">Cuando haya cuentas pendientes, apareceran aqui para cobrarlas rapido.</p>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4 pb-4">
              {orders.map((order, index) => {
                const label = getCajaOrderOriginLabel({
                  orderType: order.order_type,
                  tableName: order.table_name ?? order.table_name_snapshot,
                  splitCode: order.split_code,
                  isSpecial: order.is_special,
                  isTrayOrder: order.is_tray_order,
                });
                const orderKind = getOrderKind({
                  orderType: order.order_type,
                  isSpecial: order.is_special,
                  isTrayOrder: order.is_tray_order,
                });
                const pendingTotal = order.is_special
                  ? order.special_pending_amount
                  : order.items.reduce((sum, item) => sum + item.pending_total, 0);
                const rowCode = getOrderRef(order.order_code, order.order_number);
                const displayRowCode = rowCode === "Borrador" ? "Sin codigo" : rowCode;
                const isExpanded = expandedOrderId === order.id;
                const OrderKindIcon =
                  orderKind === "tray"
                    ? Soup
                    : orderKind === "takeout"
                      ? ShoppingBag
                      : orderKind === "special"
                        ? CreditCard
                        : UtensilsCrossed;

                const groupedItems = (() => {
                  const groupedMap: Record<string, (typeof order.items)[0] & { modifierQuantities: Array<{ mod: any; qty: number }> }> = {};
                  for (const item of order.items) {
                    const modKey = ((item as any).modifiers || [])
                      .map((m: any) => (m.description || "").trim().toLowerCase())
                      .sort()
                      .join("|");
                    const key = `${item.description_snapshot}_${item.unit_price}_${modKey}`;
                    const itemQty = item.quantity || 0;
                    if (!groupedMap[key]) {
                      groupedMap[key] = {
                        ...item,
                        modifierQuantities: ((item as any).modifiers || []).map((m: any) => ({ mod: m, qty: itemQty })),
                      };
                    } else {
                      groupedMap[key].quantity += item.quantity;
                      groupedMap[key].quantity_pending += item.quantity_pending;
                      groupedMap[key].pending_total += item.pending_total;
                      groupedMap[key].modifierQuantities.push(
                        ...((item as any).modifiers || []).map((m: any) => ({ mod: m, qty: itemQty })),
                      );
                    }
                  }
                  return Object.values(groupedMap);
                })();

                return (
                  <div
                    key={order.id}
                    className={cn(
                      "overflow-hidden rounded-2xl border shadow-sm transition-all",
                      isExpanded
                        ? "border-orange-300 bg-orange-50 shadow-md ring-1 ring-orange-200"
                        : cn("border-slate-200 hover:shadow-md", index % 2 === 0 ? "bg-white" : "bg-slate-100"),
                    )}
                  >
                    <div
                      onClick={() => setExpandedOrderId((current) => (current === order.id ? null : order.id))}
                      className={cn(
                        "group flex cursor-pointer flex-col gap-3 px-4 py-4 transition-colors lg:flex-row lg:items-center lg:justify-between lg:px-6",
                        isExpanded ? "hover:bg-orange-100/70" : "hover:bg-slate-50",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isExpanded
                              ? "border-orange-200 bg-white text-orange-700"
                              : "border-slate-200 bg-white text-slate-500 group-hover:bg-slate-100 group-hover:text-slate-800",
                          )}
                          aria-label={isExpanded ? "Ocultar detalle" : "Mostrar detalle"}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>

                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                            isExpanded ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600",
                          )}
                        >
                          <OrderKindIcon className="h-5 w-5" />
                        </span>

                        <div className="flex min-w-0 flex-col">
                          <p className="truncate text-[15px] font-bold tracking-[-0.01em] text-slate-950 lg:text-base">
                            {label}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-slate-500">
                            <span className="font-mono font-bold tracking-wider text-slate-700">
                              {displayRowCode}
                            </span>
                            {order.created_by_name ? (
                              <span className="flex items-center gap-1 truncate">
                                <UserRound className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{order.created_by_name}</span>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pl-11 lg:pl-0">
                        <div className="text-left lg:text-right">
                          <p className="text-lg font-black tabular-nums text-emerald-700 sm:text-2xl">
                            {formatCurrency(pendingTotal)}
                          </p>
                          {order.is_special ? (
                            <p className="text-[10px] text-slate-500 sm:text-xs">
                              Real {formatCurrency(order.special_real_total)}
                            </p>
                          ) : null}
                        </div>

                        <Button
                          type="button"
                          size="sm"
                          disabled={readOnly || order.locked_for_editing}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!order.ready_to_collect) {
                              setUndispatchedBlockOrder(order);
                              return;
                            }
                            setSelectedOrder(order);
                          }}
                          className={cn(
                            "h-10 shrink-0 gap-1.5 rounded-xl px-5 text-sm font-semibold text-white shadow-md",
                            order.ready_to_collect
                              ? "bg-emerald-600 hover:bg-emerald-700"
                              : "bg-red-600 hover:bg-red-700",
                          )}
                        >
                          <CreditCard className="h-4 w-4" />
                          Cobrar
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-orange-200/80 bg-orange-50/80">
                        <div className="hidden grid-cols-[minmax(0,1fr)_90px_120px] gap-3 border-b border-orange-200/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 sm:grid lg:px-8">
                          <span>Detalle</span>
                          <span className="text-right">Pend.</span>
                          <span className="text-right">Subtotal</span>
                        </div>
                        <div className="divide-y divide-orange-100/80">
                          {groupedItems.map((item) => {
                            const isBulkItem = item.tray_item_type === "C";
                            const qty = Math.max(0, Number(item.quantity || 0));
                            const pendingQty = Math.max(0, Number(item.quantity_pending || 0));
                            const unitPriceLabel = Number(item.unit_price ?? 0).toFixed(2);
                            const consolidatedModifiers = (() => {
                              const modCounts: Record<string, { description: string; count: number; firstId: string }> = {};
                              for (const mq of item.modifierQuantities) {
                                const desc = (mq.mod.description || "").trim();
                                if (!desc) continue;
                                const key = desc.toLowerCase();
                                if (!modCounts[key]) {
                                  modCounts[key] = { description: desc, count: mq.qty, firstId: mq.mod.id || "mod" };
                                } else {
                                  modCounts[key].count += mq.qty;
                                }
                              }
                              return Object.values(modCounts);
                            })();

                            return (
                              <div
                                key={`${item.description_snapshot}_${item.unit_price}`}
                                className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_90px_120px] sm:items-start sm:gap-3 lg:px-8"
                              >
                                <div className="min-w-0">
                                  {isBulkItem ? (
                                    <p className="break-words whitespace-normal text-lg font-semibold leading-snug text-slate-900 sm:text-xl">
                                      <span>{item.description_snapshot}</span>
                                      <span className="ml-1 font-semibold text-slate-600">({unitPriceLabel})</span>
                                    </p>
                                  ) : (
                                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words whitespace-normal text-lg font-semibold leading-snug text-slate-900 sm:text-xl">
                                      <span
                                        className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-orange-500 px-2 text-base font-bold tabular-nums text-white shadow-sm"
                                        aria-label={`Cantidad ${qty}`}
                                      >
                                        {qty}
                                      </span>
                                      <span>{item.description_snapshot}</span>
                                      <span className="font-semibold text-slate-600">({unitPriceLabel})</span>
                                    </p>
                                  )}

                                  {consolidatedModifiers.length > 0 ? (
                                    <div className="mt-1 flex flex-col gap-0.5 pl-10 text-sm font-semibold text-red-700">
                                      {consolidatedModifiers.map((mc) => (
                                        <p key={mc.firstId} className="break-words whitespace-normal">
                                          - {mc.description}
                                          {mc.count > 1 ? ` (${mc.count})` : ""}
                                        </p>
                                      ))}
                                    </div>
                                  ) : null}

                                  <div className="mt-1 flex flex-wrap items-center gap-2 pl-10">
                                    {item.tray_item_type ? <TrayItemChip type={item.tray_item_type} size="xs" /> : null}
                                    {item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0 ? (
                                      <span className="text-[11px] font-semibold text-orange-600">
                                        + {formatCurrency(Number(item.tray_container_cost ?? 0))} tarrina
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 sm:contents">
                                  <div className="rounded-xl bg-white/70 px-2.5 py-1.5 text-center sm:rounded-none sm:bg-transparent sm:px-0 sm:py-0 sm:text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden">Pend.</p>
                                    <p className="text-sm font-bold tabular-nums text-slate-800">
                                      {isBulkItem ? "—" : pendingQty}
                                    </p>
                                  </div>
                                  <div className="rounded-xl bg-white/70 px-2.5 py-1.5 text-center sm:rounded-none sm:bg-transparent sm:px-0 sm:py-0 sm:text-right">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden">Subtotal</p>
                                    <p className="text-sm font-bold tabular-nums text-slate-900">
                                      {formatCurrency(item.pending_total)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <AlertDialog
        open={!!undispatchedBlockOrder}
        onOpenChange={(open) => {
          if (!open) setUndispatchedBlockOrder(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>No se puede cobrar</AlertDialogTitle>
            <AlertDialogDescription>
              {(undispatchedBlockOrder?.unsent_draft_units ?? 0) > 0 ? (
                <>
                  Esta orden para llevar tiene productos agregados que aún no se enviaron a caja.
                  {" "}
                  Hay {undispatchedBlockOrder!.unsent_draft_units}{" "}
                  {undispatchedBlockOrder!.unsent_draft_units === 1 ? "unidad" : "unidades"} pendientes de enviar.
                  {" "}
                  Envía esos productos a caja antes de registrar el cobro.
                </>
              ) : (
                <>
                  No estan despachados todos los items de esta orden.
                  {undispatchedBlockOrder && (undispatchedBlockOrder.undispatched_units ?? 0) > 0 ? (
                    <>
                      {" "}
                      Faltan {undispatchedBlockOrder.undispatched_units}{" "}
                      {undispatchedBlockOrder.undispatched_units === 1 ? "unidad" : "unidades"} por despachar.
                    </>
                  ) : null}
                  {" "}
                  Despacha todo antes de registrar el cobro.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setUndispatchedBlockOrder(null)}>
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {USE_PAYMENT_DIALOG_V2 ? (
        <PaymentDialogV2
          order={selectedOrder}
          denominations={denominations}
          shiftDenoms={shiftDenoms}
          paymentMethods={paymentMethods}
          onPay={onPay}
          paying={paying}
          open={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          readOnly={readOnly}
        />
      ) : (
        <PaymentDialog
          order={selectedOrder}
          paymentMethods={paymentMethods}
          shiftDenoms={shiftDenoms}
          onPay={onPay}
          onPrepareTransferProof={onPrepareTransferProof}
          onDiscardPreparedTransferProof={onDiscardPreparedTransferProof}
          getTransferProofReadiness={getTransferProofReadiness}
          paying={paying}
          open={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
