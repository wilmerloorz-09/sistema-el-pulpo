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
  status: string;
  dispatched_at: string | null;
  modifiers: { description: string }[];
  total?: number;
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
  sent_to_kitchen_at: string | null;
  ready_at: string | null;
  dispatched_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
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

      // SINGLE si config no existe, está cargando o viene de la BD como SINGLE
      const dispatchMode = configLoading ? "SINGLE" : (config?.dispatch_mode || "SINGLE");

      try {
        console.log("🔍 Starting dispatch orders fetch:", {
          branchId: activeBranchId,
          dispatchMode: dispatchMode,
          userId: user.id,
        });

        // Step 1: Fetch basic orders data (solo columnas base por si no está aplicada la migración de timestamps)
        console.log("📍 Step 1: Fetching basic orders data...");
        const ordersSelect = [
          "id",
          "order_number",
          "order_code",
          "order_type",
          "table_id",
          "split_id",
          "status",
          "updated_at",
        ];
        const { data: orders, error: ordersError } = await supabase
          .from("orders")
          .select(ordersSelect.join(", "))
          .eq("branch_id", activeBranchId)
          .in("status", ["SENT_TO_KITCHEN", "READY"])
          .order("updated_at", { ascending: true });

        if (ordersError) {
          console.error("❌ Error in Step 1 - Fetching orders:", {
            code: ordersError.code,
            message: ordersError.message,
            details: ordersError.details,
            hint: ordersError.hint,
            branchId: activeBranchId,
            dispatchMode: dispatchMode
          });
          throw new Error(`Failed to fetch orders: ${ordersError.message}`);
        }

        console.log("📊 Step 1 Response:", {
          ordersCount: orders?.length || 0,
          rawData: orders,
          branchId: activeBranchId,
          dispatchMode: dispatchMode
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
  .from("table_splits")
  .select("id, split_code")
  .in("id", splitIds);

          if (splitsError) {
            console.error("⚠️ Warning - Error fetching splits:", splitsError.message);
          } else if (splits) {
            splitsMap = Object.fromEntries(splits.map((s: any) => [s.id, s.split_code]));
            console.log(`✓ Step 3 Success: Fetched ${splits.length} split codes`);
          }
        }

        // Step 4: Fetch order items - EXACTAMENTE como useOrdersByStatus.ts
        console.log("📍 Step 4: Fetching order items...");
        const orderIds = (orders as any[]).map((o: any) => o.id);
        let itemsMap: Record<string, any[]> = {};
        
        if (orderIds.length > 0) {
          const { data: items, error: itemsError } = await supabase
            .from("order_items")
            .select("id, order_id, description_snapshot, quantity, total, status")
            .in("order_id", orderIds);

          if (itemsError) {
            console.error("⚠️ Warning - Error fetching items:", itemsError.message);
          } else if (items) {
            console.log("🔍 useDispatchOrders: Items fetched from DB:", items.length, "items");
            console.log("🔍 useDispatchOrders: Sample item:", items[0]);
            
            // Check if any items have total values
            const itemsWithTotal = items.filter((i: any) => i.total != null && i.total > 0);
            console.log("🔍 useDispatchOrders: Items with total > 0:", itemsWithTotal.length, "of", items.length);
            
            if (itemsWithTotal.length === 0) {
              console.log("⚠️ No items have total > 0, checking all total values:");
              items.forEach((item, index) => {
                console.log(`Item ${index}: total = ${item.total}, quantity = ${item.quantity}`);
              });
            }
            
            // Filter out DRAFT items
            const withStatus = (items as any[]).map((item: any) => ({ ...item, status: item.status ?? "SENT" }));
            const visibleItems = withStatus.filter((item: any) => item.status !== "DRAFT");
            
            console.log("🔍 useDispatchOrders: Items after filtering DRAFT:", visibleItems.length, "visible items from", items.length, "total");
            console.log("🔍 useDispatchOrders: Filtered out DRAFT items:", items.length - visibleItems.length);
            
            itemsMap = visibleItems.reduce((acc: any, item: any) => {
              if (!acc[item.order_id]) acc[item.order_id] = [];
              acc[item.order_id].push(item);
              return acc;
            }, {});
            
            // Log itemsMap to check if totals are preserved
            console.log("🔍 useDispatchOrders: itemsMap sample:");
            Object.keys(itemsMap).forEach(orderId => {
              itemsMap[orderId].forEach((item, index) => {
                console.log(`  Order ${orderId} Item ${index}: total = ${item.total}, type = ${typeof item.total}`);
              });
            });
            
            console.log(`✓ Step 4 Success: Fetched ${visibleItems.length} order items (excluding DRAFT)`);
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

        const mapped = (filteredOrders as any[]).map((o: any) => ({
          id: o.id,
          order_number: o.order_number,
          order_code: o.order_code,
          order_type: o.order_type,
          table_name: tablesMap[o.table_id] || null,
          split_code: splitsMap[o.split_id] || null,
          status: o.status,
          updated_at: o.updated_at,
          sent_to_kitchen_at: o.sent_to_kitchen_at ?? null,
          ready_at: o.ready_at ?? null,
          dispatched_at: o.dispatched_at ?? null,
          paid_at: o.paid_at ?? null,
          cancelled_at: o.cancelled_at ?? null,
          items: (itemsMap[o.id] || []).map((item: any) => ({
            id: item.id,
            description_snapshot: item.description_snapshot,
            quantity: item.quantity,
            status: item.status ?? "SENT",
            dispatched_at: item.dispatched_at,
            total: item.total,
            modifiers: [], // Simplified for now - can add later if needed
          })),
        }));

        // Solo órdenes con al menos un ítem no DRAFT (visible en despacho)
        const dispatchOrders = mapped.filter((o) => o.items.length > 0);

        console.log("🔍 useDispatchOrders: Final orders with items:", dispatchOrders.map((o: any) => ({
          id: o.id,
          order_code: o.order_code,
          status: o.status,
          items_count: o.items.length,
          items: o.items.map((i: any) => ({
            id: i.id,
            description: i.description_snapshot?.substring(0, 20),
            status: i.status,
            quantity: i.quantity
          }))
        })));
        
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
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("orders")
        .update({ status: "READY", ready_at: now })
        .eq("id", orderId);

      if (updateError) throw updateError;

      // Register ready_at on all non-cancelled items of this order
      await supabase
        .from("order_items")
        .update({ ready_at: now })
        .eq("order_id", orderId)
        .neq("status", "CANCELLED");

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
      console.error("❌ Error marking order ready - Full Details:", {
        errorMessage: error?.message,
        errorCode: error?.code,
        errorDetails: error?.details,
        errorHint: error?.hint,
        stack: error?.stack,
        timestamp: new Date().toISOString(),
      });
      toast.error(`Error al marcar orden lista: ${error?.message || 'Error desconocido'}`);
    },
  });

  // Mark order as KITCHEN_DISPATCHED
  const markDispatchedMutation = useMutation({
    mutationFn: async (orderId: string) => {
      console.log("🚀 Starting mark dispatched mutation for order:", orderId);
      const now = new Date().toISOString();
      
      try {
        // Step 1: Update order status and timestamp
        console.log("📍 Step 1: Updating order status to KITCHEN_DISPATCHED...");
        const { data: orderData, error: updateError } = await supabase
          .from("orders")
          .update({ status: "KITCHEN_DISPATCHED", dispatched_at: now })
          .eq("id", orderId)
          .select("id, status, dispatched_at")
          .single();

        if (updateError) {
          console.error("❌ Step 1 Failed - Order update error:", updateError);
          throw updateError;
        }
        
        console.log("✅ Step 1 Success - Order updated:", orderData);

        // Step 2: Update all items timestamp
        console.log("📍 Step 2: Updating order items dispatched_at...");
        const { data: itemsData, error: itemsError } = await supabase
          .from("order_items")
          .update({ dispatched_at: now })
          .eq("order_id", orderId)
          .select("id, dispatched_at");

        if (itemsError) {
          console.error("❌ Step 2 Failed - Items update error:", itemsError);
          throw itemsError;
        }
        
        console.log("✅ Step 2 Success - Items updated:", itemsData);
        console.log("🎉 Order successfully marked as dispatched");
        
        return { orderData, itemsData };
      } catch (error: any) {
        console.error("💥 Mutation failed with error:", error);
        throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      toast.success("Orden despachada");
    },
    onError: (error: any) => {
      console.error("❌ Error marking order dispatched - Full Details:", {
        errorMessage: error?.message,
        errorCode: error?.code,
        errorDetails: error?.details,
        errorHint: error?.hint,
        stack: error?.stack,
        timestamp: new Date().toISOString(),
      });
      toast.error(`Error al despachar orden: ${error?.message || 'Error desconocido'}`);
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
