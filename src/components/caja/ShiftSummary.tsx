import { useState } from "react";
import type { CashShift } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { MetricCard } from "@/components/ui/metric-card";
import { Clock, Coins, DollarSign, Loader2, Lock } from "lucide-react";
import DenominationVisual from "@/components/caja/DenominationVisual";
import type { CompletedPaymentsMethodSummary } from "@/hooks/useCaja";
import { isCashPaymentMethodName } from "@/lib/paymentMethods";

interface Props {
  shift: CashShift;
  methodSummary?: CompletedPaymentsMethodSummary[];
  onClose: (notes?: string) => void;
  closing: boolean;
  readOnly?: boolean;
}

export default function ShiftSummary({ shift, methodSummary = [], onClose, closing, readOnly = false }: Props) {
  const [showClose, setShowClose] = useState(false);
  const [showDenoms, setShowDenoms] = useState(false);
  const [showTotals, setShowTotals] = useState(false);
  const [notes, setNotes] = useState("");

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
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 gap-1.5 rounded-2xl border-rose-200 bg-gradient-to-r from-white via-rose-50 to-white px-3 text-xs font-semibold text-rose-700 shadow-[0_12px_30px_-24px_rgba(244,63,94,0.8)] hover:border-rose-300 hover:from-rose-50 hover:to-white"
                onClick={() => setShowClose(true)}
              >
                <Lock className="h-3.5 w-3.5" />
                Cerrar Caja
              </Button>
            )}
              <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 rounded-2xl border-violet-200 bg-gradient-to-r from-white via-violet-50 to-white px-3 text-xs font-semibold text-violet-700 shadow-[0_12px_30px_-24px_rgba(139,92,246,0.8)] hover:border-violet-300 hover:from-violet-50 hover:to-white"
              onClick={() => setShowTotals(true)}
            >
              <DollarSign className="h-3.5 w-3.5" />
              Resumen
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 rounded-2xl border-sky-200 bg-gradient-to-r from-white via-sky-50 to-white px-3 text-xs font-semibold text-sky-700 shadow-[0_12px_30px_-24px_rgba(14,165,233,0.8)] hover:border-sky-300 hover:from-sky-50 hover:to-white"
              onClick={() => setShowDenoms(true)}
            >
              <Coins className="h-3.5 w-3.5" />
              Desglose
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
        <DialogContent className="sm:max-w-md">
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
        </DialogContent>
      </Dialog>

      <Dialog open={showDenoms} onOpenChange={setShowDenoms}>
        <DialogContent className="sm:max-w-xl">
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
          <DialogContent className="sm:max-w-md">
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowClose(false)} className="rounded-xl">
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  onClose(notes || undefined);
                  setShowClose(false);
                }}
                disabled={closing}
                className="gap-2 rounded-xl"
              >
                {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Confirmar cierre de caja
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
