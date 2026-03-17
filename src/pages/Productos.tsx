import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, PackageSearch, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import MenuNavigator from "@/components/order/MenuNavigator";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { supabase } from "@/integrations/supabase/client";
import { canOperate, canView } from "@/lib/permissions";
import type { MenuNode } from "@/hooks/useMenuTree";

const Productos = () => {
  const { permissions, activeBranchId } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const qc = useQueryClient();
  const [pendingNodeId, setPendingNodeId] = useState<string | null>(null);

  const canViewOrders = canView(permissions, "ordenes");
  const canViewDispatch =
    canView(permissions, "despacho_total") ||
    canView(permissions, "despacho_mesa") ||
    canView(permissions, "despacho_para_llevar");

  const canOperateDispatch =
    canOperate(permissions, "despacho_total") ||
    canOperate(permissions, "despacho_mesa") ||
    canOperate(permissions, "despacho_para_llevar");

  const canOperateByShift = Boolean(shiftGateQuery.data?.canDispatchOrders) || Boolean(shiftGateQuery.data?.isSupervisor);
  const readOnly = !canOperateDispatch || !canOperateByShift;

  const refreshMenuQueries = () => {
    qc.invalidateQueries({ queryKey: ["menu-tree"] });
    qc.invalidateQueries({ queryKey: ["menu-products"] });
    qc.invalidateQueries({ queryKey: ["menu-categories"] });
    qc.invalidateQueries({ queryKey: ["menu-subcategories"] });
    qc.invalidateQueries({ queryKey: ["menu-modifiers"] });
  };

  const toggleNodeAvailability = async (node: MenuNode) => {
    if (!activeBranchId || readOnly) return;
    setPendingNodeId(node.id);
    try {
      const { data: branchNodes, error: branchNodesError } = await supabase
        .from("menu_nodes" as never)
        .select("id, parent_id")
        .eq("branch_id", activeBranchId);
      if (branchNodesError) throw branchNodesError;

      const childrenByParent = new Map<string | null, string[]>();
      for (const branchNode of (branchNodes ?? []) as Array<{ id: string; parent_id: string | null }>) {
        const key = branchNode.parent_id ?? null;
        const bucket = childrenByParent.get(key) ?? [];
        bucket.push(branchNode.id);
        childrenByParent.set(key, bucket);
      }

      const targetIds = new Set<string>([node.id]);
      const queue = [node.id];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        const childIds = childrenByParent.get(currentId) ?? [];
        for (const childId of childIds) {
          if (targetIds.has(childId)) continue;
          targetIds.add(childId);
          queue.push(childId);
        }
      }

      const { error } = await supabase
        .from("menu_nodes" as never)
        .update({ is_active: !node.is_active } as never)
        .eq("branch_id", activeBranchId)
        .in("id", [...targetIds]);
      if (error) throw error;

      refreshMenuQueries();
      const affectedCount = targetIds.size;
      toast.success(
        node.is_active
          ? `Nodo marcado como agotado (${affectedCount} elemento${affectedCount === 1 ? "" : "s"})`
          : `Nodo activado (${affectedCount} elemento${affectedCount === 1 ? "" : "s"})`,
      );
    } catch (error: any) {
      toast.error(error?.message || "No se pudo actualizar el nodo");
    } finally {
      setPendingNodeId(null);
    }
  };

  if (!canViewOrders && !canViewDispatch) {
    return (
      <div className="p-4">
        <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
          No tienes permisos para consultar productos en esta sucursal.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-2.5 sm:p-4">
      <div className="surface-glow px-4 py-4 sm:px-5">
        <div className="relative flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
              <PackageSearch className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-black text-foreground">Productos</h1>
              <p className="text-sm text-muted-foreground">
                Arbol de menu para consulta. En despacho puedes marcar productos agotados o reactivarlos.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-xs text-muted-foreground shadow-sm">
              {readOnly ? (
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  Solo consulta
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Power className="h-3.5 w-3.5" />
                  Puedes activar/desactivar
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-orange-200 bg-white/75 p-3 shadow-[0_22px_55px_-42px_rgba(249,115,22,0.55)] sm:p-4">
        <MenuNavigator
          includeInactive={true}
          onSelectProduct={() => {}}
          renderNodeAction={(node) => (
            <Button
              type="button"
              size="sm"
              variant={node.is_active ? "destructive" : "secondary"}
              className="h-11 w-full rounded-2xl px-3 text-xs font-bold leading-tight"
              disabled={readOnly || pendingNodeId === node.id}
              onClick={(event) => {
                event.stopPropagation();
                void toggleNodeAvailability(node);
              }}
            >
              {node.is_active ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              <span className="truncate">
                {pendingNodeId === node.id ? "Guardando..." : node.is_active ? "Desactivar" : "Activar"}
              </span>
            </Button>
          )}
        />
      </div>
    </div>
  );
};

export default Productos;
