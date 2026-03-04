import { useState } from "react";
import type { CashShift } from "@/hooks/useCaja";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Clock, DollarSign, Loader2, Lock } from "lucide-react";

interface Props {
  shift: CashShift;
  onClose: (notes?: string) => void;
  closing: boolean;
}

export default function ShiftSummary({ shift, onClose, closing }: Props) {
  const [showClose, setShowClose] = useState(false);
  const [notes, setNotes] = useState("");

  const totalInitial = shift.denoms.reduce((s, d) => s + d.value * d.qty_initial, 0);
  const totalCurrent = shift.denoms.reduce((s, d) => s + d.value * d.qty_current, 0);
  const opened = new Date(shift.opened_at);
  const elapsed = Math.floor((Date.now() - opened.getTime()) / 60000);
  const hours = Math.floor(elapsed / 60);
  const mins = elapsed % 60;

  return (
    <>
      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-accent/15 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Turno Activo</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {hours}h {mins}m
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg gap-1.5 text-xs"
            onClick={() => setShowClose(true)}
          >
            <Lock className="h-3.5 w-3.5" />
            Cerrar Turno
          </Button>
        </div>

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

      {/* Close shift dialog */}
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
              <p className="text-sm font-medium text-foreground mb-1.5">Notas (opcional)</p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones del turno..."
                className="rounded-xl resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClose(false)} className="rounded-xl">
              Cancelar
            </Button>
            <Button
              onClick={() => { onClose(notes || undefined); setShowClose(false); }}
              disabled={closing}
              className="rounded-xl gap-2"
            >
              {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Confirmar Cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
