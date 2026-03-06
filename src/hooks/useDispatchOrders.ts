import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDispatchConfig } from "./useDispatchConfig";
import type { OrderStatus } from "@/types/cancellation";

export interface DispatchOrderItem {
  id: string;
  description_snapshot: string;
  quantity: number;
  dispatched_at: string | null;
  modifiers: { description: string }[];
}

export interface DispatchOrder {
  id: string;
  order_number: number;
  order_code: string | null;
  order_type: "DINE_IN" | "TAKEOUT";
  table_name: string | null;
  split_code: string | null;
  status: OrderStatus;
  updated_at: string;
  items: DispatchOrderItem[];
}

export function useDispatchOrders() {
  const qc = useQueryClient();
  const { activeBranchId } = useBranch();
  const { user } = useAuth();
  const { config, assignments, isLoading: configLoading } = useDispatchConfig();

  const query = useQuery({
    queryKey: ["dispatch-orders", activeBranchId, config?.dispatch_mode, user?.id],
    queryFn: async () => {
      if (!activeBranchId || !user) {
        console.log("Missing activeBranchId or user, skipping order fetch");
        return [];
      }

      // Use default SINGLE mode if config doesn't exist yet
      const dispatchMode = config?.dispatch_mode || "SINGLE";

      try {
        console.log("🔍 Starting dispatch orders fetch:", {
          branchId: activeBranchId,
          dispatchMode: dispatchMode,
          userId: user.id,
        });

        // Step 1: Fetch basic orders data WITHOUT complex joins
        console.log("📍 Step 1: Fetching basic orders data...");
        console.log("   Filter: branch_id =", activeBranchId, "| status IN [SENT_TO_KITCHEN, READY]");
        
        const { data: orders, error: ordersError } = await supabase
          .from("orders")
          .select(
            `
            id,
            order_number,
            order_code,
            order_type,
            table_id,
            split_id,
            status,
            updated_at
          `
          )
          .eq("branch_id", activeBranchId)
          .in("status", ["SENT_TO_KITCHEN", "READY"])
          .order("updated_at", { ascending: true });

        if (ordersError) {
          console.error("❌ Error in Step 1 - Fetching orders:", {
            code: ordersError.code,
            message: ordersError.message,
            details: ordersError.details,
            hint: ordersError.hint,
          });
          throw new Error(`Failed to fetch orders: ${ordersError.message}`);
        }

        console.log("📊 Step 1 Response:", {
          ordersCount: orders?.length || 0,
          rawData: orders,
        });

        if (!orders || orders.length === 0) {
          console.log("✓ No orders found with SENT_TO_KITCHEN or READY status");
          console.log("ℹ️ Debug: Check if: 1) Branch ID matches actual orders 2) Order statuses are SENT_TO_KITCHEN|READY 3) RLS not blocking");
          return [];
        }

        console.log(`✓ Step 1 Success: Found ${orders.length} orders`);

        // Step 2: Fetch table names for orders with table_id
        console.log("📍 Step 2: Fetching table names...");
        const tableIds = [...new Set((orders as any[]).map((o: any) => o.table_id).filter(Boolean))] as string[];
        let tablesMap: Record<string, string> = {};
        
        if (tableIds.length > 0) {
          const { data: tables, error: tablesError } = await supabase
            .from("restaurant_tables")
            .select("id, name")
            .in("id", tableIds);

          if (tablesError) {
            console.error("⚠️ Warning - Error fetching tables:", tablesError.message);
          } else if (tables) {
            tablesMap = Object.fromEntries(tables.map((t: any) => [t.id, t.name]));
            console.log(`✓ Step 2 Success: Fetched ${tables.length} table names`);
          }
        }

        // Step 3: Fetch split codes for orders with split_id
        console.log("📍 Step 3: Fetching split codes...");
        const splitIds = [...new Set((orders as any[]).map((o: any) => o.split_id).filter(Boolean))] as string[];
        let splitsMap: Record<string, string> = {};
        
        if (splitIds.length > 0) {
          const { data: splits, error: splitsError } = await supabase
            .from("order_splits")
            .select("id, code")
            .in("id", splitIds);

          if (splitsError) {
            console.error("⚠️ Warning - Error fetching splits:", splitsError.message);
          } else if (splits) {
            splitsMap = Object.fromEntries(splits.map((s: any) => [s.id, s.code]));
            console.log(`✓ Step 3 Success: Fetched ${splits.length} split codes`);
          }
        }

        // Step 4: Fetch order items
        console.log("📍 Step 4: Fetching order items...");
        const orderIds = (orders as any[]).map((o: any) => o.id);
        let itemsMap: Record<string, any[]> = {};
        
        if (orderIds.length > 0) {
          const { data: items, error: itemsError } = await supabase
            .from("order_items")
            .select(
              `
              id,
              order_id,
              description_snapshot,
              quantity,
              dispatched_at
            `
            )
            .in("order_id", orderIds);

          if (itemsError) {
            console.error("⚠️ Warning - Error fetching items:", itemsError.message);
          } else if (items) {
            itemsMap = items.reduce((acc: any, item: any) => {
              if (!acc[item.order_id]) acc[item.order_id] = [];
              acc[item.order_id].push(item);
              return acc;
            }, {});
            console.log(`✓ Step 4 Success: Fetched ${items.length} order items`);
          }
        }

        // Step 5: Map everything together
        console.log("📍 Step 5: Mapping data together...");
        
        // Filter orders based on dispatch mode
        let filteredOrders = orders;
        let effectiveMode = dispatchMode;

        if (dispatchMode === "SPLIT") {
          const userAssignments = (assignments || []).filter(a => a.user_id === user.id);

          if (userAssignments.length === 0) {
            console.log("⚠️ User has no assignments in SPLIT mode, falling back to SINGLE mode");
            effectiveMode = "SINGLE";
          } else {
            const assignedTypes = new Set(userAssignments.map(a => a.dispatch_type));
            filteredOrders = (orders as any[]).filter((o: any) => {
              const orderType = o.order_type === "DINE_IN" || o.order_type === "TABLE" ? "TABLE" : "TAKEOUT";
              return assignedTypes.has(orderType) || assignedTypes.has("ALL");
            });

            console.log(`✓ Filtered to ${filteredOrders.length} orders for user in SPLIT mode`);
          }
        }

        if (effectiveMode === "SINGLE") {
          console.log(`✓ SINGLE mode: showing all ${filteredOrders.length} orders`);
        }

        const dispatchOrders = (filteredOrders as any[]).map((o: any) => ({
          id: o.id,
          order_number: o.order_number,
          order_code: o.order_code,
          order_type: o.order_type,
          table_name: tablesMap[o.table_id] || null,
          split_code: splitsMap[o.split_id] || null,
          status: o.status,
          updated_at: o.updated_at,
          items: (itemsMap[o.id] || []).map((item: any) => ({
            id: item.id,
            description_snapshot: item.description_snapshot,
            quantity: item.quantity,
            dispatched_at: item.dispatched_at,
            modifiers: [], // Simplified for now - can add later if needed
          })),
        }));

        console.log(`✅ Successfully loaded ${dispatchOrders.length} orders for dispatch`);
        return dispatchOrders;
      } catch (error: any) {
        console.error("❌ DISPATCH ORDERS ERROR - Full Details:", {
          errorMessage: error?.message,
          errorCode: error?.code,
          errorDetails: error?.details,
          errorHint: error?.hint,
          stack: error?.stack,
          timestamp: new Date().toISOString(),
        });
        toast.error("Error al cargar órdenes para despacho");
        return [];
      }
    },
    enabled: !!activeBranchId && !!user, // Don't require config to exist
    refetchInterval: 5000, // Refetch every 5 seconds for real-time updates
  });

  // Mark order as READY
  const markReadyMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "READY" })
        .eq("id", orderId);

      if (updateError) throw updateError;

      // Create notification for meseros
      try {
        const notifResult = await (supabase
          .from("order_ready_notifications" as any)
          .insert({
            order_id: orderId,
            created_at: new Date().toISOString(),
          }) as any);
        
        if (notifResult.error) {
          console.error("Error creating notification:", notifResult.error);
        }
      } catch (notifError) {
        console.error("Error creating notification:", notifError);
        // Don't fail the mutation if notification fails
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast.success("Orden lista para despachar");
    },
    onError: (error: any) => {
      console.error("Error marking order ready:", error);
      toast.error("Error al marcar orden lista");
    },
  });

  // Mark order as KITCHEN_DISPATCHED
  const markDispatchedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "KITCHEN_DISPATCHED" })
        .eq("id", orderId);

      if (updateError) throw updateError;

      // Mark all items as dispatched
      const now = new Date().toISOString();
      const { error: itemsError } = await supabase
        .from("order_items")
        .update({ dispatched_at: now })
        .eq("order_id", orderId);

      if (itemsError) throw itemsError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast.success("Orden despachada");
    },
    onError: (error: any) => {
      console.error("Error marking order dispatched:", error);
      toast.error("Error al despachar orden");
    },
  });

  return {
    orders: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    markReady: markReadyMutation,
    markDispatched: markDispatchedMutation,
  };
}
