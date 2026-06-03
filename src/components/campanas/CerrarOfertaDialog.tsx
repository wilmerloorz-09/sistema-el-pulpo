import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OfertaCartelera, ResultadoOferta } from "@/types/campanaPromocional";

interface CerrarOfertaDialogProps {
  abierto: boolean;
  oferta: OfertaCartelera | null;
  procesando?: boolean;
  onCerrar: () => void;
  onConfirmar: (resultado: "GANADA" | "PERDIDA") => Promise<void>;
}

export default function CerrarOfertaDialog({
  abierto,
  oferta,
  procesando = false,
  onCerrar,
  onConfirmar,
}: CerrarOfertaDialogProps) {
  const [resultado, setResultado] = useState<"" | "GANADA" | "PERDIDA">("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setResultado("");
    setError(null);
  }, [abierto, oferta?.id_oferta]);

  const handleCerrar = () => {
    if (procesando) return;
    onCerrar();
  };

  const handleConfirmar = async () => {
    if (!resultado) {
      setError("Debes indicar si la oferta es ganadora o perdedora.");
      return;
    }
    setError(null);
    await onConfirmar(resultado);
  };

  return (
    <Dialog open={abierto} onOpenChange={(open) => !open && handleCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cerrar evento</DialogTitle>
          <DialogDescription>
            {oferta
              ? `Define el resultado de «${oferta.descripcion}» antes de cerrar.`
              : "Selecciona el resultado de la oferta."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="cerrar-oferta-resultado" className="text-xs font-medium text-muted-foreground">
            Resultado *
          </Label>
          <Select
            value={resultado}
            disabled={procesando}
            onValueChange={(v) => {
              setResultado(v as ResultadoOferta);
              setError(null);
            }}
          >
            <SelectTrigger id="cerrar-oferta-resultado" className="h-9">
              <SelectValue placeholder="Selecciona ganadora o perdedora" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GANADA">Ganadora</SelectItem>
              <SelectItem value="PERDIDA">Perdedora</SelectItem>
            </SelectContent>
          </Select>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={handleCerrar} disabled={procesando}>
            Cancelar
          </Button>
          <Button type="button" disabled={procesando || !resultado} onClick={() => void handleConfirmar()}>
            {procesando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Cerrar evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
