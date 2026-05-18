import { useEffect, useState } from "react";
import type { PayableOrder, PreparedTransferProofSession, ShiftDenom, PayOrderParams } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { getOrderKind, getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { ChevronDown, ChevronUp, CreditCard, Loader2, ReceiptText, ShoppingBag, Soup, UtensilsCrossed, UserRound } from "lucide-react";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import PaymentDialog from "./PaymentDialog";
import PaymentDialogV2 from "./PaymentDialogV2";
import PaymentDialogSecondary from "./PaymentDialogSecondary";
import { USE_PAYMENT_DIALOG_V2, canOpenPaymentUiOnDevice, shouldUseSecondaryPaymentDialog } from "@/lib/cajaPaymentUi";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

import { toast } from "sonner";
import { useBreakpoint } from "@/hooks/useBreakpoint";

interface Props {
  orders: PayableOrder[];
  paymentMethods: { id: string; name: string }[];
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
}: Props) {
  const { isTablet10 } = useBreakpoint();
  const shiftGateQuery = useBranchShiftGate();
  const useSecondaryPaymentUi = shouldUseSecondaryPaymentDialog(shiftGateQuery.data);
  const [selectedOrder, setSelectedOrder] = useState<PayableOrder | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

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
      <section className="space-y-6">
        <div className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_18px_48px_-42px_rgba(15,23,42,0.38)]">
          <div className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-3 sm:gap-0 sm:px-8 sm:py-5">
            <div className="sm:px-4">
              <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                <ReceiptText className="h-4 w-4 text-slate-400" />
                <span>Ordenes por cobrar: <span className="font-semibold text-slate-950">{orders.length}</span></span>
              </p>
            </div>
            <div className="sm:border-l sm:border-r sm:border-slate-200 sm:px-6">
              <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                <UtensilsCrossed className="h-4 w-4 text-slate-400" />
                <span>Unidades pendientes: <span className="font-semibold text-slate-950">{totalPendingUnits}</span></span>
              </p>
            </div>
            <div className="sm:px-6">
              <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                <CreditCard className="h-4 w-4 text-slate-400" />
                <span>Total: <span className="font-semibold text-slate-950">{formatCurrency(totalPendingAmount)}</span></span>
              </p>
            </div>
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[1.35rem] font-semibold tracking-[-0.025em] text-slate-950 sm:text-[1.5rem]">Ordenes por cobrar</h2>
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
          </div>

          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_55px_-42px_rgba(15,23,42,0.34)]">
            {orders.length === 0 ? (
              <div className="px-6 py-16 text-center">
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
              <div className="divide-y divide-slate-200">
                {orders.map((order, index) => {
                  const label = getCajaOrderOriginLabel({
                    orderType: order.order_type,
                    tableName: order.table_name,
                    splitCode: order.split_code,
                    isSpecial: order.is_special,
                    isTrayOrder: order.is_tray_order,
                  });
                  const orderKind = getOrderKind({
                    orderType: order.order_type,
                    isSpecial: order.is_special,
                    isTrayOrder: order.is_tray_order,
                  });
                  const pending = pendingUnits(order);
                  const pendingTotal = order.is_special
                    ? order.special_pending_amount
                    : order.items.reduce((sum, item) => sum + item.pending_total, 0);
                  const pendingUnitsText = `${pending} ${pending === 1 ? "unidad pendiente" : "unidades pendientes"}`;
                  const rowCode = getOrderRef(order.order_code, order.order_number);
                  const displayRowCode = rowCode === "Borrador" ? "Sin codigo" : rowCode;
                  const isExpanded = expandedOrderId === order.id;

                  return (
                    <div key={order.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-100/80"}>
                      <div
                        onClick={() => setExpandedOrderId((current) => current === order.id ? null : order.id)}
                        className="group grid cursor-pointer gap-3 px-5 py-3.5 transition-colors hover:bg-slate-100/50 sm:grid-cols-[auto_minmax(220px,1.7fr)_minmax(150px,0.9fr)_minmax(100px,0.6fr)_auto] sm:items-center sm:px-8"
                      >
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors group-hover:bg-slate-100 group-hover:text-slate-800"
                          aria-label={isExpanded ? "Ocultar detalle" : "Mostrar detalle"}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                              {orderKind === "tray" ? (
                                <Soup className="h-4 w-4" />
                              ) : orderKind === "takeout" ? (
                                <ShoppingBag className="h-4 w-4" />
                              ) : orderKind === "special" ? (
                                <CreditCard className="h-4 w-4" />
                              ) : (
                                <UtensilsCrossed className="h-4 w-4" />
                              )}
                            </span>
                            <p className="min-w-0 break-words text-lg font-semibold tracking-[-0.02em] text-slate-950">
                              {label}
                            </p>
                            {order.created_by_name && (
                              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs font-semibold text-slate-500">
                                <UserRound className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{order.created_by_name}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-bold tracking-[0.08em] text-slate-700">
                            {displayRowCode}
                          </p>
                        </div>

                        <div className="sm:text-right">
                          <p className="text-[1.45rem] font-semibold tracking-[-0.03em] text-slate-950">
                            {formatCurrency(pendingTotal)}
                          </p>
                          {order.is_special && (
                            <p className="text-xs text-slate-500">
                              Real {formatCurrency(order.special_real_total)}
                            </p>
                          )}
                        </div>


                        <div className="sm:justify-self-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={readOnly || order.locked_for_editing}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canOpenPaymentUiOnDevice(shiftGateQuery.data, isTablet10)) {
                                toast.error("El dispositivo es demasiado pequeño para operar caja.");
                                return;
                              }
                              setSelectedOrder(order);
                            }}
                            className="h-9 rounded-full border border-[#15803d] bg-[#15803d] px-4 text-sm font-semibold text-white shadow-none hover:translate-y-0 hover:bg-[#166534] hover:text-white"
                          >
                            <CreditCard className="h-4 w-4" />
                            Cobrar
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-slate-200 px-4 py-4 sm:px-8">
                          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                            <div className="hidden grid-cols-[minmax(0,1.8fr)_90px_110px_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 sm:grid">
                              <span>Detalle</span>
                              <span className="text-right">Cant.</span>
                              <span className="text-right">Pend.</span>
                              <span className="text-right">Subtotal</span>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {(() => {
                                const groupedMap: Record<string, (typeof order.items)[0] & { modifierQuantities: Array<{ mod: any, qty: number }> }> = {};
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
                                      modifierQuantities: ((item as any).modifiers || []).map((m: any) => ({ mod: m, qty: itemQty }))
                                    };
                                  } else {
                                    groupedMap[key].quantity += item.quantity;
                                    groupedMap[key].quantity_pending += item.quantity_pending;
                                    groupedMap[key].pending_total += item.pending_total;
                                    groupedMap[key].modifierQuantities.push(...((item as any).modifiers || []).map((m: any) => ({ mod: m, qty: itemQty })));
                                  }
                                }
                                return Object.values(groupedMap);
                              })().map((item) => {
                                const isBulkItem = item.tray_item_type === "C";
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
                                    className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.8fr)_90px_110px_110px] sm:gap-3"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate font-medium text-slate-900">{item.description_snapshot}</p>
                                      
                                      {consolidatedModifiers.length > 0 && (
                                        <div className="mt-1 flex flex-col gap-0.5 text-xs font-semibold text-red-600">
                                          {consolidatedModifiers.map((mc) => (
                                            <p key={mc.firstId} className="break-words whitespace-normal">
                                              - {mc.description} {mc.count > 1 ? `(${mc.count})` : ""}
                                            </p>
                                          ))}
                                        </div>
                                      )}

                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        {item.tray_item_type ? <TrayItemChip type={item.tray_item_type} size="xs" /> : null}
                                        {item.tray_item_type === "B" && Number(item.tray_container_cost ?? 0) > 0 ? (
                                          <span className="text-[11px] font-semibold text-orange-600">
                                            + {formatCurrency(Number(item.tray_container_cost ?? 0))} tarrina
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="mt-0.5 text-xs text-slate-500">
                                        {isBulkItem ? formatCurrency(item.unit_price) : `${formatCurrency(item.unit_price)} c/u`}
                                      </p>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-xs sm:contents sm:text-sm">
                                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center text-slate-600 sm:rounded-none sm:bg-transparent sm:px-0 sm:py-0 sm:text-right">
                                        {!isBulkItem ? <span className="mr-1 font-medium text-slate-500 sm:hidden">Cant.</span> : null}
                                        {isBulkItem ? "A granel" : item.quantity}
                                      </span>
                                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center text-slate-600 sm:rounded-none sm:bg-transparent sm:px-0 sm:py-0 sm:text-right">
                                        {!isBulkItem ? <span className="mr-1 font-medium text-slate-500 sm:hidden">Pend.</span> : null}
                                        {isBulkItem ? "-" : item.quantity_pending}
                                      </span>
                                      <span className="rounded-xl bg-slate-50 px-2 py-1 text-center font-medium text-slate-900 sm:rounded-none sm:bg-transparent sm:px-0 sm:py-0 sm:text-right">
                                        <span className="mr-1 font-medium text-slate-500 sm:hidden">Subtotal</span>
                                        {formatCurrency(item.pending_total)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </section>

      {useSecondaryPaymentUi ? (
        <PaymentDialogSecondary
          order={selectedOrder}
          shiftDenoms={shiftDenoms}
          paymentMethods={paymentMethods}
          onPay={onPay}
          paying={paying}
          open={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          readOnly={readOnly}
        />
      ) : USE_PAYMENT_DIALOG_V2 ? (
        <PaymentDialogV2
          order={selectedOrder}
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
