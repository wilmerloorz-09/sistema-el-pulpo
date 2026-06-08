import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import PaymentClienteCard from "@/components/caja/PaymentClienteCard";
import { usePaymentClienteSelection } from "@/hooks/usePaymentClienteSelection";
import type { CampanaPromocional, OfertaCartelera, OrdenElegiblePromocion } from "@/types/campanaPromocional";

function ofertaDisponible(oferta: OfertaCartelera): boolean {
  console.log("Evaluando oferta:", oferta.descripcion, oferta.id_oferta);
  if (oferta.resultado === "GANADA" || oferta.resultado === "PERDIDA") {
    console.log(" - Filtrada por resultado:", oferta.resultado);
    return false;
  }

  if (!oferta.bloqueo_at) {
    console.log(" - Filtrada por falta de bloqueo_at");
    return false;
  }
  const ahora = Date.now();
  const bloqueoTime = new Date(oferta.bloqueo_at).getTime();
  
  if (ahora > bloqueoTime) {
    console.log(" - Filtrada por bloqueo expirado. ahora:", ahora, "bloqueoTime:", bloqueoTime);
    return false;
  }

  if (oferta.inicio_at) {
    const inicioTime = new Date(oferta.inicio_at).getTime();
    if (ahora < inicioTime) {
      console.log(" - Filtrada por inicio en el futuro. ahora:", ahora, "inicioTime:", inicioTime);
      return false;
    }
  }

  console.log(" - Oferta disponible!");
  return true;
}

interface PrediccionOrdenDialogProps {
  abierto: boolean;
  orden: OrdenElegiblePromocion | null;
  campana: CampanaPromocional | null;
  guardando?: boolean;
  onCerrar: () => void;
  onConfirmar: (payload: {
    clienteId: string;
    ofertaId: string;
  }) => Promise<void>;
}

export default function PrediccionOrdenDialog({
  abierto,
  orden,
  campana,
  guardando = false,
  onCerrar,
  onConfirmar,
}: PrediccionOrdenDialogProps) {
  const [ofertaSeleccionada, setOfertaSeleccionada] = useState<string | null>(null);

  const ordenParaCliente = useMemo(
    () => (orden ? { id: orden.id, cliente: orden.cliente ?? null } : null),
    [orden],
  );

  const clienteSelection = usePaymentClienteSelection(ordenParaCliente, abierto);

  useEffect(() => {
    if (!abierto) return;
    setOfertaSeleccionada(null);
  }, [abierto, orden?.id]);

  const ofertasVisibles = useMemo(
    () => (campana?.cartelera_ofertas ?? []).filter(ofertaDisponible),
    [campana?.cartelera_ofertas],
  );

  const puedeConfirmar = Boolean(clienteSelection.selectedCliente && ofertaSeleccionada && !guardando);

  const handleConfirmar = async () => {
    const cliente = clienteSelection.selectedCliente;
    if (!cliente || !ofertaSeleccionada) return;
    await onConfirmar({ clienteId: cliente.id, ofertaId: ofertaSeleccionada });
  };

  return (
    <Dialog open={abierto} onOpenChange={(open) => !open && !guardando && onCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Registrar predicción</DialogTitle>
          <DialogDescription>
            {campana?.titulo ? `Campaña: ${campana.titulo}` : "Selecciona la oferta del comensal."}
          </DialogDescription>
        </DialogHeader>

        {!orden || !campana ? null : (
          <div className="space-y-4">
            <PaymentClienteCard
              order={ordenParaCliente}
              selection={clienteSelection}
              clienteRequerido
              readOnly={guardando}
            />

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Ofertas disponibles</p>
              {ofertasVisibles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay ofertas abiertas en este momento.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {ofertasVisibles.map((oferta) => (
                    <button
                      key={oferta.id_oferta}
                      type="button"
                      disabled={!clienteSelection.selectedCliente || guardando}
                      onClick={() => setOfertaSeleccionada(oferta.id_oferta)}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left transition-colors",
                        ofertaSeleccionada === oferta.id_oferta
                          ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200"
                          : "border-border bg-white hover:border-violet-200",
                      )}
                    >
                      <p className="text-sm font-semibold text-slate-900">{oferta.descripcion}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cuota: <span className="font-mono font-semibold">{Number(oferta.cuota).toFixed(2)}</span>
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" disabled={!puedeConfirmar} onClick={() => void handleConfirmar()}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirmar participación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
