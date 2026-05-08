import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { fetchOrderDetail, getOrderQueryKey } from "@/hooks/useOrder";

const seedSpecialDraftOrderCache = (
  qc: ReturnType<typeof useQueryClient>,
  orderId: string,
  {
    branchId,
    createdAt,
  }: {
    branchId: string;
    createdAt: string;
  },
) => {
  qc.setQueryData(getOrderQueryKey(orderId), {
    id: orderId,
    order_number: null,
    order_code: null,
    status: "DRAFT",
    order_type: "DINE_IN",
    menu_scope: "TABLE",
    is_special: true,
    is_tray_order: false,
    special_total_manual: null,
    branch_id: branchId,
    table_id: null,
    split_id: null,
    table_name: undefined,
    created_at: createdAt,
    items: [],
    siblings: [],
  });
};

const OrdenEspecial = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId } = useBranch();

  useEffect(() => {
    const run = async () => {
      if (!user || !activeBranchId) return;

      try {
        const now = new Date().toISOString();
        const { data, error } = await supabase.rpc("create_dine_in_order" as any, {
          p_branch_id: activeBranchId,
          p_created_by: user.id,
          p_table_id: null,
          p_is_special: true,
        } as any);

        if (error) throw error;

        const orderId = String(data);
        seedSpecialDraftOrderCache(qc, orderId, { branchId: activeBranchId, createdAt: now });

        toast.success("Abriendo orden especial...");
        navigate(`/ordenes?order=${orderId}&origin=orden-especial`, { replace: true });
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["tables-with-status"] });
        void qc.prefetchQuery({
          queryKey: getOrderQueryKey(orderId),
          queryFn: () => fetchOrderDetail(orderId),
          staleTime: 15_000,
          gcTime: 10 * 60_000,
        });
      } catch (err: any) {
        toast.error(err?.message || "Error al abrir orden especial");
        navigate("/mesas", { replace: true });
      }
    };

    void run();
  }, [activeBranchId, navigate, qc, user]);

  return null;
};

export default OrdenEspecial;

