import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import {
  contarAutopedidosPendientes,
  listarAutopedidosPendientes,
} from "@/services/autopedidosQrDb";

const QUERY_KEY = "autopedidos-qr-pendientes";

export function useAutopedidosQrPendientes(options?: { enabled?: boolean }) {
  const { activeBranchId } = useBranch();
  const shiftGate = useBranchShiftGate();
  const enabled =
    (options?.enabled ?? true) &&
    !!activeBranchId &&
    !!shiftGate.data?.shiftId;

  const countQuery = useQuery({
    queryKey: [QUERY_KEY, "count", activeBranchId],
    enabled,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!activeBranchId) return 0;
      return contarAutopedidosPendientes(activeBranchId);
    },
  });

  const listQuery = useQuery({
    queryKey: [QUERY_KEY, "list", activeBranchId],
    enabled: enabled && (countQuery.data ?? 0) >= 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      if (!activeBranchId) return [];
      return listarAutopedidosPendientes(activeBranchId);
    },
  });

  const pendientes = listQuery.data ?? [];
  const count = countQuery.data ?? pendientes.length;

  const agrupadosPorMesa = useMemo(() => {
    const map = new Map<
      string,
      {
        mesaId: string | null;
        mesaNombre: string;
        mesaVisualOrder: number;
        ordenes: typeof pendientes;
      }
    >();

    for (const orden of pendientes) {
      const key = orden.mesa_id ?? orden.orden_id;
      const existing = map.get(key);
      if (existing) {
        existing.ordenes.push(orden);
      } else {
        map.set(key, {
          mesaId: orden.mesa_id,
          mesaNombre: orden.mesa_nombre,
          mesaVisualOrder: orden.mesa_visual_order,
          ordenes: [orden],
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => a.mesaVisualOrder - b.mesaVisualOrder || a.mesaNombre.localeCompare(b.mesaNombre),
    );
  }, [pendientes]);

  return {
    count,
    pendientes,
    agrupadosPorMesa,
    isLoading: countQuery.isLoading || listQuery.isLoading,
    refetch: async () => {
      await Promise.all([countQuery.refetch(), listQuery.refetch()]);
    },
  };
}

export function useAutopedidosQrMutations() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: [QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    void qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
    if (activeBranchId) {
      void qc.invalidateQueries({ queryKey: [QUERY_KEY, "count", activeBranchId] });
      void qc.invalidateQueries({ queryKey: [QUERY_KEY, "list", activeBranchId] });
    }
  };

  const aprobar = useMutation({
    mutationFn: async (ordenId: string) => {
      const { aprobarAutopedidoQr } = await import("@/services/autopedidosQrDb");
      await aprobarAutopedidoQr(ordenId);
    },
    onSuccess: invalidate,
  });

  const rechazar = useMutation({
    mutationFn: async (params: { ordenId: string; motivo?: string }) => {
      const { rechazarAutopedidoQr } = await import("@/services/autopedidosQrDb");
      await rechazarAutopedidoQr(params.ordenId, params.motivo);
    },
    onSuccess: invalidate,
  });

  return { aprobar, rechazar };
}
