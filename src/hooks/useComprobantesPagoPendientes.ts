import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import {
  COMPROBANTES_PENDIENTES_QUERY_KEY,
  listarComprobantesPagoPendientes,
  reemplazarFotoComprobantePendiente,
  subirComprobantePagoPendiente,
  type ComprobantePagoPendienteLocal,
} from "@/lib/comprobantePagoPendienteLocal";

export function useComprobantesPagoPendientes() {
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();

  const pendientesQuery = useQuery({
    queryKey: [COMPROBANTES_PENDIENTES_QUERY_KEY, activeBranchId ?? "_"],
    queryFn: () => listarComprobantesPagoPendientes(activeBranchId),
    enabled: Boolean(activeBranchId),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const reintentar = useMutation({
    mutationFn: async (pagoId: string) => {
      await subirComprobantePagoPendiente(pagoId);
    },
    onSuccess: () => {
      toast.success("Comprobante subido correctamente");
      qc.invalidateQueries({ queryKey: [COMPROBANTES_PENDIENTES_QUERY_KEY] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "No se pudo subir el comprobante");
      qc.invalidateQueries({ queryKey: [COMPROBANTES_PENDIENTES_QUERY_KEY] });
    },
  });

  const adjuntarOtraFoto = useMutation({
    mutationFn: async (params: {
      pendiente: ComprobantePagoPendienteLocal;
      archivo: File;
    }) => {
      if (!activeBranchId || !user?.id) {
        throw new Error("Sesión o sucursal no disponible");
      }
      await reemplazarFotoComprobantePendiente({
        pagoId: params.pendiente.pagoId,
        archivo: params.archivo,
        sucursalId: activeBranchId,
        usuarioId: user.id,
        ordenId: params.pendiente.ordenId,
        ordenNumero: params.pendiente.ordenNumero,
        ordenCodigo: params.pendiente.ordenCodigo,
        monto: params.pendiente.monto,
      });
    },
    onSuccess: () => {
      toast.success("Comprobante subido correctamente");
      qc.invalidateQueries({ queryKey: [COMPROBANTES_PENDIENTES_QUERY_KEY] });
      qc.invalidateQueries({ queryKey: ["completed-payments"] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "No se pudo subir el comprobante");
      qc.invalidateQueries({ queryKey: [COMPROBANTES_PENDIENTES_QUERY_KEY] });
    },
  });

  return {
    pendientes: pendientesQuery.data ?? [],
    isLoading: pendientesQuery.isLoading,
    refetch: pendientesQuery.refetch,
    reintentar,
    adjuntarOtraFoto,
  };
}
