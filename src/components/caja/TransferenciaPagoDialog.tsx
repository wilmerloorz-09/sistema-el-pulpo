import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import type { Banco } from "@/hooks/useBancosActivos";
import type { TransferenciaPagoDatos } from "@/lib/transferenciaPago";
import {
  formatTransferenciaMontoInput,
  parseTransferenciaMontoInput,
} from "@/lib/transferenciaPago";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bancos: Banco[];
  netChargeTotal: number;
  readOnly?: boolean;
  initialDatos?: TransferenciaPagoDatos | null;
  onConfirm: (datos: TransferenciaPagoDatos) => void;
}

export default function TransferenciaPagoDialog({
  open,
  onOpenChange,
  netChargeTotal,
  readOnly = false,
  initialDatos,
  onConfirm,
}: Props) {
  const [montoInput, setMontoInput] = useState("");
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMensaje(null);
    setMontoInput(
      initialDatos?.monto
        ? formatTransferenciaMontoInput(initialDatos.monto)
        : "",
    );
  }, [open, initialDatos?.monto]);

  const handleExacto = () => {
    const current = parseTransferenciaMontoInput(montoInput);
    const isExact = Math.abs(current - netChargeTotal) < 0.005;
    if (isExact) {
      setMontoInput("");
      return;
    }
    setMontoInput(netChargeTotal.toFixed(2));
  };

  const handleConfirm = () => {
    const monto = parseTransferenciaMontoInput(montoInput);
    if (monto <= 0) {
      setErrorMensaje("Ingresa el valor de la transferencia.");
      return;
    }

    setErrorMensaje(null);
    onConfirm({
      bancoId: "",
      numeroTransferencia: "",
      monto,
      fotoArchivo: null,
      fotoVistaPreviaUrl: null,
      analisisIa: null,
      validacionComprobante: null,
      motivoAceptacion: null,
    });
    onOpenChange(false);
  };

  const montoActual = parseTransferenciaMontoInput(montoInput);
  const isExact = Math.abs(montoActual - netChargeTotal) < 0.005;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-0.75rem)] max-w-md flex-col gap-3 overflow-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:max-h-[90vh] sm:p-6 sm:pb-6",
        )}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Registrar transferencia</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-1">
          {errorMensaje ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
            >
              {errorMensaje}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="transfer-monto">Valor</Label>
              <button
                type="button"
                disabled={readOnly}
                onClick={handleExacto}
                className="flex shrink-0 items-center gap-0.5 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase text-violet-700 shadow-sm transition-colors hover:bg-violet-100 disabled:opacity-50"
                title={isExact ? "Limpiar monto" : "Usar monto total"}
              >
                <CopyCheck className="h-3 w-3" />
                {isExact ? "Limpiar" : "Exacto"}
              </button>
            </div>
            <Input
              id="transfer-monto"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={montoInput}
              onChange={(e) => {
                setErrorMensaje(null);
                setMontoInput(sanitizeDecimalInput(e.target.value));
              }}
              disabled={readOnly}
              className="text-base font-semibold tabular-nums"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="footer-safe-bottom shrink-0 flex-row justify-end gap-2 space-x-0 border-t border-border/60 pt-3 sm:gap-2 sm:pb-0">
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            className="flex-1 sm:flex-none"
            disabled={readOnly || parseTransferenciaMontoInput(montoInput) <= 0}
            onClick={handleConfirm}
          >
            Aceptar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
