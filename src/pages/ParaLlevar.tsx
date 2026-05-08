import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { fetchOrderDetail, fetchTakeoutSiblingOrders, getOrderQueryKey } from "@/hooks/useOrder";

const seedTakeoutOrderCache = (
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
    order_type: "TAKEOUT",
    menu_scope: "TAKEOUT",
    is_special: false,
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

const ParaLlevar = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { activeBranchId } = useBranch();

  useEffect(() => {
    const run = async () => {
      if (!user || !activeBranchId) return;

      try {
        const activeTakeoutOrders = await fetchTakeoutSiblingOrders(activeBranchId);
        const existingOrderId = activeTakeoutOrders[0]?.id ?? null;
        if (existingOrderId) {
          toast.success("Entrando a Para llevar...");
          navigate(`/ordenes?order=${existingOrderId}&origin=para-llevar`, { replace: true });
          void qc.prefetchQuery({
            queryKey: getOrderQueryKey(existingOrderId),
            queryFn: () => fetchOrderDetail(existingOrderId),
            staleTime: 15_000,
            gcTime: 10 * 60_000,
          });
          return;
        }

        const now = new Date().toISOString();
        const { data, error } = await supabase.rpc("create_takeout_order" as any, {
          p_branch_id: activeBranchId,
          p_created_by: user.id,
        } as any);

        if (error) throw error;

        const orderId = String(data);
        seedTakeoutOrderCache(qc, orderId, { branchId: activeBranchId, createdAt: now });

        toast.success("Abriendo nueva orden para llevar...");
        navigate(`/ordenes?order=${orderId}&origin=para-llevar`, { replace: true });
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["tables-with-status"] });
        void qc.prefetchQuery({
          queryKey: getOrderQueryKey(orderId),
          queryFn: () => fetchOrderDetail(orderId),
          staleTime: 15_000,
          gcTime: 10 * 60_000,
        });
      } catch (err: any) {
        toast.error(err?.message || "Error al abrir orden para llevar");
        navigate("/mesas", { replace: true });
      }
    };

    void run();
  }, [activeBranchId, navigate, qc, user]);

  return null;
};

export default ParaLlevar;

