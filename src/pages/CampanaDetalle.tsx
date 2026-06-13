import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import CampanaDatosBasicosFields from "@/components/campanas/CampanaDatosBasicosFields";
import CampanaOfertasCrud from "@/components/campanas/CampanaOfertasCrud";
import { useCampanasPromocionales, CAMPANAS_QUERY_KEY } from "@/hooks/useCampanasPromocionales";
import { obtenerCampanaPorId } from "@/services/campanasPromocionalesDb";
import {
  campanaAFormularioBasico,
  campanaFormularioEsValido,
  enriquecerCarteleraConResultado,
  ofertasCumplidasDesdeCartelera,
  prepararActualizacionDatosBasicos,
  prepararOfertaParaGuardar,
  validarCampanaDatosBasicos,
  type CampanaDatosBasicosFormulario,
  type ErroresCampanaFormulario,
} from "@/lib/campanasValidacion";
import type { OfertaCartelera } from "@/types/campanaPromocional";

const CampanaDetalle = () => {
  const { campanaId } = useParams<{ campanaId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { actualizarCampana, cerrarOferta, isGuardando, isCerrando } = useCampanasPromocionales();

  const campanaQuery = useQuery({
    queryKey: [CAMPANAS_QUERY_KEY, campanaId],
    queryFn: () => obtenerCampanaPorId(campanaId!),
    enabled: Boolean(campanaId),
  });

  const campana = campanaQuery.data;

  const [datosCampana, setDatosCampana] = useState<CampanaDatosBasicosFormulario | null>(null);
  const [erroresDatos, setErroresDatos] = useState<ErroresCampanaFormulario>({});

  useEffect(() => {
    if (!campana) return;
    setDatosCampana(campanaAFormularioBasico(campana));
    setErroresDatos({});
  }, [
    campana?.id,
    campana?.titulo,
    campana?.consumo_minimo,
    campana?.porcentaje_descuento,
    campana?.descuento_maximo,
    campana?.dias_vigencia_descuento,
    campana?.activa,
  ]);

  const ofertasLista = useMemo(
    () => enriquecerCarteleraConResultado(campana?.cartelera_ofertas ?? [], campana?.ofertas_cumplidas ?? []),
    [campana?.cartelera_ofertas, campana?.ofertas_cumplidas],
  );

  const datosModificados = useMemo(() => {
    if (!campana || !datosCampana) return false;
    const base = campanaAFormularioBasico(campana);
    return (
      datosCampana.titulo !== base.titulo
      || datosCampana.consumo_minimo !== base.consumo_minimo
      || datosCampana.porcentaje_descuento !== base.porcentaje_descuento
      || datosCampana.descuento_maximo !== base.descuento_maximo
      || datosCampana.dias_vigencia_descuento !== base.dias_vigencia_descuento
      || datosCampana.activa !== base.activa
    );
  }, [campana, datosCampana]);

  const volver = () => navigate("/campanas?origin=campanas");

  const persistirCartelera = async (cartelera: OfertaCartelera[]) => {
    if (!campana) return;
    const carteleraNormalizada = cartelera.map((o) => prepararOfertaParaGuardar(o));
    await actualizarCampana({
      id: campana.id,
      datos: {
        cartelera_ofertas: carteleraNormalizada,
        ofertas_cumplidas: ofertasCumplidasDesdeCartelera(carteleraNormalizada),
      },
    });
    void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY, campana.id] });
  };

  const cerrarOfertaIndividual = async (ofertaId: string, resultado: "GANADA" | "PERDIDA", marcadorFinalLocal?: number, marcadorFinalVisitante?: number) => {
    if (!campana) return;
    const carteleraActualizada = ofertasLista.map((o) =>
      o.id_oferta === ofertaId
        ? {
            ...prepararOfertaParaGuardar(o),
            resultado,
            marcador_final_local: marcadorFinalLocal,
            marcador_final_visitante: marcadorFinalVisitante,
          }
        : prepararOfertaParaGuardar(o),
    );
    await persistirCartelera(carteleraActualizada);
    await cerrarOferta({
      campanaId: campana.id,
      ofertaId,
      esGanadora: resultado === "GANADA",
      marcadorFinalLocal,
      marcadorFinalVisitante,
    });
    void campanaQuery.refetch();
  };

  const guardarDatosCampana = async () => {
    if (!campana || !datosCampana) return;
    const v = validarCampanaDatosBasicos(datosCampana);
    setErroresDatos(v);
    if (!campanaFormularioEsValido(v)) return;
    await actualizarCampana({
      id: campana.id,
      datos: prepararActualizacionDatosBasicos(datosCampana),
    });
    void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY, campana.id] });
  };

  if (campanaQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!campana) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="font-medium">Campaña no encontrada</p>
        <Button variant="outline" className="mt-4 rounded-xl" onClick={volver}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-2.5 pb-10 sm:px-4">
      <div className="surface-glow px-4 py-4 sm:px-5">
        <Button type="button" variant="ghost" size="sm" className="mb-3 -ml-2 gap-1 rounded-xl" onClick={volver}>
          <ArrowLeft className="h-4 w-4" />
          Campañas
        </Button>
        {datosCampana ? (
          <>
            <CampanaDatosBasicosFields
              disposicion="fila"
              valores={datosCampana}
              errores={erroresDatos}
              onChange={setDatosCampana}
              deshabilitado={isGuardando}
              guardando={isGuardando}
              puedeGuardar={datosModificados}
              onGuardar={() => void guardarDatosCampana()}
            />
            {campana.ofertas_cumplidas.length > 0 ? (
              <p className="mt-2 text-xs font-medium text-violet-700">
                Ofertas ganadoras: {campana.ofertas_cumplidas.join(", ")}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div>
        <h2 className="mb-3 px-1 font-display text-lg font-bold text-foreground">Cartelera de ofertas</h2>
        <CampanaOfertasCrud
          ofertas={ofertasLista}
          guardando={isGuardando}
          cerrando={isCerrando}
          onPersistirCartelera={persistirCartelera}
          onCerrarOferta={cerrarOfertaIndividual}
        />
      </div>
    </div>
  );
};

export default CampanaDetalle;
