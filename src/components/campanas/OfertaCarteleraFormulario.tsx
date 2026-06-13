import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { OfertaCartelera } from "@/types/campanaPromocional";
import {
  bloqueoAtDesdeInputFecha,
  inicioAtDesdeInputFecha,
  bloqueoAtParaInputFecha,
  nuevaOfertaCartelera,
  prepararOfertaParaGuardar,
  validarOfertaCartelera,
} from "@/lib/campanasValidacion";

export interface OfertaCarteleraFormularioProps {
  abierto: boolean;
  modo: "crear" | "editar";
  ofertaInicial?: OfertaCartelera | null;
  idNuevaOferta?: string;
  guardando?: boolean;
  onCerrar: () => void;
  onGuardar: (payload: { modo: "crear" | "editar"; oferta: OfertaCartelera }) => Promise<void>;
}

export default function OfertaCarteleraFormulario({
  abierto,
  modo,
  ofertaInicial,
  idNuevaOferta,
  guardando = false,
  onCerrar,
  onGuardar,
}: OfertaCarteleraFormularioProps) {
  const [valores, setValores] = useState<OfertaCartelera>(() => nuevaOfertaCartelera());
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [intentoEnvio, setIntentoEnvio] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setIntentoEnvio(false);
    setErrorGeneral(null);
    if (modo === "editar" && ofertaInicial) {
      setValores({
        ...ofertaInicial,
        inicio_at: ofertaInicial.inicio_at
          ? inicioAtDesdeInputFecha(bloqueoAtParaInputFecha(ofertaInicial.inicio_at))
          : "",
        bloqueo_at: bloqueoAtDesdeInputFecha(bloqueoAtParaInputFecha(ofertaInicial.bloqueo_at)),
      });
    } else {
      setValores(nuevaOfertaCartelera(idNuevaOferta));
    }
  }, [abierto, modo, ofertaInicial, idNuevaOferta]);

  const titulo = modo === "crear" ? "Nueva oferta" : "Editar oferta";
  const descripcion =
    modo === "crear"
      ? "Agrega una opción a la cartelera de la campaña."
      : "Actualiza la oferta sin salir del listado.";

  const errorVisible = useMemo(() => {
    if (!intentoEnvio) return null;
    return errorGeneral;
  }, [intentoEnvio, errorGeneral]);

  const handleCerrar = () => {
    if (guardando) return;
    onCerrar();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIntentoEnvio(true);
    const err = validarOfertaCartelera(valores);
    setErrorGeneral(err);
    if (err) return;

    const oferta = prepararOfertaParaGuardar(valores);
    await onGuardar({ modo, oferta });
  };

  return (
    <Dialog open={abierto} onOpenChange={(open) => !open && handleCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="oferta-descripcion" className="text-xs font-medium text-muted-foreground">
              Descripción *
            </Label>
            <Input
              id="oferta-descripcion"
              className="h-9 max-w-md"
              value={valores.descripcion}
              disabled={guardando}
              onChange={(e) => setValores((p) => ({ ...p, descripcion: e.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Tipo de oferta *</Label>
            <RadioGroup
              value={valores.tipo_oferta ?? "RESULTADO"}
              onValueChange={(val) => setValores((p) => ({ ...p, tipo_oferta: val as "RESULTADO" | "MARCADOR" }))}
              className="flex space-x-4 pt-1"
              disabled={guardando}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="RESULTADO" id="tipo-resultado" />
                <Label htmlFor="tipo-resultado" className="font-normal cursor-pointer">Resultado</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="MARCADOR" id="tipo-marcador" />
                <Label htmlFor="tipo-marcador" className="font-normal cursor-pointer">Marcador</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="grid max-w-md grid-cols-3 gap-x-3 gap-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="oferta-cuota" className="text-xs font-medium text-muted-foreground">
                Cuota *
              </Label>
              <Input
                id="oferta-cuota"
                className="h-9"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={valores.cuota}
                disabled={guardando}
                onChange={(e) => setValores((p) => ({ ...p, cuota: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oferta-inicio" className="text-xs font-medium text-muted-foreground">
                Fecha inicio *
              </Label>
              <Input
                id="oferta-inicio"
                className="h-9"
                type="date"
                value={bloqueoAtParaInputFecha(valores.inicio_at || "")}
                disabled={guardando}
                onChange={(e) =>
                  setValores((p) => ({
                    ...p,
                    inicio_at: inicioAtDesdeInputFecha(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oferta-bloqueo" className="text-xs font-medium text-muted-foreground">
                Fecha bloqueo *
              </Label>
              <Input
                id="oferta-bloqueo"
                className="h-9"
                type="date"
                value={bloqueoAtParaInputFecha(valores.bloqueo_at)}
                disabled={guardando}
                onChange={(e) =>
                  setValores((p) => ({
                    ...p,
                    bloqueo_at: bloqueoAtDesdeInputFecha(e.target.value),
                  }))
                }
              />
            </div>
          </div>

          {modo === "editar" ? (
            <p className="font-mono text-[10px] text-muted-foreground">ID: {valores.id_oferta}</p>
          ) : null}

          {errorVisible ? <p className="text-xs text-destructive">{errorVisible}</p> : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={handleCerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {modo === "crear" ? "Registrar oferta" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
