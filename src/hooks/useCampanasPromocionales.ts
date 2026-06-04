import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actualizarCampanaPromocional,
  cerrarOfertaCampana,
  cerrarOfertasCampana,
  crearCampanaPromocional,
  eliminarCampanaPromocional,
  listarCampanasPromocionales,
} from "@/services/campanasPromocionalesDb";
import type { CampanaPromocional } from "@/types/campanaPromocional";

export const CAMPANAS_QUERY_KEY = "campanas-promocionales";

function mensajeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (msg.includes("cerrar_ofertas") || msg.includes("administradores")) {
    return "No tienes permiso para cerrar ofertas de campaña.";
  }
  return msg || "No se pudo completar la operación.";
}

export function useCampanasPromocionales() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [CAMPANAS_QUERY_KEY],
    queryFn: listarCampanasPromocionales,
    staleTime: 15_000,
  });

  const crearMutation = useMutation({
    mutationFn: crearCampanaPromocional,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY] });
      toast.success("Campaña creada.");
    },
    onError: (e) => toast.error(mensajeError(e)),
  });

  const actualizarMutation = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: Partial<CampanaPromocional> }) =>
      actualizarCampanaPromocional(id, datos),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["campanas-promocionales-activas"] });
      toast.success("Campaña actualizada.");
    },
    onError: (e) => toast.error(mensajeError(e)),
  });

  const eliminarMutation = useMutation({
    mutationFn: eliminarCampanaPromocional,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY] });
      toast.success("Campaña eliminada.");
    },
    onError: (e) => toast.error(mensajeError(e)),
  });

  const cerrarOfertaMutation = useMutation({
    mutationFn: ({
      campanaId,
      ofertaId,
      esGanadora,
    }: {
      campanaId: string;
      ofertaId: string;
      esGanadora: boolean;
    }) => cerrarOfertaCampana(campanaId, ofertaId, esGanadora),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY] });
      const msg =
        res.predicciones_actualizadas > 0
          ? `Evento cerrado. ${res.predicciones_actualizadas} predicción(es) actualizada(s).`
          : "Evento cerrado.";
      toast.success(msg);
    },
    onError: (e) => toast.error(mensajeError(e)),
  });

  const cerrarMutation = useMutation({
    mutationFn: ({ campanaId, ofertasGanadoras }: { campanaId: string; ofertasGanadoras: string[] }) =>
      cerrarOfertasCampana(campanaId, ofertasGanadoras),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: [CAMPANAS_QUERY_KEY] });
      toast.success(`Ofertas cerradas: ${res.ganadas} ganadas, ${res.perdidas} perdidas.`);
    },
    onError: (e) => toast.error(mensajeError(e)),
  });

  return {
    campanas: query.data ?? [],
    isLoading: query.isLoading,
    refetch: query.refetch,
    crearCampana: crearMutation.mutateAsync,
    actualizarCampana: actualizarMutation.mutateAsync,
    eliminarCampana: eliminarMutation.mutateAsync,
    cerrarOferta: cerrarOfertaMutation.mutateAsync,
    cerrarOfertas: cerrarMutation.mutateAsync,
    isGuardando: crearMutation.isPending || actualizarMutation.isPending,
    isEliminando: eliminarMutation.isPending,
    isCerrando: cerrarMutation.isPending || cerrarOfertaMutation.isPending,
  };
}
