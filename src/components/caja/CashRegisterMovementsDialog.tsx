import { useMemo, useState } from "react";
import type {
  CashRegisterMovement,
  CashRegisterMovementDetail,
  CashRegisterMovementDetailLine,
} from "@/hooks/useCaja";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DenominationVisual from "@/components/caja/DenominationVisual";
import { cn } from "@/lib/utils";
import { AlertCircle, ArrowRightLeft, Clock, Coins, DollarSign, Loader2 } from "lucide-react";

type DenominationOption = {
  id: string;
  label: string;
  value: number;
  imageUrl?: string | null;
  currentQty: number;
};

type RegisterMovementParams = {
  type: "entrada" | "salida" | "cambio_denominacion";
  amount: number;
  reason: string;
  detail: CashRegisterMovementDetail;
};

interface CashRegisterMovementsListProps {
  movements: CashRegisterMovement[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
}

interface CashRegisterMovementsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movements: CashRegisterMovement[];
  denominationOptions: DenominationOption[];
  loading?: boolean;
  canRegister?: boolean;
  registering?: boolean;
  onRegister: (payload: RegisterMovementParams) => Promise<void>;
}

function movementMeta(type: CashRegisterMovement["movementType"]) {
  switch (type) {
    case "entrada":
      return {
        label: "Entrada",
        badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
        amountClassName: "text-emerald-700",
      };
    case "salida":
      return {
        label: "Salida",
        badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
        amountClassName: "text-rose-700",
      };
    case "cambio_denominacion":
    default:
      return {
        label: "Cambio de denominacion",
        badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
        amountClassName: "text-sky-700",
      };
  }
}

function formatDateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("es-EC", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatBreakdown(lines: CashRegisterMovementDetailLine[]) {
  return lines
    .map((line) => `${line.qty}x $${line.value.toFixed(2)}`)
    .join(" + ");
}

function buildDetailLines(
  denominationOptions: DenominationOption[],
  counts: Record<string, number>,
): CashRegisterMovementDetailLine[] {
  return denominationOptions
    .map((option) => {
      const qty = counts[option.id] ?? 0;
      return {
        denomination_id: option.id,
        label: option.label,
        value: option.value,
        qty,
        total: Number((qty * option.value).toFixed(2)),
        image_url: option.imageUrl ?? null,
      };
    })
    .filter((line) => line.qty > 0);
}

function DenominationEditorSection({
  title,
  description,
  counts,
  options,
  showAvailable = false,
  enforceAvailable = false,
  accentClasses,
  onChange,
}: {
  title: string;
  description: string;
  counts: Record<string, number>;
  options: DenominationOption[];
  showAvailable?: boolean;
  enforceAvailable?: boolean;
  accentClasses: {
    border: string;
    background: string;
    title: string;
  };
  onChange: (denominationId: string, nextQty: number) => void;
}) {
  return (
    <div className={cn("rounded-xl border p-2.5 shadow-sm sm:rounded-2xl sm:p-3", accentClasses.border, accentClasses.background)}>
      <div className="mb-2.5">
        <p className={cn("text-sm font-semibold", accentClasses.title)}>{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        {options.map((option) => (
          <div
            key={option.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_56px_64px] items-center gap-2 rounded-lg border border-orange-200 bg-white px-2 py-1.5 sm:grid-cols-[auto_minmax(0,1fr)_64px_72px] sm:rounded-xl sm:py-2"
          >
            <DenominationVisual
              label={option.label}
              imageUrl={option.imageUrl}
              className="h-9 w-9 rounded-lg sm:h-10 sm:w-10 sm:rounded-xl"
              iconClassName="h-3.5 w-3.5 sm:h-4 sm:w-4"
            />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground sm:text-sm">{option.label}</p>
              <p className="text-xs font-medium text-red-600">${option.value.toFixed(2)}</p>
              {showAvailable && (
                <p className="text-[11px] text-muted-foreground">Disponible: {option.currentQty}</p>
              )}
            </div>

            <Input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={counts[option.id] ?? 0}
              max={enforceAvailable ? option.currentQty : undefined}
              onChange={(event) => onChange(option.id, Number.parseInt(event.target.value || "0", 10))}
              onBlur={(event) => onChange(option.id, Number.parseInt(event.target.value || "0", 10))}
              className="h-8 rounded-lg px-1.5 text-center text-xs font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none sm:h-9 sm:px-2 sm:text-sm"
            />

            <span className="text-right text-[11px] font-bold text-foreground sm:text-sm">
              ${((counts[option.id] ?? 0) * option.value).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CashRegisterMovementsList({
  movements,
  loading = false,
  emptyMessage = "Sin movimientos en este turno",
  className,
  compact = false,
}: CashRegisterMovementsListProps) {
  if (loading) {
    return (
      <div className={cn("rounded-2xl border border-orange-200 bg-white p-6 text-center", className)}>
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
        <p className="mt-2 text-sm text-muted-foreground">Cargando movimientos...</p>
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className={cn("rounded-2xl border border-dashed border-orange-200 bg-white px-4 py-8 text-center", className)}>
        <Coins className="mx-auto h-8 w-8 text-orange-300" />
        <p className="mt-3 text-sm font-medium text-foreground">{emptyMessage}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Cuando registres cambios de denominacion apareceran aqui.
        </p>
      </div>
    );
  }

  return (
    <div className={cn(compact ? "max-h-[240px] space-y-1.5 overflow-y-auto pr-1" : "space-y-2", className)}>
      {movements.map((movement) => {
        const meta = movementMeta(movement.movementType);
        const movementDetail = movement.movementDetail;

        return (
          <div
            key={movement.id}
            className={cn(
              "border border-orange-200 bg-white shadow-[0_16px_40px_-34px_rgba(249,115,22,0.5)]",
              compact ? "rounded-xl p-2.5" : "rounded-2xl p-3",
            )}
          >
            <div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2"} sm:flex-row sm:items-start sm:justify-between`}>
              <div className={cn("min-w-0", compact ? "space-y-1.5" : "space-y-2")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("font-semibold", meta.badgeClassName)}>
                    {meta.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {movement.recordedByName ?? movement.recordedByUsername ?? "Usuario"}
                  </span>
                </div>
                <p className="text-sm leading-6 text-foreground">{movement.reason}</p>

                {movementDetail?.kind === "cambio_denominacion" && (
                  <div className={cn(
                    "border border-sky-200 bg-sky-50 text-xs text-sky-900",
                    compact ? "rounded-lg px-2.5 py-1.5" : "rounded-xl px-3 py-2",
                  )}>
                    <p>
                      <span className="font-semibold">Sale:</span> {formatBreakdown(movementDetail.from)}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold">Ingresa:</span> {formatBreakdown(movementDetail.to)}
                    </p>
                  </div>
                )}
              </div>

              <div className={cn("flex shrink-0 items-center justify-between sm:flex-col sm:items-end", compact ? "gap-3" : "gap-4")}>
                <span className={cn("font-display text-lg font-black", meta.amountClassName)}>
                  ${movement.amount.toFixed(2)}
                </span>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTimeLabel(movement.createdAt)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CashRegisterMovementsDialog({
  open,
  onOpenChange,
  movements,
  denominationOptions,
  loading = false,
  canRegister = true,
  registering = false,
  onRegister,
}: CashRegisterMovementsDialogProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [reason, setReason] = useState("");
  const [fromCounts, setFromCounts] = useState<Record<string, number>>({});
  const [toCounts, setToCounts] = useState<Record<string, number>>({});

  const trimmedReason = reason.trim();
  const fromLines = useMemo(() => buildDetailLines(denominationOptions, fromCounts), [denominationOptions, fromCounts]);
  const toLines = useMemo(() => buildDetailLines(denominationOptions, toCounts), [denominationOptions, toCounts]);
  const totalFrom = useMemo(() => fromLines.reduce((sum, line) => sum + line.total, 0), [fromLines]);
  const totalTo = useMemo(() => toLines.reduce((sum, line) => sum + line.total, 0), [toLines]);
  const totalsMatch = Math.abs(totalFrom - totalTo) <= 0.009;
  const hasSource = totalFrom > 0;
  const hasTarget = totalTo > 0;
  const sourceAvailabilityExceeded = useMemo(
    () => denominationOptions.some((option) => (fromCounts[option.id] ?? 0) > option.currentQty),
    [denominationOptions, fromCounts],
  );
  const canConfirm = hasSource && hasTarget && totalsMatch && !sourceAvailabilityExceeded && trimmedReason.length > 0 && !registering;

  const resetRegisterForm = () => {
    setReason("");
    setFromCounts({});
    setToCounts({});
    setShowHistory(false);
  };

  const handleCountChange = (
    side: "from" | "to",
    denominationId: string,
    nextQty: number,
  ) => {
    const option = denominationOptions.find((item) => item.id === denominationId);
    const maxAvailable = side === "from" ? (option?.currentQty ?? 0) : Number.MAX_SAFE_INTEGER;
    const normalized = Math.max(
      0,
      Math.min(
        Math.floor(Number.isFinite(nextQty) ? nextQty : 0),
        maxAvailable,
      ),
    );
    const setter = side === "from" ? setFromCounts : setToCounts;

    setter((prev) => {
      if (normalized <= 0) {
        const next = { ...prev };
        delete next[denominationId];
        return next;
      }

      return {
        ...prev,
        [denominationId]: normalized,
      };
    });
  };

  const handleRegister = async () => {
    if (!canConfirm) return;

    try {
      await onRegister({
        type: "cambio_denominacion",
        amount: Number(totalFrom.toFixed(2)),
        reason: trimmedReason,
        detail: {
          kind: "cambio_denominacion",
          from: fromLines,
          to: toLines,
          totals: {
            from: Number(totalFrom.toFixed(2)),
            to: Number(totalTo.toFixed(2)),
          },
        },
      });
      resetRegisterForm();
      onOpenChange(false);
    } catch {
      // El mensaje ya lo muestra la mutacion compartida.
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!registering) {
          onOpenChange(nextOpen);
          if (!nextOpen) resetRegisterForm();
        }
      }}
    >
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto border-orange-200 bg-white shadow-[0_32px_80px_-44px_rgba(249,115,22,0.55)] sm:max-w-[96vw] lg:max-w-6xl">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <DialogTitle className="font-display flex items-center gap-2">
                <Coins className="h-5 w-5 text-primary" />
                Registrar cambio de denominacion
              </DialogTitle>
              <DialogDescription>
                Define que denominaciones entran a caja y que denominaciones salen de caja. Ambos lados deben cuadrar.
              </DialogDescription>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full self-start sm:w-auto"
              onClick={() => setShowHistory((prev) => !prev)}
            >
              {showHistory ? "Ocultar historial" : `Ver historial (${movements.length})`}
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {!canRegister && (
            <div className="rounded-xl border border-border bg-white px-3 py-2 text-xs text-muted-foreground">
              Modo consulta: no puedes registrar movimientos desde esta cuenta.
            </div>
          )}

          <div className="grid gap-3.5 lg:grid-cols-2">
            <DenominationEditorSection
              title="Se cambia desde caja"
              description="Estas denominaciones salen de la caja actual y deben existir disponibles."
              counts={fromCounts}
              options={denominationOptions}
              showAvailable
              enforceAvailable
              accentClasses={{
                border: "border-sky-200",
                background: "bg-sky-50/70",
                title: "text-sky-800",
              }}
              onChange={(denominationId, nextQty) => handleCountChange("from", denominationId, nextQty)}
            />

            <DenominationEditorSection
              title="Ingresa a caja"
              description="Estas denominaciones vuelven a ingresar a la caja luego del cambio."
              counts={toCounts}
              options={denominationOptions}
              accentClasses={{
                border: "border-emerald-200",
                background: "bg-emerald-50/70",
                title: "text-emerald-800",
              }}
              onChange={(denominationId, nextQty) => handleCountChange("to", denominationId, nextQty)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-sky-700">Sale de caja</p>
              <p className="font-display mt-1 text-2xl font-black text-sky-700">${totalFrom.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-emerald-700">Ingresa a caja</p>
              <p className="font-display mt-1 text-2xl font-black text-emerald-700">${totalTo.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-amber-700">Diferencia</p>
              <p className="font-display mt-1 text-2xl font-black text-amber-700">
                ${(totalFrom - totalTo).toFixed(2)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Motivo</p>
            <Textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej: Cambio para dar vuelto al cliente"
              className="resize-none rounded-xl"
            />
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-800">Impacto en caja</p>
                <p className="text-xs text-emerald-700/80">
                  El efectivo total no cambia; solo cambia la composicion de denominaciones.
                </p>
              </div>
              <span className="font-display text-xl font-black text-emerald-700">$0.00</span>
            </div>
          </div>

          {!hasSource && !hasTarget && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Debes indicar que denominaciones salen de caja y cuales ingresan a caja.
            </div>
          )}

          {(hasSource || hasTarget) && !totalsMatch && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              El total que sale de caja y el total que ingresa a caja deben ser exactamente iguales.
            </div>
          )}

          {sourceAvailabilityExceeded && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No puedes cambiar mas unidades de las que existen actualmente en caja.
            </div>
          )}

          {showHistory && (
            <div className="rounded-2xl border border-orange-200 bg-gradient-to-r from-white via-orange-50 to-amber-50 p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Movimientos del turno</p>
                  <p className="text-xs text-muted-foreground">Historial reciente del turno activo.</p>
                </div>
                <Badge variant="outline" className="border-orange-200 bg-white text-foreground">
                  {movements.length} movimiento(s)
                </Badge>
              </div>

              <CashRegisterMovementsList
                movements={movements}
                loading={loading}
                emptyMessage="Sin movimientos en este turno"
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetRegisterForm();
            }}
            disabled={registering}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            variant="success"
            onClick={handleRegister}
            disabled={!canRegister || !canConfirm}
            className="w-full sm:w-auto"
          >
            {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Confirmar cambio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
