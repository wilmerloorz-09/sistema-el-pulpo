import { useState } from "react";
import { Gift, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getOrderRef, getOrderTypeLabel } from "@/lib/orderPresentation";
import { usePromociones } from "@/hooks/usePromociones";
import { useAuth } from "@/contexts/AuthContext";
import { dbUpdate } from "@/services/DatabaseService";
import { nombreCompletoCliente } from "@/lib/clientesValidacion";
import PrediccionOrdenDialog from "@/components/promociones/PrediccionOrdenDialog";
import type { OrdenElegiblePromocion } from "@/types/campanaPromocional";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(amount);
}

const PromocionesCrud = () => {
  const { user } = useAuth();
  const {
    campanasActivas,
    campanaSeleccionada,
    setCampanaSeleccionada,
    campanasCargando,
    ordenesElegibles,
    ordenesCargando,
    registrarPrediccion,
    isRegistrando,
  } = usePromociones();

  const [ordenSeleccionada, setOrdenSeleccionada] = useState<OrdenElegiblePromocion | null>(null);

  if (campanasCargando || ordenesCargando) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!campanaSeleccionada) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
        <Gift className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="font-medium text-foreground">No hay campaña promocional activa</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Un administrador debe activar una campaña para registrar predicciones.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {campanasActivas.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="promo-campana-select" className="text-xs font-semibold uppercase text-muted-foreground">
            Campaña
          </Label>
          <Select
            value={campanaSeleccionada.id}
            onValueChange={setCampanaSeleccionada}
            disabled={isRegistrando}
          >
            <SelectTrigger id="promo-campana-select" className="rounded-xl bg-white">
              <SelectValue placeholder="Elige una campaña" />
            </SelectTrigger>
            <SelectContent>
              {campanasActivas.map((campana) => (
                <SelectItem key={campana.id} value={campana.id}>
                  {campana.titulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="rounded-2xl border border-violet-200 bg-violet-50/60 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">
          {campanasActivas.length > 1 ? "Campaña seleccionada" : "Campaña activa"}
        </p>
        <p className="font-display text-lg font-bold text-violet-950">{campanaSeleccionada.titulo}</p>
        <p className="text-xs text-violet-800/90">
          Consumo mínimo {formatCurrency(campanaSeleccionada.consumo_minimo)} · Descuento hasta{" "}
          {campanaSeleccionada.porcentaje_descuento}% (máx.{" "}
          {formatCurrency(campanaSeleccionada.descuento_maximo)})
        </p>
      </div>

      {ordenesElegibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center text-muted-foreground">
          <Receipt className="mx-auto mb-2 h-9 w-9 opacity-40" />
          <p className="text-sm font-medium">No hay órdenes elegibles</p>
          <p className="text-xs">Órdenes pagadas del turno, sin participación y que cumplan el consumo mínimo.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ordenesElegibles.map((orden) => {
            const ref = getOrderRef(orden.order_code, orden.order_number);
            return (
              <button
                key={orden.id}
                type="button"
                onClick={() => setOrdenSeleccionada(orden)}
                className={cn(
                  "rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-violet-300 hover:shadow-md",
                )}
              >
                <p className="font-display text-lg font-bold text-slate-900">Orden {ref}</p>
                <p className="text-xs uppercase text-muted-foreground">
                  {getOrderTypeLabel(orden.order_type)}
                </p>
                <p className="mt-2 font-display text-xl font-black tabular-nums text-sky-900">
                  {formatCurrency(orden.total)}
                </p>
                {orden.cliente ? (
                  <p className="mt-2 truncate text-xs text-slate-600">
                    {nombreCompletoCliente(orden.cliente)} · {orden.cliente.cedula}
                  </p>
                ) : (
                  <p className="mt-2 text-xs italic text-muted-foreground">Sin cliente asignado</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      <PrediccionOrdenDialog
        abierto={Boolean(ordenSeleccionada)}
        orden={ordenSeleccionada}
        campana={campanaSeleccionada}
        guardando={isRegistrando}
        onCerrar={() => !isRegistrando && setOrdenSeleccionada(null)}
        onConfirmar={async ({ clienteId, ofertaId }) => {
          if (!ordenSeleccionada || !user?.id) return;
          await registrarPrediccion({
            campana_id: campanaSeleccionada.id,
            orden_id: ordenSeleccionada.id,
            cliente_id: clienteId,
            oferta_seleccionada_id: ofertaId,
            registrado_por: user.id,
          });
          if (ordenSeleccionada.cliente_id !== clienteId) {
            await dbUpdate("orders", ordenSeleccionada.id, { cliente_id: clienteId });
          }
          setOrdenSeleccionada(null);
        }}
      />
    </div>
  );
};

export default PromocionesCrud;
