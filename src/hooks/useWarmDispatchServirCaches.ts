import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { ensureDispatchBootstrap } from "@/hooks/useDispatchConfig";
import { ensureDispatchServirQueueBundle } from "@/lib/dispatchServirQueueBundle";
import { ensurePlatosProductIdsForBranch } from "@/lib/menuPlatosCategory";

/**
 * Con turno OPEN, calienta en paralelo bootstrap + platos + bundle RPC.
 * Al entrar a Servir/Despacho el camino crítico suele estar en cache.
 */
export function useWarmDispatchServirCaches() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const { data: gate } = useBranchShiftGate();

  useEffect(() => {
    if (!activeBranchId || !user?.id) return;
    if (!gate?.shiftOpen || !gate.shiftId) return;

    const canWarm =
      Boolean(gate.canDispatchOrders)
      || Boolean(gate.canServePlates)
      || Boolean(gate.isSupervisor);
    if (!canWarm) return;

    const shiftId = gate.shiftId;

    void Promise.all([
      ensureDispatchBootstrap(qc, activeBranchId),
      ensurePlatosProductIdsForBranch(qc, activeBranchId),
      ensureDispatchServirQueueBundle(qc, activeBranchId, shiftId),
    ]).catch(() => {
      // Prefetch best-effort: el módulo hará el fetch al entrar.
    });
  }, [
    activeBranchId,
    user?.id,
    gate?.shiftOpen,
    gate?.shiftId,
    gate?.canDispatchOrders,
    gate?.canServePlates,
    gate?.isSupervisor,
    qc,
  ]);
}
