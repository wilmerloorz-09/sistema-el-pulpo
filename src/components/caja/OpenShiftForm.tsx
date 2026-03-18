import { useState } from "react";
import type { CashRegisterOpeningHistoryEntry, Denomination } from "@/hooks/useCaja";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, DollarSign, Loader2 } from "lucide-react";
import DenominationVisual from "@/components/caja/DenominationVisual";
import CashRegisterOpeningHistory from "@/components/caja/CashRegisterOpeningHistory";

interface Props {
  denominations: Denomination[];
  onOpen: (payload: { counts: { denomination_id: string; qty: number }[] }) => void;
  opening: boolean;
  readOnly?: boolean;
  title?: string;
  description?: string;
  openingHistory?: CashRegisterOpeningHistoryEntry[];
}

export default function OpenShiftForm({
  denominations,
  onOpen,
  opening,
  readOnly = false,
  title = "Abrir Caja",
  description = "Ingresa el conteo inicial de caja",
  openingHistory = [],
}: Props) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(denominations.map((d) => [d.id, 0]))
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasDenominations = denominations.length > 0;
  const total = denominations.reduce((sum, denomination) => sum + denomination.value * (counts[denomination.id] ?? 0), 0);
  const hasPositiveOpeningTotal = total > 0;

  const handleConfirmOpen = () => {
    if (!hasPositiveOpeningTotal) {
      setConfirmOpen(false);
      return;
    }
    const data = denominations.map((denomination) => ({
      denomination_id: denomination.id,
      qty: counts[denomination.id] ?? 0,
    }));
    setConfirmOpen(false);
    onOpen({ counts: data });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {openingHistory.length > 0 && (
        <CashRegisterOpeningHistory
          entries={openingHistory}
          title="Historial de aperturas"
          description="Las aperturas anuladas quedan registradas para este turno."
        />
      )}

      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <DollarSign className="h-7 w-7 text-primary" />
        </div>
        <h2 className="font-display text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {readOnly ? "Solo consulta: no puedes abrir caja desde esta cuenta" : description}
        </p>
      </div>

      {!hasDenominations ? (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4 text-warning" />
            No hay denominaciones configuradas para esta sucursal
          </div>
          <p className="text-muted-foreground">
            Configura las monedas y billetes en Administracion / Denominaciones para que el formulario de apertura muestre el desglose.
          </p>
        </div>
      ) : (
        <div className="mb-6 space-y-4">
          {denominations.map((denomination) => (
            <div key={denomination.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <DenominationVisual
                label={denomination.label}
                imageUrl={denomination.image_url}
                className="h-14 w-20 rounded-2xl"
                imageClassName="object-contain bg-white p-0.5"
                iconClassName="h-6 w-6"
              />
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-black leading-none text-red-600">${denomination.value.toFixed(2)}</div>
              </div>
              <Input
                type="number"
                min={0}
                value={counts[denomination.id] ?? 0}
                onChange={(e) => setCounts({ ...counts, [denomination.id]: parseInt(e.target.value, 10) || 0 })}
                className="h-9 w-20 rounded-lg text-center"
                disabled={readOnly}
              />
              <span className="w-20 text-right text-sm font-semibold text-foreground">
                ${((counts[denomination.id] ?? 0) * denomination.value).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-6 rounded-xl bg-primary/10 p-4 text-center">
        <p className="text-xs text-muted-foreground">Total en caja</p>
        <p className="font-display text-2xl font-bold text-primary">${total.toFixed(2)}</p>
      </div>

      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={opening || readOnly || !hasDenominations || !hasPositiveOpeningTotal}
        className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
      >
        {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : "Abrir Caja"}
      </Button>

      {hasDenominations && !readOnly && !hasPositiveOpeningTotal && (
        <p className="mt-3 text-center text-xs text-amber-700">
          Debes ingresar un valor mayor a 0 para abrir la caja.
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-md rounded-[24px] border border-orange-200 bg-gradient-to-br from-white via-orange-50 to-amber-50 p-5 shadow-[0_30px_80px_-42px_rgba(249,115,22,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-black text-foreground">
              Confirmar apertura de caja
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
              Se abrira la caja con un total inicial de <span className="font-bold text-foreground">${total.toFixed(2)}</span>.
              Verifica el conteo antes de continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="w-full sm:w-auto">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmOpen}
              disabled={!hasPositiveOpeningTotal}
              className="w-full sm:w-auto"
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
