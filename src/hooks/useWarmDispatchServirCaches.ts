import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { ensureDispatchBootstrap } from "@/hooks/useDispatchConfig";
import { ensurePlatosProductIdsForBranch } from "@/lib/menuPlatosCategory";

/**
 * Con turno OPEN, calienta bootstrap + catálogo platos.
 * NO precarga el bundle de cola: un prefetch vacío envenenaba Servir/Despacho.
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

    void Promise.all([
      ensureDispatchBootstrap(qc, activeBranchId),
      ensurePlatosProductIdsForBranch(qc, activeBranchId),
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
