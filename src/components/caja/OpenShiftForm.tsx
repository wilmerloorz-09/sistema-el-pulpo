import { useEffect, useState } from "react";
import type { CashRegisterOpeningHistoryEntry, CashShiftCaptureCandidate, Denomination } from "@/hooks/useCaja";
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
  captureCandidates: CashShiftCaptureCandidate[];
  initialCaptureUserId?: string | null;
  initialCaptureDeviceLabel?: string | null;
  onOpen: (payload: {
    counts: { denomination_id: string; qty: number }[];
    captureUserId: string;
    captureDeviceLabel?: string | null;
  }) => void;
  opening: boolean;
  readOnly?: boolean;
  title?: string;
  description?: string;
  openingHistory?: CashRegisterOpeningHistoryEntry[];
}

export default function OpenShiftForm({
  denominations,
  captureCandidates,
  initialCaptureUserId = null,
  initialCaptureDeviceLabel = null,
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
  const [captureUserId, setCaptureUserId] = useState(initialCaptureUserId ?? "");
  const [captureDeviceLabel, setCaptureDeviceLabel] = useState(initialCaptureDeviceLabel ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasDenominations = denominations.length > 0;
  const hasCaptureCandidates = captureCandidates.length > 0;
  const total = denominations.reduce((sum, denomination) => sum + denomination.value * (counts[denomination.id] ?? 0), 0);
  const hasPositiveOpeningTotal = total > 0;
  const canSubmit = hasDenominations && hasPositiveOpeningTotal && hasCaptureCandidates && !!captureUserId;

  useEffect(() => {
    if (!captureCandidates.length) {
      setCaptureUserId("");
      return;
    }

    if (initialCaptureUserId && captureCandidates.some((candidate) => candidate.id === initialCaptureUserId)) {
      setCaptureUserId(initialCaptureUserId);
      return;
    }

    setCaptureUserId((current) => current && captureCandidates.some((candidate) => candidate.id === current)
      ? current
      : captureCandidates[0].id);
  }, [captureCandidates, initialCaptureUserId]);

  const handleConfirmOpen = () => {
    if (!canSubmit) {
      setConfirmOpen(false);
      return;
    }
    const data = denominations.map((denomination) => ({
      denomination_id: denomination.id,
      qty: counts[denomination.id] ?? 0,
    }));
    setConfirmOpen(false);
    onOpen({
      counts: data,
      captureUserId,
      captureDeviceLabel: captureDeviceLabel.trim() || null,
    });
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
            No hay denominaciones configuradas
          </div>
          <p className="text-muted-foreground">
            Configura las monedas y billetes en Administracion / Denominaciones para que el formulario de apertura muestre el desglose.
          </p>
        </div>
      ) : (
        <div className="mb-6 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Usuario para toma de foto</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Antes de abrir caja debes indicar que usuario movil capturara los comprobantes de transferencia.
            </p>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Usuario capturador
                </label>
                <select
                  value={captureUserId}
                  onChange={(e) => setCaptureUserId(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  disabled={readOnly || !hasCaptureCandidates}
                >
                  <option value="">Selecciona un usuario</option>
                  {captureCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.full_name} @{candidate.username}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Equipo o celular
                </label>
                <Input
                  value={captureDeviceLabel}
                  onChange={(e) => setCaptureDeviceLabel(e.target.value)}
                  placeholder="Ej. Celular caja 1"
                  maxLength={120}
                  disabled={readOnly}
                />
              </div>
            </div>
          </div>

          {!hasCaptureCandidates && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4 text-warning" />
                No hay usuarios habilitados para asignar
              </div>
              <p className="text-muted-foreground">
                Habilita al menos un usuario en el turno desde Administracion para asignarlo como capturador de comprobantes.
              </p>
            </div>
          )}

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
        disabled={opening || readOnly || !canSubmit}
        className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
      >
        {opening ? <Loader2 className="h-5 w-5 animate-spin" /> : "Abrir Caja"}
      </Button>

      {hasDenominations && !readOnly && !hasPositiveOpeningTotal && (
        <p className="mt-3 text-center text-xs text-amber-700">
          Debes ingresar un valor mayor a 0 para abrir la caja.
        </p>
      )}

      {hasDenominations && !readOnly && hasPositiveOpeningTotal && !captureUserId && (
        <p className="mt-3 text-center text-xs text-amber-700">
          Debes seleccionar el usuario movil que tomara la foto del comprobante.
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
              El usuario asignado para la toma de foto sera <span className="font-bold text-foreground">{captureCandidates.find((candidate) => candidate.id === captureUserId)?.full_name ?? "sin asignar"}</span>.
              Verifica los datos antes de continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="w-full sm:w-auto">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmOpen}
              disabled={!canSubmit}
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
