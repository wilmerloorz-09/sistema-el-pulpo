import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

export type OpenCashRegisterCounts = { denomination_id: string; qty: number }[];

/**
 * Apertura de caja sin montar useCaja (payable-orders, RT de cobros, etc.).
 * Usar en CajaAutoOpener y rutas que solo necesitan abrir caja.
 */
export async function openCashRegisterRpc(params: {
  shiftId: string;
  cashierId: string;
  branchId: string;
  counts?: OpenCashRegisterCounts;
}) {
  const normalizedDenomCounts = (params.counts ?? []).map((denom) => ({
    denomination_id: denom.denomination_id,
    qty: Math.max(0, Math.trunc(denom.qty || 0)),
  }));

  const { error } = await supabase.rpc("open_cash_register" as any, {
    p_shift_id: params.shiftId,
    p_cashier_id: params.cashierId,
    p_branch_id: params.branchId,
    p_denoms: normalizedDenomCounts,
  });
  if (error) throw error;
}

type UseOpenCashRegisterOptions = {
  /** Si true, no muestra toast de éxito (auto-apertura). */
  silent?: boolean;
};

export function useOpenCashRegister(options: UseOpenCashRegisterOptions = {}) {
  const { silent = false } = options;
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const { data: shiftGate } = useBranchShiftGate();

  return useMutation({
    mutationFn: async ({ counts = [] }: { counts?: OpenCashRegisterCounts } = {}) => {
      if (!user) throw new Error("No user");
      if (!activeBranchId) throw new Error("No branch selected");
      const shiftId = shiftGate?.shiftId;
      if (!shiftId || !shiftGate?.shiftOpen) {
        throw new Error("No hay turno abierto");
      }

      await openCashRegisterRpc({
        shiftId,
        cashierId: user.id,
        branchId: activeBranchId,
        counts,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["current-shift"] });
      void qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      void qc.invalidateQueries({ queryKey: ["branch-table-settings"] });
      void qc.invalidateQueries({ queryKey: ["branch-shift-gate"] });
      if (!silent) toast.success("Caja abierta");
    },
    onError: (err: any) => {
      if (!silent) toast.error(err?.message || "No se pudo abrir la caja");
    },
  });
}
