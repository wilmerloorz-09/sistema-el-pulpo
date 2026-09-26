import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  calcularCantidadNuevaMovimiento,
  etiquetaTipoMovimientoInventario,
  motivoMovimientoParaRpc,
  normalizarCantidadInventario,
  validarMovimientoInventario,
  type TipoMovimientoInventario,
} from "@/lib/inventarioProductos";

type BodegaSucursalMovimientoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productoGlobalId: string | null;
  productoNombre: string;
  cantidadActual: number;
  sucursalId: string | null;
  defaultTipoMovimiento?: TipoMovimientoInventario;
  onSuccess: () => void;
};

const BodegaSucursalMovimientoDialog = ({
  open,
  onOpenChange,
  productoGlobalId,
  productoNombre,
  cantidadActual,
  sucursalId,
  defaultTipoMovimiento = "INGRESO",
  onSuccess,
}: BodegaSucursalMovimientoDialogProps) => {
  const [tipoMovimiento, setTipoMovimiento] = useState<TipoMovimientoInventario>(defaultTipoMovimiento);
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTipoMovimiento(defaultTipoMovimiento);
    setCantidad("");
    setMotivo("");
    setError(null);
  }, [open, productoGlobalId, defaultTipoMovimiento]);

  const cantidadNum = normalizarCantidadInventario(cantidad);
  const cantidadNueva = calcularCantidadNuevaMovimiento(cantidadActual, tipoMovimiento, cantidadNum);

  const cantidadLabel = useMemo(() => {
    if (tipoMovimiento === "AJUSTE") return "Cantidad final";
    if (tipoMovimiento === "SALIDA") return "Cantidad a retirar";
    return "Cantidad a ingresar";
  }, [tipoMovimiento]);

  const handleSubmit = async () => {
    if (!productoGlobalId || !sucursalId) return;

    const validationError = validarMovimientoInventario(
      cantidadActual,
      tipoMovimiento,
      cantidadNum,
      motivo,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("registrar_movimiento_bodega_sucursal" as any, {
      p_producto_global_id: productoGlobalId,
      p_sucursal_id: sucursalId,
      p_tipo_movimiento: tipoMovimiento,
      p_cantidad: cantidadNum,
      p_motivo: motivoMovimientoParaRpc(tipoMovimiento, motivo),
    } as any);

    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    onSuccess();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>Registrar movimiento</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-sm">
            <p className="font-semibold text-foreground">{productoNombre}</p>
            <p className="text-xs text-muted-foreground">
              Stock actual: <span className="font-semibold tabular-nums">{cantidadActual}</span>
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Tipo de movimiento</Label>
            <Select
              value={tipoMovimiento}
              onValueChange={(value) => setTipoMovimiento(value as TipoMovimientoInventario)}
            >
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INGRESO">{etiquetaTipoMovimientoInventario("INGRESO")}</SelectItem>
                <SelectItem value="SALIDA">{etiquetaTipoMovimientoInventario("SALIDA")}</SelectItem>
                <SelectItem value="AJUSTE">{etiquetaTipoMovimientoInventario("AJUSTE")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{cantidadLabel}</Label>
            <Input
              type="number"
              min={0}
              step="0.001"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="h-10 rounded-xl tabular-nums"
              placeholder={tipoMovimiento === "AJUSTE" ? "Ej: 25" : "Ej: 10"}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">
              Motivo{tipoMovimiento === "INGRESO" ? " (opcional)" : ""}
            </Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              className="min-h-[80px] rounded-xl"
              placeholder={
                tipoMovimiento === "INGRESO"
                  ? "Opcional. Ej: recepción, reposición..."
                  : "Ej: conteo físico, merma, corrección..."
              }
            />
          </div>

          <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-teal-900">
            Resultado: <span className="font-semibold tabular-nums">{cantidadActual}</span>
            {" → "}
            <span className="font-semibold tabular-nums">{cantidadNueva}</span>
          </div>

          {error ? (
            <p className="text-xs font-medium text-destructive">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl"
              disabled={saving}
              onClick={() => void handleSubmit()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registrar movimiento"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BodegaSucursalMovimientoDialog;
