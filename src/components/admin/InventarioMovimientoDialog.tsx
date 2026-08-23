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

type InventarioMovimientoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productoId: string | null;
  productoNombre: string;
  cantidadActual: number;
  sucursalId: string | null;
  onSuccess: () => void;
};

const InventarioMovimientoDialog = ({
  open,
  onOpenChange,
  productoId,
  productoNombre,
  cantidadActual,
  sucursalId,
  onSuccess,
}: InventarioMovimientoDialogProps) => {
  const [tipoMovimiento, setTipoMovimiento] = useState<TipoMovimientoInventario>("INGRESO");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTipoMovimiento("INGRESO");
    setCantidad("");
    setMotivo("");
    setError(null);
  }, [open, productoId]);

  const cantidadNum = normalizarCantidadInventario(cantidad);
  const cantidadNueva = calcularCantidadNuevaMovimiento(cantidadActual, tipoMovimiento, cantidadNum);

  const cantidadLabel = useMemo(() => {
    if (tipoMovimiento === "AJUSTE") return "Cantidad final";
    if (tipoMovimiento === "SALIDA") return "Cantidad a retirar";
    return "Cantidad a ingresar";
  }, [tipoMovimiento]);

  const handleSubmit = async () => {
    if (!productoId || !sucursalId) return;

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

    const { error: rpcError } = await supabase.rpc("registrar_movimiento_inventario", {
      p_producto_id: productoId,
      p_sucursal_id: sucursalId,
      p_tipo_movimiento: tipoMovimiento,
      p_cantidad: cantidadNum,
      p_motivo: motivoMovimientoParaRpc(tipoMovimiento, motivo),
    });

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
                  ? "Opcional. Ej: compra, reposición..."
                  : "Ej: Traslado a sucursal Portoviejo, conteo físico, merma..."
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

export default InventarioMovimientoDialog;
