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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyCheck } from "lucide-react";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import type { Banco } from "@/hooks/useBancosActivos";
import type { TransferenciaPagoDatos } from "@/lib/transferenciaPago";
import {
  formatTransferenciaMontoInput,
  parseTransferenciaMontoInput,
} from "@/lib/transferenciaPago";
import {
  existeTransferenciaDuplicada,
  MENSAJE_TRANSFERENCIA_DUPLICADA,
} from "@/lib/transferenciaDuplicada";

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
  bancos,
  netChargeTotal,
  readOnly = false,
  initialDatos,
  onConfirm,
}: Props) {
  const [bancoId, setBancoId] = useState("");
  const [numeroTransferencia, setNumeroTransferencia] = useState("");
  const [montoInput, setMontoInput] = useState("");
  const [validando, setValidando] = useState(false);
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMensaje(null);
    setBancoId(initialDatos?.bancoId ?? bancos[0]?.id ?? "");
    setNumeroTransferencia(initialDatos?.numeroTransferencia ?? "");
    setMontoInput(
      initialDatos?.monto
        ? formatTransferenciaMontoInput(initialDatos.monto)
        : "",
    );
  }, [open, initialDatos?.bancoId, initialDatos?.numeroTransferencia, initialDatos?.monto, bancos]);

  const handleExacto = () => {
    const current = parseTransferenciaMontoInput(montoInput);
    const isExact = Math.abs(current - netChargeTotal) < 0.005;
    if (isExact) {
      setMontoInput("");
      return;
    }
    setMontoInput(netChargeTotal.toFixed(2));
  };

  const handleConfirm = async () => {
    const monto = parseTransferenciaMontoInput(montoInput);
    if (!bancoId) return;
    if (!numeroTransferencia.trim()) return;
    if (monto <= 0) return;

    setValidando(true);
    setErrorMensaje(null);
    try {
      const duplicada = await existeTransferenciaDuplicada(bancoId, numeroTransferencia);
      if (duplicada) {
        setErrorMensaje(MENSAJE_TRANSFERENCIA_DUPLICADA);
        return;
      }

      onConfirm({
        bancoId,
        numeroTransferencia: numeroTransferencia.trim(),
        monto,
      });
      onOpenChange(false);
    } catch {
      setErrorMensaje("No se pudo validar el numero de transferencia. Intenta de nuevo.");
    } finally {
      setValidando(false);
    }
  };

  const montoActual = parseTransferenciaMontoInput(montoInput);
  const isExact = Math.abs(montoActual - netChargeTotal) < 0.005;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar transferencia</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {errorMensaje ? (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm font-medium text-destructive"
            >
              {errorMensaje}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="transfer-banco">Banco</Label>
            <Select
              value={bancoId}
              onValueChange={(value) => {
                setErrorMensaje(null);
                setBancoId(value);
              }}
              disabled={readOnly}
            >
              <SelectTrigger id="transfer-banco">
                <SelectValue placeholder="Selecciona un banco" />
              </SelectTrigger>
              <SelectContent>
                {bancos.map((banco) => (
                  <SelectItem key={banco.id} value={banco.id}>
                    {banco.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-numero">Número de transferencia</Label>
            <Input
              id="transfer-numero"
              value={numeroTransferencia}
              onChange={(e) => {
                setErrorMensaje(null);
                setNumeroTransferencia(e.target.value);
              }}
              disabled={readOnly}
              placeholder="Referencia o comprobante"
              className="font-mono"
            />
          </div>

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
              onChange={(e) => setMontoInput(sanitizeDecimalInput(e.target.value))}
              disabled={readOnly}
              className="text-base font-semibold tabular-nums"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={
              validando
              || readOnly
              || !bancoId
              || !numeroTransferencia.trim()
              || parseTransferenciaMontoInput(montoInput) <= 0
            }
            onClick={() => void handleConfirm()}
          >
            {validando ? "Validando..." : "Aceptar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
