import { useCallback, useMemo, useState } from "react";
import { Gift, Loader2, Plus, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useBranch } from "@/contexts/BranchContext";
import { canManage } from "@/lib/permissions";
import { useCampanasPromocionales } from "@/hooks/useCampanasPromocionales";
import {
  CAMPANA_FORMULARIO_VACIO,
  type CampanaPromocional,
  type CampanaPromocionalFormulario,
} from "@/types/campanaPromocional";
import {
  bloqueoAtDesdeInputFecha,
  bloqueoAtParaInputFecha,
  campanaFormularioEsValido,
  nuevaOfertaCartelera,
  prepararCampanaParaGuardar,
  validarCampanaFormulario,
} from "@/lib/campanasValidacion";
function campanaAFormulario(c: CampanaPromocional): CampanaPromocionalFormulario {
  return {
    titulo: c.titulo,
    consumo_minimo: String(c.consumo_minimo),
    porcentaje_descuento: String(c.porcentaje_descuento),
    descuento_maximo: String(c.descuento_maximo),
    dias_vigencia_descuento: String(c.dias_vigencia_descuento),
    activa: c.activa,
    cartelera_ofertas: c.cartelera_ofertas,
  };
}

const CampanasPromocionalesCrud = () => {
  const { isGlobalAdmin, permissions } = useBranch();
  const puedeGestionar =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const {
    campanas,
    isLoading,
    crearCampana,
    actualizarCampana,
    eliminarCampana,
    cerrarOfertas,
    isGuardando,
    isEliminando,
    isCerrando,
  } = useCampanasPromocionales();

  const [formAbierto, setFormAbierto] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [editando, setEditando] = useState<CampanaPromocional | null>(null);
  const [valores, setValores] = useState<CampanaPromocionalFormulario>(CAMPANA_FORMULARIO_VACIO);
  const [errores, setErrores] = useState<ReturnType<typeof validarCampanaFormulario>>({});
  const [cerrarCampana, setCerrarCampana] = useState<CampanaPromocional | null>(null);
  const [ganadorasSeleccionadas, setGanadorasSeleccionadas] = useState<string[]>([]);
  const [eliminarId, setEliminarId] = useState<string | null>(null);

  const abrirCrear = () => {
    setModo("crear");
    setEditando(null);
    setValores({ ...CAMPANA_FORMULARIO_VACIO, cartelera_ofertas: [nuevaOfertaCartelera()] });
    setErrores({});
    setFormAbierto(true);
  };

  const abrirEditar = (c: CampanaPromocional) => {
    setModo("editar");
    setEditando(c);
    setValores(campanaAFormulario(c));
    setErrores({});
    setFormAbierto(true);
  };

  const guardar = async () => {
    const v = validarCampanaFormulario(valores);
    setErrores(v);
    if (!campanaFormularioEsValido(v)) return;
    const datos = prepararCampanaParaGuardar(valores);
    if (modo === "crear") {
      await crearCampana({ ...datos, ofertas_cumplidas: [] });
    } else if (editando) {
      const { ofertas_cumplidas: _omit, ...datosSinCumplidas } = datos;
      await actualizarCampana({
        id: editando.id,
        datos: { ...datosSinCumplidas, ofertas_cumplidas: editando.ofertas_cumplidas },
      });
    }
    setFormAbierto(false);
  };

  const abrirCerrar = (c: CampanaPromocional) => {
    setCerrarCampana(c);
    setGanadorasSeleccionadas([]);
  };

  const confirmarCerrar = async () => {
    if (!cerrarCampana || ganadorasSeleccionadas.length === 0) return;
    await cerrarOfertas({ campanaId: cerrarCampana.id, ofertasGanadoras: ganadorasSeleccionadas });
    setCerrarCampana(null);
  };

  const actualizarOferta = useCallback((index: number, campo: string, valor: string | number) => {
    setValores((prev) => {
      const next = [...prev.cartelera_ofertas];
      next[index] = { ...next[index], [campo]: valor };
      return { ...prev, cartelera_ofertas: next };
    });
  }, []);

  const campanasOrdenadas = useMemo(
    () => [...campanas].sort((a, b) => (a.creado_el < b.creado_el ? 1 : -1)),
    [campanas],
  );

  if (!puedeGestionar) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        Necesitas permiso de administración (admin sucursal o global) para gestionar campañas promocionales.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5 rounded-xl" onClick={abrirCrear}>
          <Plus className="h-4 w-4" />
          Nueva campaña
        </Button>
      </div>

      <div className="space-y-3">
        {campanasOrdenadas.map((c) => (
          <div key={c.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-violet-600" />
                  <h3 className="font-display text-lg font-bold">{c.titulo}</h3>
                  {c.activa ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                      Activa
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                      Inactiva
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mín. ${c.consumo_minimo.toFixed(2)} · {c.porcentaje_descuento}% (máx. ${c.descuento_maximo.toFixed(2)}) ·{" "}
                  {c.dias_vigencia_descuento} días cupón · {c.cartelera_ofertas.length} ofertas
                </p>
                {c.ofertas_cumplidas.length > 0 ? (
                  <p className="mt-1 text-xs text-violet-700">
                    Ganadoras: {c.ofertas_cumplidas.join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => abrirEditar(c)}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 rounded-xl"
                  onClick={() => abrirCerrar(c)}
                  disabled={c.cartelera_ofertas.length === 0}
                >
                  <Trophy className="h-3.5 w-3.5" />
                  Cerrar eventos
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setEliminarId(c.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={formAbierto} onOpenChange={setFormAbierto}>
        <DialogContent className="max-h-dialog-safe max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modo === "crear" ? "Nueva campaña" : "Editar campaña"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Título</Label>
              <Input value={valores.titulo} onChange={(e) => setValores((p) => ({ ...p, titulo: e.target.value }))} />
              {errores.titulo ? <p className="text-xs text-destructive">{errores.titulo}</p> : null}
            </div>
            <div className="space-y-2">
              <Label>Consumo mínimo ($)</Label>
              <Input
                inputMode="decimal"
                value={valores.consumo_minimo}
                onChange={(e) => setValores((p) => ({ ...p, consumo_minimo: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>% descuento</Label>
              <Input
                inputMode="decimal"
                value={valores.porcentaje_descuento}
                onChange={(e) => setValores((p) => ({ ...p, porcentaje_descuento: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Tope descuento ($)</Label>
              <Input
                inputMode="decimal"
                value={valores.descuento_maximo}
                onChange={(e) => setValores((p) => ({ ...p, descuento_maximo: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Días vigencia cupón</Label>
              <Input
                inputMode="numeric"
                value={valores.dias_vigencia_descuento}
                onChange={(e) => setValores((p) => ({ ...p, dias_vigencia_descuento: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch checked={valores.activa} onCheckedChange={(v) => setValores((p) => ({ ...p, activa: v }))} />
              <Label>Campaña activa</Label>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Cartelera de ofertas</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setValores((p) => ({ ...p, cartelera_ofertas: [...p.cartelera_ofertas, nuevaOfertaCartelera()] }))
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                Oferta
              </Button>
            </div>
            {errores.cartelera ? <p className="text-xs text-destructive">{errores.cartelera}</p> : null}
            {valores.cartelera_ofertas.map((oferta, idx) => (
              <div key={`${oferta.id_oferta}-${idx}`} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Oferta {idx + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-destructive"
                    onClick={() =>
                      setValores((p) => ({
                        ...p,
                        cartelera_ofertas: p.cartelera_ofertas.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="ID oferta"
                    value={oferta.id_oferta}
                    onChange={(e) => actualizarOferta(idx, "id_oferta", e.target.value)}
                  />
                  <Input
                    type="date"
                    value={bloqueoAtParaInputFecha(oferta.bloqueo_at)}
                    onChange={(e) =>
                      actualizarOferta(idx, "bloqueo_at", bloqueoAtDesdeInputFecha(e.target.value))
                    }
                  />
                  <Input
                    className="sm:col-span-2"
                    placeholder="Descripción"
                    value={oferta.descripcion}
                    onChange={(e) => actualizarOferta(idx, "descripcion", e.target.value)}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Cuota"
                    value={oferta.cuota}
                    onChange={(e) => actualizarOferta(idx, "cuota", Number(e.target.value))}
                  />
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormAbierto(false)}>
              Cancelar
            </Button>
            <Button disabled={isGuardando} onClick={() => void guardar()}>
              {isGuardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cerrarCampana)} onOpenChange={(o) => !o && setCerrarCampana(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar eventos — {cerrarCampana?.titulo}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Marca las ofertas ganadoras. Las predicciones pendientes se calificarán.</p>
          <div className="max-h-64 space-y-2 overflow-y-auto py-2">
            {(cerrarCampana?.cartelera_ofertas ?? []).map((o) => (
              <label key={o.id_oferta} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2">
                <Checkbox
                  checked={ganadorasSeleccionadas.includes(o.id_oferta)}
                  onCheckedChange={(checked) => {
                    setGanadorasSeleccionadas((prev) =>
                      checked ? [...prev, o.id_oferta] : prev.filter((id) => id !== o.id_oferta),
                    );
                  }}
                />
                <span className="text-sm">
                  <strong>{o.descripcion}</strong>
                  <span className="block text-xs text-muted-foreground">
                    {o.id_oferta} · Cuota {Number(o.cuota).toFixed(2)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCerrarCampana(null)}>
              Cancelar
            </Button>
            <Button
              disabled={isCerrando || ganadorasSeleccionadas.length === 0}
              onClick={() => void confirmarCerrar()}
            >
              {isCerrando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Calificar ganadores
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(eliminarId)} onOpenChange={(o) => !o && setEliminarId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar campaña?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={isEliminando}
              onClick={(e) => {
                e.preventDefault();
                if (eliminarId) void eliminarCampana(eliminarId).then(() => setEliminarId(null));
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CampanasPromocionalesCrud;
