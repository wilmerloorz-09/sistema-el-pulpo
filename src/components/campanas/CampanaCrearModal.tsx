import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import CampanaDatosBasicosFields from "@/components/campanas/CampanaDatosBasicosFields";
import { CAMPANA_FORMULARIO_VACIO } from "@/types/campanaPromocional";
import {
  campanaFormularioEsValido,
  prepararCampanaBasicaParaGuardar,
  validarCampanaDatosBasicos,
  type CampanaDatosBasicosFormulario,
  type ErroresCampanaFormulario,
} from "@/lib/campanasValidacion";

interface CampanaCrearModalProps {
  abierto: boolean;
  guardando?: boolean;
  onCerrar: () => void;
  onGuardar: (datos: ReturnType<typeof prepararCampanaBasicaParaGuardar>) => Promise<void>;
}

export default function CampanaCrearModal({
  abierto,
  guardando = false,
  onCerrar,
  onGuardar,
}: CampanaCrearModalProps) {
  const [valores, setValores] = useState<CampanaDatosBasicosFormulario>(CAMPANA_FORMULARIO_VACIO);
  const [errores, setErrores] = useState<ErroresCampanaFormulario>({});

  useEffect(() => {
    if (!abierto) return;
    setValores(CAMPANA_FORMULARIO_VACIO);
    setErrores({});
  }, [abierto]);

  const guardar = async () => {
    const v = validarCampanaDatosBasicos(valores);
    setErrores(v);
    if (!campanaFormularioEsValido(v)) return;
    await onGuardar(prepararCampanaBasicaParaGuardar(valores));
  };

  return (
    <Dialog open={abierto} onOpenChange={(open) => !open && !guardando && onCerrar()}>
      <DialogContent className="max-h-dialog-safe overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Nueva campaña</DialogTitle>
        </DialogHeader>

        <CampanaDatosBasicosFields valores={valores} errores={errores} onChange={setValores} deshabilitado={guardando} />

        <p className="text-xs text-muted-foreground">
          Las ofertas se agregan después, al entrar a la tarjeta de la campaña creada.
        </p>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
