import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { listarCampanasActivas } from "@/services/campanasPromocionalesDb";
import { listarOrdenesElegiblesPromociones, registrarPrediccionCliente } from "@/services/prediccionesClientesDb";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { PROMOCIONES_ORDENES_QUERY_KEY } from "@/hooks/usePromocionesKeys";

function mensajeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  if (
    msg.includes("predicciones_orden_campana_unica")
    || msg.includes("predicciones_orden_unica")
    || msg.includes("orden_id")
  ) {
    return "Esta orden ya tiene una participación registrada en esta campaña.";
  }
  if (msg.includes("row-level security")) {
    return "No tienes permiso para registrar promociones en este turno.";
  }
  return msg || "No se pudo registrar la participación.";
}

export function usePromociones() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const shiftGate = useBranchShiftGate();
  const shiftId = shiftGate.data?.shiftId ?? null;
  const [campanaIdSeleccionada, setCampanaIdSeleccionada] = useState<string | null>(null);

  const campanasQuery = useQuery({
    queryKey: ["campanas-promocionales-activas"],
    queryFn: listarCampanasActivas,
    staleTime: 20_000,
  });

  const campanasActivas = campanasQuery.data ?? [];

  useEffect(() => {
    if (campanasActivas.length === 0) {
      setCampanaIdSeleccionada(null);
      return;
    }
    const sigueValida = campanaIdSeleccionada
      && campanasActivas.some((c) => c.id === campanaIdSeleccionada);
    if (!sigueValida) {
      setCampanaIdSeleccionada(campanasActivas[0].id);
    }
  }, [campanasActivas, campanaIdSeleccionada]);

  const campanaSeleccionada =
    campanasActivas.find((c) => c.id === campanaIdSeleccionada) ?? campanasActivas[0] ?? null;

  const ordenesQuery = useQuery({
    queryKey: [PROMOCIONES_ORDENES_QUERY_KEY, shiftId, activeBranchId, campanaSeleccionada?.id],
    queryFn: async () => {
      if (!shiftId || !campanaSeleccionada) return [];
      return listarOrdenesElegiblesPromociones(campanaSeleccionada, shiftId, activeBranchId);
    },
    enabled: Boolean(shiftId && campanaSeleccionada),
    staleTime: 8_000,
    refetchInterval: 12_000,
  });

  const registrarMutation = useMutation({
    mutationFn: registrarPrediccionCliente,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [PROMOCIONES_ORDENES_QUERY_KEY] });
      toast.success("Participación registrada.");
    },
    onError: (e) => toast.error(mensajeError(e)),
  });

  return {
    campanasActivas,
    campanaSeleccionada,
    setCampanaSeleccionada: setCampanaIdSeleccionada,
    campanasCargando: campanasQuery.isLoading,
    ordenesElegibles: ordenesQuery.data ?? [],
    ordenesCargando: ordenesQuery.isLoading,
    refetchOrdenes: ordenesQuery.refetch,
    registrarPrediccion: registrarMutation.mutateAsync,
    isRegistrando: registrarMutation.isPending,
  };
}
