import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";

export type TrayItemType = "A" | "B" | "C";

export interface AddTrayItemParams {
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  trayItemType: TrayItemType;
  containerCost?: number;
  itemNote?: string | null;
}

export function useTrayOrder() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId } = useBranch();

  const createTrayOrder = useMutation({
    mutationFn: async () => {
      if (!activeBranchId || !user?.id) {
        throw new Error("No hay sucursal activa o usuario autenticado.");
      }

      const { data, error } = await supabase.rpc("create_tray_order" as any, {
        p_branch_id: activeBranchId,
        p_created_by: user.id,
      });
      if (error) throw error;
      return String(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addTrayItem = useMutation({
    mutationFn: async (params: AddTrayItemParams) => {
      const { data, error } = await supabase.rpc("add_tray_order_item" as any, {
        p_order_id: params.orderId,
        p_product_id: params.productId,
        p_quantity: params.quantity,
        p_unit_price: params.unitPrice,
        p_tray_item_type: params.trayItemType,
        p_tray_container_cost: params.containerCost ?? 0,
        p_item_note: params.itemNote ?? null,
      });
      if (error) throw error;
      return String(data);
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["order", variables.orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return {
    createTrayOrder,
    addTrayItem,
  };
}
