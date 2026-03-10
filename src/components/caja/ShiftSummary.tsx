import { useState } from "react";
import type { CashShift } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Clock, Coins, DollarSign, Loader2, Lock } from "lucide-react";

interface Props {
  shift: CashShift;
  onClose: (notes?: string) => void;
  closing: boolean;
  readOnly?: boolean;
}

export default function ShiftSummary({ shift, onClose, closing, readOnly = false }: Props) {
  const [showClose, setShowClose] = useState(false);
  const [showDenoms, setShowDenoms] = useState(false);
  const [notes, setNotes] = useState("");

  const sortedDenoms = [...shift.denoms]
    .filter((denomination) => denomination.value > 0)
    .sort((a, b) => b.value - a.value);

  const totalInitial = sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_initial, 0);
  const totalCurrent = sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_current, 0);
  const opened = new Date(shift.opened_at);
  const elapsed = Math.floor((Date.now() - opened.getTime()) / 60000);
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  return (
    <>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
              <DollarSign className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Turno Activo</p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {hours}h {mins}m
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-lg text-xs"
                onClick={() => setShowClose(true)}
              >
                <Lock className="h-3.5 w-3.5" />
                Cerrar Turno
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-lg text-xs"
              onClick={() => setShowDenoms(true)}
            >
              <Coins className="h-3.5 w-3.5" />
              Desglose
            </Button>
          </div>
        </div>

        {readOnly && (
          <div className="rounded-xl border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            Modo consulta: puedes ver el turno, pero no cerrarlo.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-muted/50 p-3 text-center">
            <p className="text-xs text-muted-foreground">Apertura</p>
            <p className="font-display text-lg font-bold text-foreground">${totalInitial.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-accent/10 p-3 text-center">
            <p className="text-xs text-muted-foreground">Actual</p>
            <p className="font-display text-lg font-bold text-accent">${totalCurrent.toFixed(2)}</p>
          </div>
        </div>
      </div>

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
                  <div key={`initial-${denomination.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
                    <span className="text-sm text-foreground">{denomination.label}</span>
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
                  <div key={`current-${denomination.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/50">
                    <span className="text-sm text-foreground">{denomination.label}</span>
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
              <DialogTitle className="font-display">Cerrar Turno</DialogTitle>
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
                  placeholder="Observaciones del turno..."
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
                Confirmar Cierre
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
