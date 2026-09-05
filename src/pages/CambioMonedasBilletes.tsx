import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRightLeft, Banknote, History, Loader2, Lock, Minus, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAuxiliaryCash, type AuxiliaryDenomination, type AuxiliaryExchange } from "@/hooks/useAuxiliaryCash";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import DenominationVisual from "@/components/caja/DenominationVisual";

type CountMap = Record<string, number>;

function linesFromCounts(counts: CountMap) {
  return Object.entries(counts)
    .filter(([, qty]) => qty > 0)
    .map(([denomination_id, qty]) => ({ denomination_id, qty }));
}

function totalFor(counts: CountMap, denominations: AuxiliaryDenomination[]) {
  const values = new Map(denominations.map((denomination) => [denomination.id, denomination.value]));
  return Object.entries(counts).reduce(
    (total, [id, qty]) => total + (values.get(id) ?? 0) * qty,
    0,
  );
}

function ExchangeDenominationEditor({
  title,
  description,
  denominations,
  counts,
  available,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  denominations: AuxiliaryDenomination[];
  counts: CountMap;
  available: CountMap;
  disabled: boolean;
  onChange: (id: string, qty: number) => void;
}) {
  return (
    <section className="rounded-2xl border border-sky-200 bg-white p-3 shadow-sm">
      <h2 className="font-display text-base font-black text-slate-950">{title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      <div className="space-y-2">
        {denominations.map((denomination) => {
          const qty = counts[denomination.id] ?? 0;
          const max = available[denomination.id] ?? 0;
          return (
            <div
              key={denomination.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto_78px] items-center gap-2 rounded-xl border border-slate-200 p-2"
            >
              <DenominationVisual
                label={denomination.label}
                imageUrl={denomination.image_url}
                className="h-10 w-10 rounded-xl"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">${denomination.value.toFixed(2)}</p>
                <p className="text-[11px] text-muted-foreground">Disponible: {max}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={disabled || qty <= 0}
                  onClick={() => onChange(denomination.id, qty - 1)}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <NumericInput
                  value={qty}
                  min={0}
                  max={max}
                  disabled={disabled}
                  onValueChange={(value) => onChange(denomination.id, value)}
                  className="h-8 w-12 px-1 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={disabled || qty >= max}
                  onClick={() => onChange(denomination.id, qty + 1)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-right text-sm font-black tabular-nums">
                ${(qty * denomination.value).toFixed(2)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatDetail(exchange: AuxiliaryExchange, side: "given_detail" | "received_detail", denominations: AuxiliaryDenomination[]) {
  const values = new Map(denominations.map((denomination) => [denomination.id, denomination.value]));
  return exchange[side]
    .map((line) => `${line.qty}× $${Number(line.value ?? values.get(line.denomination_id) ?? 0).toFixed(2)}`)
    .join(" + ");
}

export default function CambioMonedasBilletes() {
  const { activeBranch } = useBranch();
  const {
    assignmentQuery,
    contextQuery,
    registerExchange,
    voidExchange,
    closeAuxiliaryCash,
  } = useAuxiliaryCash();
  const [targetOpeningId, setTargetOpeningId] = useState("");
  const [givenCounts, setGivenCounts] = useState<CountMap>({});
  const [receivedCounts, setReceivedCounts] = useState<CountMap>({});
  const [reason, setReason] = useState("");
  const [editingExchange, setEditingExchange] = useState<AuxiliaryExchange | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [voidCandidate, setVoidCandidate] = useState<AuxiliaryExchange | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");

  const context = contextQuery.data;
  const denominations = context?.denominations ?? [];
  const targets = context?.targets ?? [];
  const selectedTarget = targets.find((target) => target.opening_id === targetOpeningId) ?? null;
  const auxiliaryAvailable = useMemo(
    () => {
      const available = Object.fromEntries(
        denominations.map((denomination) => [denomination.id, denomination.qty_current]),
      );
      if (editingExchange) {
        for (const line of editingExchange.given_detail) {
          available[line.denomination_id] = (available[line.denomination_id] ?? 0) + line.qty;
        }
        for (const line of editingExchange.received_detail) {
          available[line.denomination_id] = Math.max(
            0,
            (available[line.denomination_id] ?? 0) - line.qty,
          );
        }
      }
      return available;
    },
    [denominations, editingExchange],
  );
  const targetAvailable = useMemo(
    () => {
      const available = Object.fromEntries(
        (selectedTarget?.denominations ?? []).map((denomination) => [denomination.id, denomination.qty_current]),
      );
      if (editingExchange && editingExchange.target_opening_id === selectedTarget?.opening_id) {
        for (const line of editingExchange.received_detail) {
          available[line.denomination_id] = (available[line.denomination_id] ?? 0) + line.qty;
        }
        for (const line of editingExchange.given_detail) {
          available[line.denomination_id] = Math.max(
            0,
            (available[line.denomination_id] ?? 0) - line.qty,
          );
        }
      }
      return available;
    },
    [selectedTarget, editingExchange],
  );
  const totalGiven = totalFor(givenCounts, denominations);
  const totalReceived = totalFor(receivedCounts, denominations);
  const totalsMatch = totalGiven > 0 && Math.abs(totalGiven - totalReceived) <= 0.009;
  const isOpen = context?.opening_status === "abierta";
  const isSaving = registerExchange.isPending;
  const correctionReady = !editingExchange || correctionReason.trim().length >= 5;
  const availabilityExceeded =
    Object.entries(givenCounts).some(([id, qty]) => qty > (auxiliaryAvailable[id] ?? 0))
    || Object.entries(receivedCounts).some(([id, qty]) => qty > (targetAvailable[id] ?? 0));
  const canSubmit = Boolean(
    selectedTarget
    && isOpen
    && totalsMatch
    && correctionReady
    && !availabilityExceeded
    && !isSaving,
  );

  useEffect(() => {
    if (targetOpeningId && targets.some((target) => target.opening_id === targetOpeningId)) return;
    setTargetOpeningId(targets[0]?.opening_id ?? "");
    setReceivedCounts({});
  }, [targetOpeningId, targets]);

  const setCount = (setter: React.Dispatch<React.SetStateAction<CountMap>>, available: CountMap, id: string, qty: number) => {
    const normalized = Math.max(0, Math.min(Math.trunc(qty || 0), available[id] ?? 0));
    setter((current) => {
      const next = { ...current };
      if (normalized > 0) next[id] = normalized;
      else delete next[id];
      return next;
    });
  };

  const resetForm = () => {
    setGivenCounts({});
    setReceivedCounts({});
    setReason("");
    setEditingExchange(null);
    setCorrectionReason("");
  };

  const handleTargetChange = (openingId: string) => {
    setTargetOpeningId(openingId);
    setReceivedCounts({});
  };

  const submitExchange = async () => {
    if (!canSubmit) return;
    try {
      await registerExchange.mutateAsync({
        targetOpeningId,
        givenDetail: linesFromCounts(givenCounts),
        receivedDetail: linesFromCounts(receivedCounts),
        reason: reason.trim() || undefined,
        correctionOf: editingExchange?.id,
        correctionReason: correctionReason.trim() || undefined,
      });
      toast.success(editingExchange ? "Cambio corregido" : "Cambio registrado en ambas cajas");
      resetForm();
    } catch (error: any) {
      toast.error(error?.message || "No se pudo registrar el cambio");
    }
  };

  const beginCorrection = (exchange: AuxiliaryExchange) => {
    const activeDenominationIds = new Set(denominations.map((denomination) => denomination.id));
    setEditingExchange(exchange);
    setTargetOpeningId(exchange.target_opening_id);
    setGivenCounts(Object.fromEntries(
      exchange.given_detail
        .filter((line) => activeDenominationIds.has(line.denomination_id))
        .map((line) => [line.denomination_id, line.qty]),
    ));
    setReceivedCounts(Object.fromEntries(
      exchange.received_detail
        .filter((line) => activeDenominationIds.has(line.denomination_id))
        .map((line) => [line.denomination_id, line.qty]),
    ));
    setReason(exchange.reason ?? "");
    setCorrectionReason("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (assignmentQuery.isLoading || contextQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!assignmentQuery.data?.isAssigned) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-amber-200 bg-white p-7 text-center">
        <Lock className="mx-auto h-9 w-9 text-amber-600" />
        <h1 className="mt-3 font-display text-xl font-black">Sin caja auxiliar asignada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Un administrador debe asignarte la caja auxiliar al configurar el turno.
        </p>
      </div>
    );
  }

  if (contextQuery.isError || !context) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-red-200 bg-white p-7 text-center">
        <AlertCircle className="mx-auto h-9 w-9 text-red-600" />
        <p className="mt-3 text-sm">{(contextQuery.error as Error)?.message || "No se pudo cargar la caja auxiliar."}</p>
        <Button className="mt-4" variant="outline" onClick={() => void contextQuery.refetch()}>Reintentar</Button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 px-3 py-4 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Banknote className="h-7 w-7 text-emerald-700" />
              <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">
                Cambio de monedas/billetes
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{activeBranch?.name ?? "Sucursal"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={isOpen ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-100"}>
              {isOpen ? "Caja auxiliar abierta" : "Caja auxiliar cerrada"}
            </Badge>
            {isOpen && (
              <Button variant="outline" className="gap-2" onClick={() => setShowClose(true)}>
                <Lock className="h-4 w-4" /> Cerrar caja
              </Button>
            )}
          </div>
        </header>

        {isOpen && (
          <section className="rounded-3xl border border-orange-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <label className="mb-1 block text-sm font-bold">Cajero que recibe el cambio</label>
              <Select value={targetOpeningId || undefined} onValueChange={handleTargetChange}>
                <SelectTrigger className="h-11 max-w-xl rounded-xl">
                  <SelectValue placeholder="Selecciona una caja abierta..." />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem key={target.opening_id} value={target.opening_id}>
                      {target.cashier_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targets.length === 0 && (
                <p className="mt-2 text-xs text-amber-700">No hay cajas de cajero abiertas disponibles.</p>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ExchangeDenominationEditor
                title="La caja auxiliar entrega"
                description="Dinero que sale de tu caja e ingresa a la caja seleccionada."
                denominations={denominations}
                counts={givenCounts}
                available={auxiliaryAvailable}
                disabled={!selectedTarget || isSaving}
                onChange={(id, qty) => setCount(setGivenCounts, auxiliaryAvailable, id, qty)}
              />
              <ExchangeDenominationEditor
                title="La caja auxiliar recibe"
                description="Dinero que sale de la caja seleccionada e ingresa a tu caja."
                denominations={denominations}
                counts={receivedCounts}
                available={targetAvailable}
                disabled={!selectedTarget || isSaving}
                onChange={(id, qty) => setCount(setReceivedCounts, targetAvailable, id, qty)}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs font-bold uppercase text-sky-700">Entregado</p>
                <p className="text-2xl font-black">${totalGiven.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-bold uppercase text-emerald-700">Recibido</p>
                <p className="text-2xl font-black">${totalReceived.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-bold uppercase text-amber-700">Diferencia</p>
                <p className="text-2xl font-black">${Math.abs(totalGiven - totalReceived).toFixed(2)}</p>
              </div>
            </div>

            {!totalsMatch && (totalGiven > 0 || totalReceived > 0) && (
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-amber-700">
                <AlertCircle className="h-4 w-4" />
                El valor entregado y recibido debe ser exactamente igual.
              </p>
            )}

            {availabilityExceeded && (
              <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-700">
                <AlertCircle className="h-4 w-4" />
                La selección supera las denominaciones disponibles en una de las cajas.
              </p>
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Motivo o referencia (opcional)"
                className="resize-none rounded-xl"
              />
              {editingExchange && (
                <Textarea
                  value={correctionReason}
                  onChange={(event) => setCorrectionReason(event.target.value)}
                  placeholder="Motivo de la corrección (mínimo 5 caracteres)"
                  className="resize-none rounded-xl"
                />
              )}
            </div>

            <div className="mt-4 flex flex-col justify-end gap-2 sm:flex-row">
              {editingExchange && (
                <Button variant="outline" onClick={resetForm} disabled={isSaving}>
                  Cancelar corrección
                </Button>
              )}
              <Button onClick={() => void submitExchange()} disabled={!canSubmit} className="gap-2">
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingExchange ? <RotateCcw className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
                {editingExchange ? "Guardar corrección" : "Registrar cambio"}
              </Button>
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-slate-600" />
            <h2 className="font-display text-lg font-black">Historial y auditoría</h2>
          </div>
          <div className="space-y-2">
            {context.exchanges.length === 0 ? (
              <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Todavía no hay cambios registrados.
              </p>
            ) : context.exchanges.map((exchange) => (
              <article key={exchange.id} className="rounded-2xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold">{exchange.target_cashier_name}</p>
                      <Badge variant="outline">
                        {exchange.status === "active" ? "Activo" : exchange.status === "voided" ? "Anulado" : "Corregido"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(exchange.created_at).toLocaleString("es-EC")} · {exchange.created_by_name}
                    </p>
                    <p className="mt-2 text-xs"><b>Entregado:</b> {formatDetail(exchange, "given_detail", denominations)}</p>
                    <p className="mt-1 text-xs"><b>Recibido:</b> {formatDetail(exchange, "received_detail", denominations)}</p>
                    {exchange.reason && <p className="mt-1 text-xs"><b>Motivo:</b> {exchange.reason}</p>}
                    {exchange.void_reason && <p className="mt-1 text-xs text-red-700"><b>Anulación/corrección:</b> {exchange.void_reason}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black">${Number(exchange.amount).toFixed(2)}</p>
                    {exchange.status === "active" && isOpen && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => beginCorrection(exchange)}>Corregir</Button>
                        <Button size="sm" variant="destructive" onClick={() => setVoidCandidate(exchange)}>Anular</Button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <AlertDialog open={Boolean(voidCandidate)} onOpenChange={(open) => !open && setVoidCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anular cambio</AlertDialogTitle>
            <AlertDialogDescription>
              Se revertirán inmediatamente las denominaciones en ambas cajas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Motivo (mínimo 5 caracteres)" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voidExchange.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={voidReason.trim().length < 5 || voidExchange.isPending}
              onClick={async (event) => {
                event.preventDefault();
                if (!voidCandidate) return;
                try {
                  await voidExchange.mutateAsync({ exchangeId: voidCandidate.id, reason: voidReason.trim() });
                  toast.success("Cambio anulado y saldos revertidos");
                  setVoidCandidate(null);
                  setVoidReason("");
                } catch (error: any) {
                  toast.error(error?.message || "No se pudo anular");
                }
              }}
            >
              Confirmar anulación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClose} onOpenChange={setShowClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar caja auxiliar</AlertDialogTitle>
            <AlertDialogDescription>
              Después del cierre ya no se podrán registrar, corregir ni anular cambios en este turno.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} placeholder="Notas de cierre (opcional)" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeAuxiliaryCash.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={closeAuxiliaryCash.isPending}
              onClick={async (event) => {
                event.preventDefault();
                try {
                  await closeAuxiliaryCash.mutateAsync(closeNotes.trim() || undefined);
                  toast.success("Caja auxiliar cerrada");
                  setShowClose(false);
                } catch (error: any) {
                  toast.error(error?.message || "No se pudo cerrar la caja auxiliar");
                }
              }}
            >
              Cerrar caja
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
