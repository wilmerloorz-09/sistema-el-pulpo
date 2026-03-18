import { useState } from "react";
import type { CashRegisterMovement, CashShift } from "@/hooks/useCaja";
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
import { MetricCard } from "@/components/ui/metric-card";
import { AlertTriangle, Clock, Coins, DollarSign, History, Loader2, Lock, ShieldAlert } from "lucide-react";
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
      <div className="relative overflow-hidden rounded-[28px] border border-emerald-200 bg-gradient-to-r from-white via-emerald-50 to-sky-50 p-4 shadow-[0_22px_55px_-42px_rgba(16,185,129,0.7)]">
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-200/35 blur-2xl" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-300 bg-white/90 shadow-sm">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">
                {shift.caja_status === "OPEN" ? "Caja Activa" : "Turno Activo"}
              </p>
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Clock className="h-3 w-3" />
                {hours}h {mins}m
              </p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 w-full gap-1.5 rounded-2xl border-rose-200 bg-gradient-to-r from-white via-rose-50 to-white px-3 text-xs font-semibold text-rose-700 shadow-[0_12px_30px_-24px_rgba(244,63,94,0.8)] hover:border-rose-300 hover:from-rose-50 hover:to-white sm:w-auto"
                onClick={() => setShowClose(true)}
              >
                <Lock className="h-3.5 w-3.5" />
                Cerrar Caja
              </Button>
            )}
              <Button
              variant="outline"
              size="sm"
              className="h-10 w-full gap-1.5 rounded-2xl border-violet-200 bg-gradient-to-r from-white via-violet-50 to-white px-3 text-xs font-semibold text-violet-700 shadow-[0_12px_30px_-24px_rgba(139,92,246,0.8)] hover:border-violet-300 hover:from-violet-50 hover:to-white sm:w-auto"
              onClick={() => setShowTotals(true)}
            >
              <DollarSign className="h-3.5 w-3.5" />
              Resumen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-full gap-1.5 rounded-2xl border-sky-200 bg-gradient-to-r from-white via-sky-50 to-white px-3 text-xs font-semibold text-sky-700 shadow-[0_12px_30px_-24px_rgba(14,165,233,0.8)] hover:border-sky-300 hover:from-sky-50 hover:to-white sm:w-auto"
              onClick={() => setShowDenoms(true)}
            >
              <Coins className="h-3.5 w-3.5" />
              Desglose
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 w-full gap-1.5 rounded-2xl border-amber-200 bg-gradient-to-r from-white via-amber-50 to-white px-3 text-xs font-semibold text-amber-700 shadow-[0_12px_30px_-24px_rgba(245,158,11,0.8)] hover:border-amber-300 hover:from-amber-50 hover:to-white sm:w-auto"
              onClick={() => setShowMovements(true)}
            >
              <History className="h-3.5 w-3.5" />
              Movimientos
            </Button>
          </div>
        </div>

        {readOnly && (
          <div className="rounded-2xl border border-border bg-white/80 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            Modo consulta: puedes ver la caja, pero no cerrarla.
          </div>
        )}
      </div>

      <Dialog open={showTotals} onOpenChange={setShowTotals}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" /> Resumen de Caja
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Caja fisica</p>
              <span className="text-xs text-muted-foreground">Dinero real en caja</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard title="Apertura" value={`$${totalInitial.toFixed(2)}`} description="Base inicial del turno" icon={<Lock className="h-5 w-5" />} tone="sky" />
              <MetricCard title="Actual" value={`$${totalCurrent.toFixed(2)}`} description="Dinero fisico en caja" icon={<DollarSign className="h-5 w-5" />} tone="violet" />
            </div>

            <MetricCard title="Diferencia" value={`$${(totalCurrent - totalInitial).toFixed(2)}`} description="Actual menos apertura" icon={<Coins className="h-5 w-5" />} tone="emerald" />
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">Recaudado</p>
              <span className="text-xs text-muted-foreground">Cobros registrados por metodo</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard title="Cobrado total" value={`$${totalCollected.toFixed(2)}`} description="Todos los metodos sumados" icon={<DollarSign className="h-5 w-5" />} tone="sky" />
              <MetricCard title="En efectivo" value={`$${totalCashCollected.toFixed(2)}`} description="Ingreso fisico registrado" icon={<Coins className="h-5 w-5" />} tone="emerald" />
              <MetricCard title="No efectivo" value={`$${totalNonCashCollected.toFixed(2)}`} description="Transferencias y otros medios" icon={<Lock className="h-5 w-5" />} tone="amber" />
            </div>

            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">Cobrado por metodo</p>
                <span className="text-xs text-muted-foreground">{methodSummary.length} metodo(s)</span>
              </div>

              {methodSummary.length > 0 ? (
                <div className="space-y-1.5">
                  {methodSummary.map((method) => (
                    <div key={method.methodId} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{method.methodName}</p>
                        <p className="text-xs text-muted-foreground">{method.paymentCount} cobro(s)</p>
                      </div>
                      <span className="font-display text-base font-bold text-foreground">${method.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                  Todavia no hay cobros registrados en este turno.
                </div>
              )}
            </div>

            {methodSummary.length > 0 && (
              <p className="text-xs text-muted-foreground">
                La diferencia de caja corresponde al efectivo. Los demas metodos no incrementan el dinero fisico en caja.
              </p>
            )}
          </div>

          <CashRegisterOpeningHistory
            entries={shift.openingHistory}
            description="Las aperturas anuladas muestran motivo y usuario responsable."
          />

          <div className="space-y-3 rounded-2xl border border-border bg-card p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Movimientos de caja</p>
                <p className="text-xs text-muted-foreground">
                  Se incluyen en el reporte del turno, pero no cambian el total esperado de efectivo.
                </p>
              </div>
              <Badge variant="outline" className="border-orange-200 bg-orange-50/90 text-foreground">
                {movements.length} movimiento(s)
              </Badge>
            </div>

            <CashRegisterMovementsList
              movements={movements}
              loading={movementsLoading}
              emptyMessage="Sin movimientos en este turno"
            />
          </div>

          {canAnnulOpen && currentOpening && currentOpening.status === "abierta" && (
            <div className="rounded-2xl border border-rose-200 bg-gradient-to-r from-white via-rose-50 to-orange-50 p-3 shadow-sm">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-rose-800">Anulacion de apertura</p>
                <p className="text-xs leading-5 text-rose-900/80">
                  Si esta apertura no tiene ventas registradas, puedes anularla para volver a la pantalla limpia de apertura de caja.
                </p>
              </div>
              <Button
                variant="destructive"
                className="mt-3 w-full sm:w-auto"
                onClick={() => setShowAnnul(true)}
              >
                <ShieldAlert className="h-4 w-4" />
                Anular apertura
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDenoms} onOpenChange={setShowDenoms}>
        <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto border-orange-200 bg-white shadow-[0_32px_80px_-44px_rgba(249,115,22,0.55)] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Coins className="h-5 w-5 text-primary" /> Desglose de Caja
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Apertura</span>
                <span className="font-display text-base font-bold text-foreground">${totalInitial.toFixed(2)}</span>
              </div>
              <div className="space-y-1">
                {sortedDenoms.map((denomination) => (
                  <div key={`initial-${denomination.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                    <div className="flex min-w-0 items-center gap-3">
                      <DenominationVisual label={denomination.label} imageUrl={denomination.image_url} className="h-10 w-10 rounded-xl" iconClassName="h-4 w-4" />
                      <span className="truncate text-sm font-semibold text-foreground">${denomination.value.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-sm font-bold text-foreground">{denomination.qty_initial}</span>
                      <span className="w-16 text-right text-xs text-muted-foreground">
                        ${(denomination.qty_initial * denomination.value).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">Actual</span>
                <span className="font-display text-base font-bold text-primary">${totalCurrent.toFixed(2)}</span>
              </div>
              <div className="space-y-1">
                {sortedDenoms.map((denomination) => (
                  <div key={`current-${denomination.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                    <div className="flex min-w-0 items-center gap-3">
                      <DenominationVisual label={denomination.label} imageUrl={denomination.image_url} className="h-10 w-10 rounded-xl" iconClassName="h-4 w-4" />
                      <span className="truncate text-sm font-semibold text-foreground">${denomination.value.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular-nums text-sm font-bold text-foreground">{denomination.qty_current}</span>
                      <span className="w-16 text-right text-xs text-muted-foreground">
                        ${(denomination.qty_current * denomination.value).toFixed(2)}
                      </span>
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
              <DialogTitle className="font-display">Cerrar Caja</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/50 p-3 text-center">
                  <p className="text-xs text-muted-foreground">Apertura</p>
                  <p className="font-display text-lg font-bold text-foreground">${totalInitial.toFixed(2)}</p>
                </div>
                <div className="rounded-xl bg-accent/10 p-3 text-center">
                  <p className="text-xs text-muted-foreground">En caja</p>
                  <p className="font-display text-lg font-bold text-accent">${totalCurrent.toFixed(2)}</p>
                </div>
              </div>

              <div className="rounded-xl bg-primary/10 p-3 text-center">
                <p className="text-xs text-muted-foreground">Diferencia</p>
                <p className="font-display text-xl font-bold text-primary">
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
            <DialogTitle className="font-display flex items-center gap-2 text-rose-700">
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
            <AlertDialogTitle className="font-display text-lg font-black text-amber-950">
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
            <AlertDialogTitle className="font-display text-lg font-black text-amber-950">
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
          if (!onRegisterMovement) return;
          await onRegisterMovement(payload);
        }}
      />
    </>
  );
}
