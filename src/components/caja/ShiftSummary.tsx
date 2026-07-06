import { useState } from "react";
import type { CashRegisterMovement, CashRegisterMovementDetail, CashShift } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, ArrowRightLeft, BarChart3, Clock, Coins, DollarSign, History, Loader2, Lock, ShieldAlert, WalletCards } from "lucide-react";
import DenominationVisual from "@/components/caja/DenominationVisual";
import type { CompletedPaymentsMethodSummary } from "@/hooks/useCaja";
import { isCashPaymentMethodName } from "@/lib/paymentMethods";
import CashRegisterOpeningHistory from "@/components/caja/CashRegisterOpeningHistory";
import CashRegisterMovementsDialog, { CashRegisterMovementsList } from "@/components/caja/CashRegisterMovementsDialog";

interface Props {
  shift: CashShift;
  methodSummary?: CompletedPaymentsMethodSummary[];
  movements?: CashRegisterMovement[];
  movementsLoading?: boolean;
  onClose: (notes?: string) => Promise<void> | void;
  onAnnulOpen?: (reason: string) => Promise<void>;
  onRegisterMovement?: (payload: {
    type: "entrada" | "salida" | "cambio_denominacion";
    amount: number;
    reason: string;
    detail?: CashRegisterMovementDetail | null;
  }) => Promise<void>;
  closing: boolean;
  annulling?: boolean;
  registeringMovement?: boolean;
  canAnnulOpen?: boolean;
  readOnly?: boolean;
}

export default function ShiftSummary({
  shift,
  methodSummary = [],
  movements = [],
  movementsLoading = false,
  onClose,
  onAnnulOpen,
  onRegisterMovement,
  closing,
  annulling = false,
  registeringMovement = false,
  canAnnulOpen = false,
  readOnly = false,
}: Props) {
  const [showClose, setShowClose] = useState(false);
  const [showDenoms, setShowDenoms] = useState(false);
  const [showTotals, setShowTotals] = useState(false);
  const [showMovements, setShowMovements] = useState(false);
  const [showAnnul, setShowAnnul] = useState(false);
  const [showAnnulWarning, setShowAnnulWarning] = useState(false);
  const [annulWarning, setAnnulWarning] = useState({ title: "", description: "" });
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [closeWarning, setCloseWarning] = useState({ title: "", description: "" });
  const [notes, setNotes] = useState("");
  const [annulReason, setAnnulReason] = useState("");

  const sortedDenoms = [...shift.denoms]
    .filter((denomination) => denomination.value > 0)
    .sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.value - b.value;
    });

  const totalInitial = sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_initial, 0);
  const totalCurrent = sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_current, 0);
  const totalCollected = methodSummary.reduce((sum, method) => sum + method.amount, 0);
  const totalCashCollected = methodSummary
    .filter((method) => isCashPaymentMethodName(method.methodName))
    .reduce((sum, method) => sum + method.amount, 0);
  const totalNonCashCollected = totalCollected - totalCashCollected;
  const cashPhysicalDelta = totalCurrent - totalInitial;
  const cashBalance = cashPhysicalDelta - totalCashCollected;
  const opened = new Date(shift.opened_at);
  const elapsed = Math.floor((Date.now() - opened.getTime()) / 60000);
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;
  const currentOpening = shift.openingHistory.find((entry) => entry.is_current) ?? shift.openingHistory[0] ?? null;
  const currentOpeningHasSales = (currentOpening?.payment_count ?? 0) > 0;
  const trimmedAnnulReason = annulReason.trim();
  const remainingReasonChars = Math.max(0, 10 - trimmedAnnulReason.length);
  const canConfirmAnnul = trimmedAnnulReason.length >= 10 && !currentOpeningHasSales && !annulling;

  const handleCloseCash = async () => {
    try {
      await onClose(notes || undefined);
      setShowClose(false);
      setNotes("");
    } catch (error: any) {
      const rawMessage = String(error?.message ?? "").trim();
      setCloseWarning({
        title: "No se puede cerrar la caja",
        description: rawMessage.startsWith("No puedes cerrar la caja porque aun existen ordenes pendientes")
          ? rawMessage
          : rawMessage || "No se pudo cerrar la caja. Intenta nuevamente.",
      });
      setShowCloseWarning(true);
    }
  };

  const handleAnnul = async () => {
    if (!onAnnulOpen || !canConfirmAnnul) return;

    try {
      await onAnnulOpen(trimmedAnnulReason);
      setShowAnnul(false);
      setAnnulReason("");
      setShowTotals(false);
    } catch (error: any) {
      const rawMessage = String(error?.message ?? "").trim();
      setShowAnnul(false);
      setAnnulReason("");
      setAnnulWarning({
        title: "No se pudo anular la apertura",
        description: rawMessage.startsWith("No se puede anular la apertura porque existen ordenes o cobros")
          ? "Esta apertura ya tiene ventas registradas, por lo que no se puede anular."
          : rawMessage || "No se pudo anular la apertura de caja. Intenta nuevamente.",
      });
      setShowAnnulWarning(true);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          onClick={() => setShowTotals(true)}
        >
          <BarChart3 className="h-4 w-4" />
          Resumen
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          onClick={() => setShowDenoms(true)}
        >
          <Coins className="h-4 w-4" />
          Desglose
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          onClick={() => setShowMovements(true)}
        >
          <ArrowRightLeft className="h-4 w-4" />
          Cambio
        </button>
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            className="h-11 rounded-full border-0 bg-[#0f766e] px-6 text-sm font-semibold text-white shadow-none hover:translate-y-0 hover:bg-[#115e59]"
            onClick={() => setShowClose(true)}
          >
            <WalletCards className="h-4 w-4" />
            Cerrar caja
          </Button>
        )}
      </div>

      <Dialog open={showTotals} onOpenChange={setShowTotals}>
        <DialogContent className="font-sans flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-orange-200 bg-white shadow-[0_32px_80px_-44px_rgba(249,115,22,0.45)] sm:max-w-[1180px] xl:max-w-[1320px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <DollarSign className="h-5 w-5 text-primary" /> Resumen de caja
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="grid h-full gap-2.5 lg:grid-cols-[1.18fr_0.92fr]">
              <div className="flex min-h-0 flex-col gap-2.5">
                <div className="rounded-xl border border-border bg-muted/20 p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">Caja fisica</p>
                    <span className="text-xs text-muted-foreground">Dinero real en caja</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white px-3 py-2.5">
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.22em] text-sky-700">Apertura</p>
                          <p className=" mt-1 text-[26px] font-bold leading-none text-slate-900">${totalInitial.toFixed(2)}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-200 bg-white text-sky-700 shadow-sm">
                          <Lock className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-600">Base inicial del turno</p>
                    </div>

                    <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-white px-3 py-2.5">
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] uppercase text-violet-700">Actual</p>
                          <p className=" mt-1 text-[26px] font-bold leading-none text-violet-900">${totalCurrent.toFixed(2)}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-700 shadow-sm">
                          <DollarSign className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-600">Dinero fisico en caja</p>
                    </div>

                    <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-3 py-2.5">
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-700">Diferencia</p>
                          <p className=" mt-1 text-[26px] font-bold leading-none text-emerald-900">${cashPhysicalDelta.toFixed(2)}</p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-sm">
                          <Coins className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="text-xs text-slate-600">Actual menos apertura</p>
                    </div>
                  </div>

                  <div className={`mt-1 rounded-xl border px-3 py-2.5 ${
                    Math.abs(cashBalance) < 0.01
                      ? "border-emerald-300 bg-gradient-to-r from-emerald-50 to-white"
                      : "border-red-300 bg-gradient-to-r from-red-50 to-white"
                  }`}>
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <div>
                        <p className={`text-[10px] uppercase tracking-[0.22em] ${
                          Math.abs(cashBalance) < 0.01 ? "text-emerald-700" : "text-red-700"
                        }`}>Cuadre de caja</p>
                        <p className={`mt-1 text-[26px] font-bold leading-none ${
                          Math.abs(cashBalance) < 0.01 ? "text-emerald-900" : "text-red-900"
                        }`}>{cashBalance > 0 ? "+" : cashBalance < 0 ? "-" : ""}${Math.abs(cashBalance).toFixed(2)}</p>
                      </div>
                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm ${
                        Math.abs(cashBalance) < 0.01
                          ? "border-emerald-200 bg-white text-emerald-700"
                          : "border-red-200 bg-white text-red-600"
                      }`}>
                        {Math.abs(cashBalance) < 0.01
                          ? <Coins className="h-4 w-4" />
                          : <AlertTriangle className="h-4 w-4" />
                        }
                      </div>
                    </div>
                    <p className="text-xs text-slate-600">
                      {Math.abs(cashBalance) < 0.01
                        ? "Diferencia fisica coincide con ventas en efectivo"
                        : cashBalance > 0
                          ? `Sobran $${Math.abs(cashBalance).toFixed(2)} vs ventas en efectivo`
                          : `Faltan $${Math.abs(cashBalance).toFixed(2)} vs ventas en efectivo`
                      }
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">Recaudado</p>
                    <span className="text-xs text-muted-foreground">Cobros por metodo</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-sky-700">Cobrado total</p>
                      <p className=" mt-1.5 text-[23px] font-bold leading-none text-slate-900">${totalCollected.toFixed(2)}</p>
                      <p className="mt-1.5 text-xs text-slate-600">Todos los metodos sumados</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-700">En efectivo</p>
                      <p className=" mt-1.5 text-[23px] font-bold leading-none text-emerald-900">${totalCashCollected.toFixed(2)}</p>
                      <p className="mt-1.5 text-xs text-slate-600">Ingreso fisico registrado</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-3 py-2.5">
                      <p className="text-[10px] uppercase text-amber-700">No efectivo</p>
                      <p className=" mt-1.5 text-[23px] font-bold leading-none text-amber-900">${totalNonCashCollected.toFixed(2)}</p>
                      <p className="mt-1.5 text-xs text-slate-600">Transferencias y otros medios</p>
                    </div>
                  </div>
                </div>

                <div className="min-h-0 rounded-xl border border-border bg-card p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">Cobrado por metodo</p>
                    <span className="text-xs text-muted-foreground">{methodSummary.length} metodo(s)</span>
                  </div>

                  {methodSummary.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {methodSummary.map((method) => (
                        <div key={method.methodId} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                          <p className="truncate text-sm font-semibold text-foreground">{method.methodName}</p>
                          <div className="mt-1.5 flex items-end justify-between gap-2">
                            <p className="text-xs text-muted-foreground">{method.paymentCount} cobro(s)</p>
                            <span className=" text-lg font-bold text-foreground">${method.amount.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      Todavia no hay cobros registrados en este turno.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex min-h-0 flex-col gap-2.5">
                <CashRegisterOpeningHistory
                  entries={shift.openingHistory}
                  description="Aperturas, cierres y anulaciones de esta jornada."
                  compact
                  className="min-h-0 flex-1"
                />

                <div className="min-h-0 rounded-xl border border-border bg-card p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Cambios de caja</p>
                      <p className="text-xs text-muted-foreground">
                        No alteran el total esperado del turno.
                      </p>
                    </div>
                    <Badge variant="outline" className="border-orange-200 bg-orange-50/90 text-foreground">
                      {movements.length} mov.
                    </Badge>
                  </div>

                  <CashRegisterMovementsList
                    movements={movements}
                    loading={movementsLoading}
                    emptyMessage="Sin movimientos en este turno"
                    compact
                  />
                </div>

                {canAnnulOpen && currentOpening && currentOpening.status === "abierta" && (
                  <div className="rounded-xl border border-rose-200 bg-gradient-to-r from-white via-rose-50 to-orange-50 p-2.5 shadow-sm">
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold text-rose-800">Anulacion de apertura</p>
                      <p className="text-xs leading-5 text-rose-900/80">
                        Si esta apertura no tiene ventas registradas, puedes anularla y volver a la pantalla limpia de apertura.
                      </p>
                    </div>
                    <Button variant="destructive" className="mt-2.5 w-full" onClick={() => setShowAnnul(true)}>
                      <ShieldAlert className="h-4 w-4" />
                      Anular apertura
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDenoms} onOpenChange={setShowDenoms}>
        <DialogContent className="font-sans scrollbar-none max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto border-orange-200 bg-white shadow-[0_32px_80px_-44px_rgba(249,115,22,0.55)] sm:max-w-[96vw] xl:max-w-6xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Coins className="h-5 w-5 text-primary" /> Desglose de caja
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2 rounded-2xl border border-sky-200 bg-sky-50/50 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Apertura</span>
                <span className=" text-lg font-bold text-sky-700">${totalInitial.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                {sortedDenoms.map((denomination) => (
                  <div key={`initial-${denomination.id}`} className="grid min-h-[76px] grid-rows-[auto_1fr] gap-1.5 rounded-xl border border-sky-100 bg-white p-1.5">
                    <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-emerald-50 px-1.5 py-1">
                      <DenominationVisual label={denomination.label} imageUrl={denomination.image_url} className="h-8 w-8 rounded-lg" iconClassName="h-3.5 w-3.5" />
                      <span className="truncate text-sm font-bold tabular-nums text-slate-950">${denomination.value.toFixed(2)}</span>
                    </div>
                    <div className="rounded-lg border-t border-sky-100 bg-white px-1.5 py-1.5">
                    <div className="grid grid-cols-2 items-end gap-1.5">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wide text-sky-700">Cant.</p>
                        <p className="mt-0.5 rounded-lg border border-sky-200 bg-sky-50 px-2 py-0.5 text-center text-sm font-bold tabular-nums text-slate-950">{denomination.qty_initial}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase tracking-wide text-sky-700">Total</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800">
                          ${(denomination.qty_initial * denomination.value).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-foreground">Actual</span>
                <span className=" text-lg font-bold text-primary">${totalCurrent.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
                {sortedDenoms.map((denomination) => (
                  <div key={`current-${denomination.id}`} className="grid min-h-[76px] grid-rows-[auto_1fr] gap-1.5 rounded-xl border border-emerald-100 bg-white p-1.5">
                    <div className="flex min-w-0 items-center gap-1.5 rounded-lg bg-emerald-50/80 px-1.5 py-1">
                      <DenominationVisual label={denomination.label} imageUrl={denomination.image_url} className="h-8 w-8 rounded-lg" iconClassName="h-3.5 w-3.5" />
                      <span className="truncate text-sm font-bold tabular-nums text-slate-950">${denomination.value.toFixed(2)}</span>
                    </div>
                    <div className="rounded-lg border-t border-emerald-100 bg-white px-1.5 py-1.5">
                    <div className="grid grid-cols-2 items-end gap-1.5">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Cant.</p>
                        <p className="mt-0.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-center text-sm font-bold tabular-nums text-slate-950">{denomination.qty_current}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Total</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800">
                          ${(denomination.qty_current * denomination.value).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {!readOnly && (
        <Dialog open={showClose} onOpenChange={setShowClose}>
          <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="">Cerrar Caja</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Apertura</p>
                  <p className=" text-lg font-bold text-foreground">${totalInitial.toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-accent/10 p-3 text-center">
                  <p className="text-xs text-muted-foreground">En caja</p>
                  <p className=" text-lg font-bold text-accent">${totalCurrent.toFixed(2)}</p>
                </div>
              </div>

              <div className="rounded-xl bg-primary/10 p-3 text-center">
                <p className="text-xs text-muted-foreground">Diferencia</p>
                <p className=" text-xl font-bold text-primary">
                  ${(totalCurrent - totalInitial).toFixed(2)}
                </p>
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-foreground">Notas (opcional)</p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observaciones de la caja..."
                  className="resize-none rounded-xl"
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setShowClose(false)} className="w-full rounded-xl sm:w-auto">
                Cancelar
              </Button>
              <Button
                onClick={handleCloseCash}
                disabled={closing}
                className="w-full gap-2 rounded-xl sm:w-auto"
              >
                {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Confirmar cierre de caja
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showAnnul} onOpenChange={setShowAnnul}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className=" flex items-center gap-2 text-rose-700">
              <ShieldAlert className="h-5 w-5" />
              Anular apertura de caja
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              Esta accion no se puede deshacer.
            </div>

            {currentOpeningHasSales && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                No se puede anular: existen ordenes registradas en esta caja.
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Motivo de anulacion</p>
              <Textarea
                value={annulReason}
                onChange={(event) => setAnnulReason(event.target.value)}
                rows={4}
                placeholder="Describe por que se debe anular esta apertura..."
                className="resize-none rounded-xl"
              />
              {remainingReasonChars > 0 ? (
                <p className="text-xs font-medium text-amber-700">
                  Escribe al menos 10 caracteres. Te faltan {remainingReasonChars}.
                </p>
              ) : (
                <p className="text-xs font-medium text-emerald-700">
                  Motivo valido para confirmar la anulacion.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowAnnul(false)} className="w-full sm:w-auto">
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleAnnul} disabled={!canConfirmAnnul} className="w-full sm:w-auto">
              {annulling ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              Confirmar anulacion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showAnnulWarning} onOpenChange={setShowAnnulWarning}>
        <AlertDialogContent className="max-w-md rounded-[24px] border border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-50 p-5 shadow-[0_30px_80px_-42px_rgba(245,158,11,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle className=" text-lg font-bold text-amber-950">
              {annulWarning.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-amber-900/80">
              {annulWarning.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setShowAnnulWarning(false);
                setAnnulWarning({ title: "", description: "" });
              }}
              className="w-full sm:w-auto"
            >
              Aceptar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCloseWarning} onOpenChange={setShowCloseWarning}>
        <AlertDialogContent className="max-w-md rounded-[24px] border border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-50 p-5 shadow-[0_30px_80px_-42px_rgba(245,158,11,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle className=" text-lg font-bold text-amber-950">
              {closeWarning.title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-amber-900/80">
              {closeWarning.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setShowCloseWarning(false);
                setCloseWarning({ title: "", description: "" });
              }}
              className="w-full sm:w-auto"
            >
              Aceptar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CashRegisterMovementsDialog
        open={showMovements}
        onOpenChange={setShowMovements}
        movements={movements}
        denominationOptions={shift.denoms
          .filter((denomination) => denomination.value > 0)
          .sort((a, b) => {
            if (a.display_order !== b.display_order) return a.display_order - b.display_order;
            return a.value - b.value;
          })
          .map((denomination) => ({
            id: denomination.denomination_id,
            label: denomination.label,
            value: denomination.value,
            imageUrl: denomination.image_url ?? null,
            currentQty: denomination.qty_current,
          }))}
        loading={movementsLoading}
        canRegister={!readOnly}
        registering={registeringMovement}
        onRegister={async (payload) => {
          if (!onRegisterMovement) throw new Error("No hay una accion configurada para registrar el movimiento.");
          await onRegisterMovement(payload);
        }}
      />
    </>
  );
}
