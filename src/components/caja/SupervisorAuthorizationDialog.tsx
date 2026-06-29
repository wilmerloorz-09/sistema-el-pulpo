import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  paymentLabel: string;
  amountLabel: string;
  shiftLabel: string;
  cashierName: string;
  paymentMethod: string;
  reason: string;
  onConfirm: (params: { identifier: string; password: string }) => Promise<void>;
}

export default function SupervisorAuthorizationDialog({
  open,
  onOpenChange,
  loading = false,
  paymentLabel,
  amountLabel,
  shiftLabel,
  cashierName,
  paymentMethod,
  reason,
  onConfirm,
}: Props) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setIdentifier("");
      setPassword("");
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (!identifier.trim() || !password.trim()) {
      setError("Debes autenticar a un supervisor para continuar.");
      return;
    }

    setError(null);

    try {
      await onConfirm({
        identifier: identifier.trim(),
        password,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo validar al supervisor.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Autorizar anulacion de pago</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Esta accion anulara el pago sin borrar su historial.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Pago</p>
              <p className="font-semibold text-foreground">{paymentLabel}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Monto</p>
              <p className="font-semibold text-foreground">{amountLabel}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Turno</p>
              <p className="font-semibold text-foreground">{shiftLabel}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Metodo</p>
              <p className="font-semibold text-foreground">{paymentMethod}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cajero solicitante</p>
              <p className="font-semibold text-foreground">{cashierName}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-muted-foreground">Motivo</p>
              <p className="font-semibold text-foreground">{reason}</p>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="space-y-2">
              <Label htmlFor="void-supervisor-identifier">Correo, usuario o alias del autorizador</Label>
              <Input
                id="void-supervisor-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Ej: supervisor1, alias o correo"
                autoComplete="username"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="void-supervisor-password">Contrasena del autorizador</Label>
              <Input
                id="void-supervisor-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Ingresa la credencial del autorizador"
                autoComplete="current-password"
                disabled={loading}
              />
            </div>
          </div>

          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="h-9 rounded-lg border border-border px-3 text-sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => void handleConfirm()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Confirmar anulacion
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
