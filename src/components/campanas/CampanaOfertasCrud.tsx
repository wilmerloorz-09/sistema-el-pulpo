import { useCallback, useMemo, useState } from "react";
import { Loader2, Plus, Search, Sparkles, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  etiquetaResultadoOferta,
  formatFechaBloqueo,
  normalizarResultadoOferta,
  nuevaIdOferta,
} from "@/lib/campanasValidacion";
import type { ResultadoOferta } from "@/types/campanaPromocional";
import type { OfertaCartelera } from "@/types/campanaPromocional";
import OfertaCarteleraFormulario from "@/components/campanas/OfertaCarteleraFormulario";
import CerrarOfertaDialog from "@/components/campanas/CerrarOfertaDialog";

type FiltroOferta = "todas" | "ganadoras" | "perdedoras" | "pendientes";

function BadgeResultado({ resultado }: { resultado: ResultadoOferta }) {
  if (resultado === "GANADA") {
    return (
      <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
        {etiquetaResultadoOferta(resultado)}
      </span>
    );
  }
  if (resultado === "PERDIDA") {
    return (
      <span className="inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-800">
        {etiquetaResultadoOferta(resultado)}
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
      {etiquetaResultadoOferta(resultado)}
    </span>
  );
}

interface CampanaOfertasCrudProps {
  ofertas: OfertaCartelera[];
  guardando?: boolean;
  cerrando?: boolean;
  onPersistirCartelera: (cartelera: OfertaCartelera[]) => Promise<void>;
  onCerrarOferta: (ofertaId: string, resultado: "GANADA" | "PERDIDA") => Promise<void>;
}

const CampanaOfertasCrud = ({
  ofertas,
  guardando = false,
  cerrando = false,
  onPersistirCartelera,
  onCerrarOferta,
}: CampanaOfertasCrudProps) => {
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<FiltroOferta>("todas");
  const [mostrarFormularioAlta, setMostrarFormularioAlta] = useState(false);
  const [ofertaEditando, setOfertaEditando] = useState<OfertaCartelera | null>(null);
  const [idNuevaOferta, setIdNuevaOferta] = useState<string | null>(null);
  const [ofertaAEliminar, setOfertaAEliminar] = useState<OfertaCartelera | null>(null);
  const [ofertaACerrar, setOfertaACerrar] = useState<OfertaCartelera | null>(null);

  const procesando = guardando || cerrando;
  const totalOfertas = ofertas.length;

  const ofertasFiltradas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    return ofertas.filter((o, index) => {
      const resultado = normalizarResultadoOferta(o.resultado);
      const coincideBusqueda =
        !termino
        || o.descripcion.toLowerCase().includes(termino)
        || o.id_oferta.toLowerCase().includes(termino)
        || String(o.cuota).includes(termino)
        || String(index + 1) === termino
        || etiquetaResultadoOferta(resultado).toLowerCase().includes(termino);

      const coincideEstado =
        filtroEstado === "todas"
        || (filtroEstado === "ganadoras" && resultado === "GANADA")
        || (filtroEstado === "perdedoras" && resultado === "PERDIDA")
        || (filtroEstado === "pendientes" && resultado === "PENDIENTE");

      return coincideBusqueda && coincideEstado;
    });
  }, [busqueda, filtroEstado, ofertas]);

  const abrirCrear = useCallback(() => {
    if (procesando) return;
    setOfertaEditando(null);
    setIdNuevaOferta(nuevaIdOferta());
    setMostrarFormularioAlta(true);
  }, [procesando]);

  const cerrarFormularioAlta = useCallback(() => {
    if (guardando) return;
    setMostrarFormularioAlta(false);
    setIdNuevaOferta(null);
  }, [guardando]);

  const cerrarFormularioEdicion = useCallback(() => {
    if (guardando) return;
    setOfertaEditando(null);
  }, [guardando]);

  const handleGuardar = useCallback(
    async (payload: { modo: "crear" | "editar"; oferta: OfertaCartelera }) => {
      if (payload.modo === "crear") {
        await onPersistirCartelera([...ofertas, payload.oferta]);
        setMostrarFormularioAlta(false);
        setIdNuevaOferta(null);
      } else {
        await onPersistirCartelera(
          ofertas.map((o) => (o.id_oferta === payload.oferta.id_oferta ? payload.oferta : o)),
        );
        setOfertaEditando(null);
      }
    },
    [ofertas, onPersistirCartelera],
  );

  const confirmarEliminar = useCallback(async () => {
    if (!ofertaAEliminar || guardando) return;
    await onPersistirCartelera(ofertas.filter((o) => o.id_oferta !== ofertaAEliminar.id_oferta));
    setOfertaAEliminar(null);
    if (ofertaEditando?.id_oferta === ofertaAEliminar.id_oferta) {
      setOfertaEditando(null);
    }
  }, [ofertaAEliminar, ofertaEditando?.id_oferta, guardando, ofertas, onPersistirCartelera]);

  const confirmarCerrarOferta = useCallback(
    async (resultado: "GANADA" | "PERDIDA") => {
      if (!ofertaACerrar) return;
      await onCerrarOferta(ofertaACerrar.id_oferta, resultado);
      setOfertaACerrar(null);
    },
    [ofertaACerrar, onCerrarOferta],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Buscar descripción, cuota, #..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-9 rounded-xl border-slate-200 pl-9 text-sm"
            />
          </div>
          <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v as FiltroOferta)}>
            <SelectTrigger className="h-9 w-[160px] rounded-xl border-slate-200 text-xs">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pendientes">Pendientes</SelectItem>
              <SelectItem value="ganadoras">Ganadoras</SelectItem>
              <SelectItem value="perdedoras">Perdedoras</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          onClick={abrirCrear}
          className="h-9 gap-1.5 rounded-xl font-display text-xs"
          disabled={mostrarFormularioAlta || procesando}
        >
          <Plus className="h-4 w-4" />
          Agregar oferta
        </Button>
      </div>

      <OfertaCarteleraFormulario
        abierto={mostrarFormularioAlta}
        modo="crear"
        idNuevaOferta={idNuevaOferta ?? undefined}
        guardando={guardando}
        onCerrar={cerrarFormularioAlta}
        onGuardar={handleGuardar}
      />

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_15px_45px_-30px_rgba(15,23,42,0.25)]">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="hidden items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-2.5 sm:flex sm:px-6">
              <div className="w-10 shrink-0 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                #
              </div>
              <div className="min-w-[180px] flex-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Oferta
              </div>
              <div className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Cuota
              </div>
              <div className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Inicio
              </div>
              <div className="w-36 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Bloqueo
              </div>
              <div className="w-24 shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Estado
              </div>
              <div className="w-[11.5rem] shrink-0 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Acción
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {ofertasFiltradas.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Sparkles className="mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm font-medium">Sin resultados</p>
                  <p className="text-xs">Ajusta los filtros o agrega una oferta</p>
                  {totalOfertas === 0 ? (
                    <Button type="button" variant="outline" size="sm" className="mt-4 rounded-xl" onClick={abrirCrear}>
                      <Plus className="mr-2 h-4 w-4" />
                      Agregar oferta
                    </Button>
                  ) : null}
                </div>
              ) : (
                ofertasFiltradas.map((oferta) => {
                  const indexEnLista = ofertas.findIndex((o) => o.id_oferta === oferta.id_oferta);
                  const numero = indexEnLista + 1;
                  const resultado = normalizarResultadoOferta(oferta.resultado);
                  const estaPendiente = resultado === "PENDIENTE";

                  return (
                    <div
                      key={oferta.id_oferta}
                      className={cn("transition-colors", indexEnLista % 2 === 0 ? "bg-white" : "bg-slate-50/40")}
                    >
                      <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                        <div className="flex w-10 shrink-0 items-center justify-center">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-sm font-bold text-fuchsia-800">
                            {numero}
                          </div>
                        </div>

                        <button
                          type="button"
                          className="flex min-w-[180px] flex-1 flex-col justify-center rounded-lg text-left outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-70"
                          onClick={() => estaPendiente && setOfertaEditando(oferta)}
                          disabled={!estaPendiente || procesando}
                          title={estaPendiente ? "Editar oferta" : oferta.descripcion}
                        >
                          <p className="truncate text-sm font-semibold text-slate-900">{oferta.descripcion}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">{oferta.id_oferta}</p>
                        </button>

                        <div className="hidden w-20 shrink-0 font-mono text-xs font-semibold text-slate-700 sm:block">
                          {Number(oferta.cuota).toFixed(2)}
                        </div>

                        <div className="hidden w-36 shrink-0 text-xs text-slate-600 sm:block">
                          {oferta.inicio_at ? formatFechaBloqueo(oferta.inicio_at) : "N/A"}
                        </div>

                        <div className="hidden w-36 shrink-0 text-xs text-slate-600 sm:block">
                          {formatFechaBloqueo(oferta.bloqueo_at)}
                        </div>

                        <div className="hidden w-24 shrink-0 sm:block">
                          <BadgeResultado resultado={resultado} />
                        </div>

                        <div className="flex w-[11.5rem] shrink-0 flex-wrap items-center justify-end gap-1">
                          {estaPendiente ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1 rounded-lg border-violet-200 px-2 text-[10px] font-semibold text-violet-700 hover:bg-violet-50"
                                disabled={procesando}
                                onClick={() => setOfertaACerrar(oferta)}
                              >
                                <Trophy className="h-3 w-3" />
                                Cerrar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg border-slate-200 px-2 text-[10px] font-semibold text-slate-700"
                                disabled={procesando}
                                onClick={() => setOfertaEditando(oferta)}
                              >
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-slate-400 hover:text-destructive"
                                title="Eliminar oferta"
                                disabled={procesando}
                                onClick={() => setOfertaAEliminar(oferta)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-400">Cerrada</span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-5 pb-3 text-xs text-slate-600 sm:hidden">
                        <span className="font-mono font-semibold">Cuota {Number(oferta.cuota).toFixed(2)}</span>
                        {oferta.inicio_at ? <span>{formatFechaBloqueo(oferta.inicio_at)} - </span> : null}
                        <span>{formatFechaBloqueo(oferta.bloqueo_at)}</span>
                        <BadgeResultado resultado={resultado} />
                        {estaPendiente ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 rounded-lg text-[10px]"
                            disabled={procesando}
                            onClick={() => setOfertaACerrar(oferta)}
                          >
                            <Trophy className="h-3 w-3" />
                            Cerrar evento
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <OfertaCarteleraFormulario
        abierto={Boolean(ofertaEditando)}
        modo="editar"
        ofertaInicial={ofertaEditando}
        guardando={guardando}
        onCerrar={cerrarFormularioEdicion}
        onGuardar={handleGuardar}
      />

      <CerrarOfertaDialog
        abierto={Boolean(ofertaACerrar)}
        oferta={ofertaACerrar}
        procesando={cerrando}
        onCerrar={() => !cerrando && setOfertaACerrar(null)}
        onConfirmar={confirmarCerrarOferta}
      />

      <AlertDialog
        open={Boolean(ofertaAEliminar)}
        onOpenChange={(open) => !open && !guardando && setOfertaAEliminar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar oferta?</AlertDialogTitle>
            <AlertDialogDescription>
              {ofertaAEliminar
                ? `Se quitará «${ofertaAEliminar.descripcion}» de la cartelera. Esta acción no se puede deshacer.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={guardando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={guardando}
              onClick={(e) => {
                e.preventDefault();
                void confirmarEliminar();
              }}
            >
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CampanaOfertasCrud;
