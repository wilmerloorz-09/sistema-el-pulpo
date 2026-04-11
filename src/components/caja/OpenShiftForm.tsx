import { useEffect, useState } from "react";
import type { CashRegisterOpeningHistoryEntry, CashRegisterTemplate, Denomination } from "@/hooks/useCaja";
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
  templates?: CashRegisterTemplate[];
  hasCashierUser: boolean;
  cashierUserLabel?: string | null;
  onOpen: (payload: {
    counts: { denomination_id: string; qty: number }[];
  }) => void;
  opening: boolean;
  readOnly?: boolean;
  title?: string;
  description?: string;
  openingHistory?: CashRegisterOpeningHistoryEntry[];
}

export default function OpenShiftForm({
  denominations,
  templates = [],
  hasCashierUser,
  cashierUserLabel = null,
  onOpen,
  opening,
  readOnly = false,
  title = "Abrir Caja",
  description = "Ingresa el conteo inicial de caja",
  openingHistory = [],
}: Props) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("manual");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const buildCountsMap = (templateCounts?: { denomination_id: string; qty: number }[]) => {
    const templateMap = new Map((templateCounts ?? []).map((item) => [item.denomination_id, Math.max(0, Math.trunc(item.qty || 0))]));
    return Object.fromEntries(denominations.map((d) => [d.id, templateMap.get(d.id) ?? 0]));
  };

  useEffect(() => {
    setCounts((current) =>
      Object.fromEntries(denominations.map((d) => [d.id, current[d.id] ?? 0]))
    );
  }, [denominations]);

  useEffect(() => {
    if (selectedTemplateId === "manual") return;
    const template = templates.find((item) => item.id === selectedTemplateId);
    if (!template) {
      setSelectedTemplateId("manual");
      return;
    }
    setCounts(buildCountsMap(template.counts));
  }, [selectedTemplateId, templates]);

  const hasDenominations = denominations.length > 0;
  const selectedTemplate = selectedTemplateId === "manual"
    ? null
    : templates.find((item) => item.id === selectedTemplateId) ?? null;
  const total = denominations.reduce((sum, denomination) => sum + denomination.value * (counts[denomination.id] ?? 0), 0);
  const hasPositiveOpeningTotal = total > 0;
  const canSubmit = hasDenominations && hasPositiveOpeningTotal && hasCashierUser;

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
            No hay denominaciones configuradas
          </div>
          <p className="text-muted-foreground">
            Configura las monedas y billetes en Administracion / Denominaciones para que el formulario de apertura muestre el desglose.
          </p>
        </div>
      ) : (
        <div className="mb-6 space-y-4">
          {!hasCashierUser && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-foreground">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4 text-warning" />
                No hay usuario de caja configurado
              </div>
              <p className="text-muted-foreground">
                Debes habilitar exactamente un usuario con permiso de Caja en este turno antes de abrir caja.
              </p>
            </div>
          )}

          {hasCashierUser && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Usuario de Caja</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Este usuario abrira caja, cobrara las ordenes y desde su misma cuenta podra capturar comprobantes.
              </p>
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {cashierUserLabel ?? "Usuario configurado"}
              </div>
            </div>
          )}

          {hasDenominations && (
            <div className="rounded-xl border border-border bg-card p-4">
              <label className="block text-sm font-semibold text-foreground" htmlFor="cash-template-select">
                Plantilla de apertura
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Selecciona una plantilla para cargar cantidades automaticamente o deja Manual para capturarlas desde cero.
              </p>
              <select
                id="cash-template-select"
                value={selectedTemplateId}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedTemplateId(nextValue);
                  if (nextValue === "manual") return;
                  const template = templates.find((item) => item.id === nextValue);
                  if (template) {
                    setCounts(buildCountsMap(template.counts));
                  }
                }}
                className="mt-3 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                disabled={readOnly}
              >
                <option value="manual">Manual</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Plantilla aplicada: <span className="font-semibold text-foreground">{selectedTemplate.name}</span>. Puedes ajustar las cantidades manualmente antes de confirmar.
                </p>
              )}
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

      {hasDenominations && !readOnly && hasPositiveOpeningTotal && !hasCashierUser && (
        <p className="mt-3 text-center text-xs text-amber-700">
          No puedes abrir caja hasta definir un unico usuario con permiso de Caja en este turno.
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
              El usuario de caja asignado sera <span className="font-bold text-foreground">{cashierUserLabel ?? "sin asignar"}</span>.
              {selectedTemplate && (
                <> Se aplicara la plantilla <span className="font-bold text-foreground">{selectedTemplate.name}</span>.</>
              )}
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
