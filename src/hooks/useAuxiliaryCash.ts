import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/services/DatabaseService";

export interface AuxiliaryCashAssignment {
  shiftId: string | null;
  isAssigned: boolean;
  openingId: string | null;
  openingStatus: "abierta" | "cerrada" | "anulada" | null;
}

export interface AuxiliaryDenomination {
  id: string;
  label: string;
  value: number;
  image_url: string | null;
  display_order: number;
  qty_current: number;
}

export interface AuxiliaryTarget {
  opening_id: string;
  cashier_id: string;
  cashier_name: string;
  register_role: string;
  denominations: Array<{ id: string; qty_current: number }>;
}

export interface AuxiliaryExchangeLine {
  denomination_id: string;
  qty: number;
  label?: string;
  value?: number;
}

export interface AuxiliaryExchange {
  id: string;
  target_opening_id: string;
  target_cashier_id: string;
  target_cashier_name: string;
  amount: number;
  given_detail: AuxiliaryExchangeLine[];
  received_detail: AuxiliaryExchangeLine[];
  reason: string | null;
  status: "active" | "voided" | "corrected";
  created_at: string;
  created_by_name: string;
  voided_at: string | null;
  void_reason: string | null;
  correction_exchange_id: string | null;
}

export interface AuxiliaryCashContext {
  shift_id: string;
  branch_id: string;
  auxiliary_cashier_id: string;
  opening_id: string | null;
  opening_status: "abierta" | "cerrada" | "anulada" | null;
  denominations: AuxiliaryDenomination[];
  targets: AuxiliaryTarget[];
  exchanges: AuxiliaryExchange[];
}

const assignmentKey = (branchId: string | null, userId: string | null) =>
  ["auxiliary-cash-assignment", branchId, userId] as const;

const contextKey = (branchId: string | null) =>
  ["auxiliary-cash-context", branchId] as const;

export function useAuxiliaryCashAssignment() {
  const { activeBranchId } = useBranch();
  const { user } = useAuth();

  return useQuery({
    queryKey: assignmentKey(activeBranchId, user?.id ?? null),
    queryFn: async (): Promise<AuxiliaryCashAssignment> => {
      if (!activeBranchId || !user?.id) {
        return { shiftId: null, isAssigned: false, openingId: null, openingStatus: null };
      }

      const { data, error } = await supabase.rpc(
        "get_my_auxiliary_cash_assignment" as any,
        { p_branch_id: activeBranchId } as any,
      );
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        shiftId: row?.shift_id ?? null,
        isAssigned: Boolean(row?.is_assigned),
        openingId: row?.opening_id ?? null,
        openingStatus: row?.opening_status ?? null,
      };
    },
    enabled: Boolean(activeBranchId && user?.id),
    staleTime: 15_000,
  });
}

export function useAuxiliaryCash() {
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const assignmentQuery = useAuxiliaryCashAssignment();

  const contextQuery = useQuery({
    queryKey: contextKey(activeBranchId),
    queryFn: async (): Promise<AuxiliaryCashContext> => {
      if (!activeBranchId) throw new Error("No hay sucursal activa");
      const { data, error } = await supabase.rpc(
        "get_auxiliary_cash_context" as any,
        { p_branch_id: activeBranchId } as any,
      );
      if (error) throw error;
      return data as unknown as AuxiliaryCashContext;
    },
    enabled: Boolean(
      activeBranchId
      && user?.id
      && assignmentQuery.data?.isAssigned,
    ),
    staleTime: 5_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: contextKey(activeBranchId) }),
      queryClient.invalidateQueries({ queryKey: assignmentKey(activeBranchId, user?.id ?? null) }),
      queryClient.invalidateQueries({ queryKey: ["current-shift"], exact: false }),
      queryClient.invalidateQueries({ queryKey: ["branch-shift-gate"], exact: false }),
    ]);
  };

  const registerExchange = useMutation({
    mutationFn: async (params: {
      targetOpeningId: string;
      givenDetail: AuxiliaryExchangeLine[];
      receivedDetail: AuxiliaryExchangeLine[];
      reason?: string;
      correctionOf?: string;
      correctionReason?: string;
    }) => {
      const context = contextQuery.data;
      if (!context?.shift_id || !context.branch_id) {
        throw new Error("No se pudo resolver el turno de la caja auxiliar");
      }

      if (params.correctionOf) {
        const { data, error } = await supabase.rpc(
          "correct_auxiliary_cash_exchange" as any,
          {
            p_exchange_id: params.correctionOf,
            p_shift_id: context.shift_id,
            p_branch_id: context.branch_id,
            p_target_opening_id: params.targetOpeningId,
            p_given_detail: params.givenDetail,
            p_received_detail: params.receivedDetail,
            p_reason: params.reason ?? null,
            p_correction_reason: params.correctionReason ?? "Corrección de datos",
          } as any,
        );
        if (error) throw error;
        return data as string;
      }

      const { data, error } = await supabase.rpc(
        "register_auxiliary_cash_exchange" as any,
        {
          p_shift_id: context.shift_id,
          p_branch_id: context.branch_id,
          p_target_opening_id: params.targetOpeningId,
          p_given_detail: params.givenDetail,
          p_received_detail: params.receivedDetail,
          p_reason: params.reason ?? null,
        } as any,
      );
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });

  const voidExchange = useMutation({
    mutationFn: async (params: { exchangeId: string; reason: string }) => {
      const { error } = await supabase.rpc(
        "void_auxiliary_cash_exchange" as any,
        { p_exchange_id: params.exchangeId, p_reason: params.reason } as any,
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const closeAuxiliaryCash = useMutation({
    mutationFn: async (notes?: string) => {
      const context = contextQuery.data;
      if (!context?.shift_id || !context.branch_id) {
        throw new Error("No se pudo resolver el turno de la caja auxiliar");
      }
      const { error } = await supabase.rpc(
        "close_auxiliary_cash_register" as any,
        {
          p_shift_id: context.shift_id,
          p_branch_id: context.branch_id,
          p_notes: notes ?? null,
        } as any,
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    assignmentQuery,
    contextQuery,
    registerExchange,
    voidExchange,
    closeAuxiliaryCash,
  };
}
