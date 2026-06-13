import { useEffect, useState } from "react";
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
  onConfirmar: (payload: { resultado?: "GANADA" | "PERDIDA"; marcadorFinalLocal?: number; marcadorFinalVisitante?: number }) => Promise<void>;
}

export default function CerrarOfertaDialog({
  abierto,
  oferta,
  procesando = false,
  onCerrar,
  onConfirmar,
}: CerrarOfertaDialogProps) {
  const [resultado, setResultado] = useState<"" | "GANADA" | "PERDIDA">("");
  const [marcadorLocal, setMarcadorLocal] = useState<string>("0");
  const [marcadorVisitante, setMarcadorVisitante] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    setResultado("");
    setMarcadorLocal("0");
    setMarcadorVisitante("0");
    setError(null);
  }, [abierto, oferta?.id_oferta]);

  const handleCerrar = () => {
    if (procesando) return;
    onCerrar();
  };

  const handleConfirmar = async () => {
    if (oferta?.tipo_oferta === "MARCADOR") {
      const ml = parseInt(marcadorLocal || "0", 10);
      const mv = parseInt(marcadorVisitante || "0", 10);
      if (isNaN(ml) || isNaN(mv) || ml < 0 || mv < 0) {
        setError("Ingresa un marcador válido.");
        return;
      }
      setError(null);
      await onConfirmar({ resultado: "GANADA", marcadorFinalLocal: ml, marcadorFinalVisitante: mv });
    } else {
      if (!resultado) {
        setError("Debes indicar si la oferta es ganadora o perdedora.");
        return;
      }
      setError(null);
      await onConfirmar({ resultado });
    }
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

        {oferta?.tipo_oferta === "MARCADOR" ? (
          <div className="space-y-2 py-2">
            <Label className="text-xs font-medium text-muted-foreground">Marcador Final *</Label>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-2 bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200/60 p-5 rounded-2xl shadow-sm">
              <div className="flex flex-col items-center gap-3 w-full sm:w-32 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <Label className="text-[13px] font-black text-slate-800 tracking-wide uppercase truncate w-full text-center" title={oferta?.equipo_local || "LOCAL"}>
                  {oferta?.equipo_local || "LOCAL"}
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={marcadorLocal}
                  disabled={procesando}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, "");
                    setMarcadorLocal(value);
                    setError(null);
                  }}
                  className="w-24 h-14 text-2xl text-center font-black bg-slate-50 border-slate-200 focus-visible:ring-emerald-500 rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              
              <div className="flex flex-col items-center justify-center h-10 w-10 shrink-0 bg-slate-200/50 rounded-full">
                <span className="text-slate-400 font-bold text-lg">VS</span>
              </div>
              
              <div className="flex flex-col items-center gap-3 w-full sm:w-32 bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                <Label className="text-[13px] font-black text-slate-800 tracking-wide uppercase truncate w-full text-center" title={oferta?.equipo_visitante || "VISITANTE"}>
                  {oferta?.equipo_visitante || "VISITANTE"}
                </Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={marcadorVisitante}
                  disabled={procesando}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9]/g, "");
                    setMarcadorVisitante(value);
                    setError(null);
                  }}
                  className="w-24 h-14 text-2xl text-center font-black bg-slate-50 border-slate-200 focus-visible:ring-emerald-500 rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : (
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
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={handleCerrar} disabled={procesando}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={procesando || (oferta?.tipo_oferta !== "MARCADOR" && !resultado)}
            onClick={() => void handleConfirmar()}
          >
            {procesando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Cerrar evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
