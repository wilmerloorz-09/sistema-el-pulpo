import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import { cn } from "@/lib/utils";
import type { PayableOrder, PayOrderParams, ShiftDenom } from "@/hooks/useCaja";
import DenominationVisual from "@/components/caja/DenominationVisual";
import { usePaymentChargeFlow } from "@/components/caja/usePaymentChargeFlow";
import PaymentClienteCard from "@/components/caja/PaymentClienteCard";
import { usePaymentClienteSelection } from "@/hooks/usePaymentClienteSelection";
import { useBancosActivos } from "@/hooks/useBancosActivos";
import TransferenciaPagoSection from "@/components/caja/TransferenciaPagoSection";
import { CircleCheck, Coins, Loader2, UserRound, Wallet } from "lucide-react";

function getCajaOrderOriginLabel(params: Parameters<typeof getOrderOriginLabel>[0]) {
  return getOrderOriginLabel({
    ...params,
    isTrayOrder: false,
    orderType: params.isTrayOrder ? "TAKEOUT" : params.orderType,
  });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

interface Props {
  order: PayableOrder | null;
  paymentDenominations: ShiftDenom[];
  drawerDenoms: ShiftDenom[];
  paymentMethods: { id: string; name: string }[];
  onPay: (params: PayOrderParams) => Promise<unknown> | void;
  paying: boolean;
  open: boolean;
  onClose: () => void;
  readOnly?: boolean;
}

/** Cobro para caja secundaria: layout vertical optimizado para telefono y tablet. */
export default function PaymentDialogSecondary({
  order,
  paymentDenominations,
  drawerDenoms,
  paymentMethods,
  onPay,
  paying,
  open,
  onClose,
  readOnly = false,
}: Props) {
  const clienteSelection = usePaymentClienteSelection(order, open);
  const { data: bancosActivos = [] } = useBancosActivos(open);

  const flow = usePaymentChargeFlow({
    order,
    paymentDenominations,
    drawerDenoms,
    paymentMethods,
    onPay,
    paying,
    open,
    readOnly,
    selectedCliente: clienteSelection.selectedCliente,
  });

  const {
    postPaySummary,
    setPostPaySummary,
    suppressCloseOnceRef,
    settlePendingPay,
    transferDatos,
    setTransferDatos,
    orderChargeTotal,
    cashTotal,
    transferAmount,
    totalDelivered,
    changeAmount,
    cannotMakeChange,
    changeDenomBreakdown,
    coinDenoms,
    billDenoms,
    receivedByDenom,
    selectedLines,
    payValidationMessage,
    canPay,
    handleCobrar,
    addDenom,
    subtractDenom,
    clearCash,
  } = flow;

  const renderDenomButton = (d: ShiftDenom) => {
    const qty = receivedByDenom[d.denomination_id] || 0;
    return (
      <button
        key={d.denomination_id}
        type="button"
        onClick={() => addDenom(d.denomination_id)}
        disabled={readOnly}
        className={cn(
          "relative overflow-hidden rounded-xl border bg-card text-left transition-all active:scale-95",
          qty > 0 ? "border-teal-500/50 shadow-sm" : "border-border",
        )}
      >
        {qty > 0 && (
          <span className="absolute right-0.5 top-0.5 z-10 rounded-full bg-teal-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
            x{qty}
          </span>
        )}
        <DenominationVisual
          label={d.label}
          imageUrl={d.image_url}
          className="h-10 w-full rounded-none border-0 bg-white"
          imageClassName="object-contain bg-white p-0.5"
          iconClassName="h-4 w-4"
        />
        <div className="border-t border-border bg-muted/20 px-1 py-0.5 text-center text-[10px] font-black text-teal-800">
          ${d.value.toFixed(2)}
        </div>
      </button>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          const dismissedFromSuccessUi = postPaySummary != null;
          void (async () => {
            await settlePendingPay();
            if (dismissedFromSuccessUi && suppressCloseOnceRef.current) {
              suppressCloseOnceRef.current = false;
              return;
            }
            suppressCloseOnceRef.current = false;
            if (dismissedFromSuccessUi) setPostPaySummary(null);
            onClose();
          })();
        }}
      >
        <DialogContent
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className={cn(
            "flex max-h-[100dvh] flex-col overflow-hidden bg-white p-0",
            "h-[100dvh] w-full max-w-lg rounded-none sm:h-auto sm:max-h-[96dvh] sm:rounded-2xl",
          )}
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
            <DialogTitle className="font-display text-base leading-tight">
              {postPaySummary ? (
                <span className="flex items-center gap-2">
                  <CircleCheck className="h-5 w-5 text-emerald-600" />
                  Cobro registrado
                </span>
              ) : readOnly ? (
                "Consulta de cobro"
              ) : (
                <>
                  Cobrar {order ? getOrderRef(order.order_code, order.order_number) : ""}
                  {order ? (
                    <span className="mt-0.5 block text-sm font-semibold text-muted-foreground">
                      {getCajaOrderOriginLabel({
                        orderType: order.order_type,
                        tableName: order.table_name,
                        splitCode: order.split_code,
                        isSpecial: order.is_special,
                        isTrayOrder: order.is_tray_order,
                      })}
                    </span>
                  ) : null}
                </>
              )}
            </DialogTitle>
            {order?.created_by_name && !postPaySummary && (
              <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <UserRound className="h-3.5 w-3.5" />
                {order.created_by_name}
              </div>
            )}
          </DialogHeader>

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {postPaySummary && order ? (
              <div className="space-y-3">
                {postPaySummary.changeAmount > 0.001 ? (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-950">Cambio a entregar</p>
                    <p className="font-display text-3xl font-bold tabular-nums text-emerald-800">
                      {formatCurrency(postPaySummary.changeAmount)}
                    </p>
                    {postPaySummary.lines.map((denomination) => (
                      <div
                        key={denomination.denomination_id}
                        className="mt-2 flex items-center justify-between rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-sm"
                      >
                        <span className="font-medium">{denomination.label}</span>
                        <span className="font-bold tabular-nums">x{denomination.qty}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-sm text-muted-foreground">Sin cambio para el cliente.</p>
                )}
              </div>
            ) : !order ? null : (
              <div className="flex flex-col gap-3">
                <PaymentClienteCard
                  order={order}
                  readOnly={readOnly}
                  compact
                  selection={clienteSelection}
                />

                <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(7.75rem,0.72fr)] gap-2">
                  <div className="flex min-w-0 flex-col justify-center rounded-2xl border border-sky-200 bg-sky-50 px-2.5 py-2">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-sky-800">Total a cobrar</p>
                    <p className="font-display text-xl font-black leading-tight tabular-nums text-sky-950 sm:text-2xl">
                      {formatCurrency(orderChargeTotal)}
                    </p>
                  </div>
                  <TransferenciaPagoSection
                    transferDatos={transferDatos}
                    onTransferDatosChange={setTransferDatos}
                    netChargeTotal={orderChargeTotal}
                    bancos={bancosActivos}
                    readOnly={readOnly}
                    className="flex min-w-0 max-w-[7.75rem] flex-col justify-center gap-1 rounded-2xl border border-violet-200 bg-violet-50/80 px-2 py-2"
                  />
                </div>

                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-stone-600">
                    <Wallet className="h-3.5 w-3.5" />
                    Resumen entregado
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Efectivo</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(cashTotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Transfer.</span>
                    <span className="font-semibold tabular-nums">{formatCurrency(transferAmount)}</span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 text-base font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(totalDelivered)}</span>
                  </div>
                  {changeAmount > 0.001 && (
                    <p className="mt-1 text-xs text-stone-700">
                      Cambio: <strong>{formatCurrency(changeAmount)}</strong>
                      {cannotMakeChange ? <span className="text-destructive"> (no alcanza en caja)</span> : null}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/95 to-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-amber-700" />
                      <div>
                        <p className="text-sm font-semibold">Efectivo</p>
                        <p className="text-[10px] text-muted-foreground">Toca para sumar</p>
                      </div>
                    </div>
                    {!readOnly && Object.keys(receivedByDenom).length > 0 && (
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={clearCash}>
                        Limpiar
                      </Button>
                    )}
                  </div>
                  {paymentDenominations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin denominaciones en esta caja.</p>
                  ) : (
                    <div className="space-y-3">
                      {coinDenoms.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase text-amber-800">Monedas</p>
                          <div className="grid grid-cols-3 gap-1.5">{coinDenoms.map(renderDenomButton)}</div>
                        </div>
                      )}
                      {billDenoms.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase text-emerald-800">Billetes</p>
                          <div className="grid grid-cols-3 gap-1.5">{billDenoms.map(renderDenomButton)}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {selectedLines.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase text-slate-600">Detalle efectivo</p>
                    <div className="max-h-36 space-y-1.5 overflow-y-auto">
                      {selectedLines.map((line) => (
                        <div
                          key={line.denomination_id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                        >
                          <span className="min-w-0 truncate text-muted-foreground">{line.label}</span>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="font-semibold tabular-nums">{formatCurrency(line.lineTotal)}</span>
                            {!readOnly && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => subtractDenom(line.denomination_id)}
                              >
                                âˆ’1
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-white px-3 py-3 safe-bottom">
            {postPaySummary ? (
              <Button
                type="button"
                className="h-11 w-full rounded-xl"
                onClick={() => {
                  setPostPaySummary(null);
                  clearCash();
                  setTransferDatos(null);
                  const isFullyPaid = order 
                    ? order.is_special 
                      ? Number(order.special_pending_amount ?? 0) <= 0.005 
                      : (order.items ?? []).every((i) => Number(i.quantity_pending ?? 0) <= 0)
                    : true;
                  if (isFullyPaid) {
                    onClose();
                  }
                }}
              >
                Listo
              </Button>
            ) : (
              <>
                {payValidationMessage && !readOnly ? (
                  <p className="text-center text-xs text-destructive">{payValidationMessage}</p>
                ) : null}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl" onClick={onClose}>
                    Cerrar
                  </Button>
                  {!readOnly && (
                    <Button
                      type="button"
                      className="h-11 flex-1 rounded-xl"
                      disabled={!canPay || paying}
                      onClick={() => void handleCobrar()}
                    >
                      {paying ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Cobrando…
                        </>
                      ) : (
                        "Cobrar"
                      )}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
