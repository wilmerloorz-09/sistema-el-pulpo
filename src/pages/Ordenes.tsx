import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useOrder } from "@/hooks/useOrder";
import { useMenuData } from "@/hooks/useMenuData";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import MenuNavigator from "@/components/order/MenuNavigator";
import AddItemDialog from "@/components/order/AddItemDialog";
import OrderItemsList from "@/components/order/OrderItemsList";
import ThermalReceipt from "@/components/order/ThermalReceipt";
import OrdersList from "@/components/order/OrdersList";
import CancelOrderDialog from "@/components/order/CancelOrderDialog";
import ChangeTableDialog from "@/components/order/ChangeTableDialog";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, ChefHat, ShoppingBag, Split, CircleDollarSign, Trash2, Menu, ArrowRightLeft, Sparkles, ChevronLeft, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { OrderSummary, type OrderItemSummary } from "@/hooks/useOrdersByStatus";
import { canManage, canOperate } from "@/lib/permissions";
import type { MenuNode, MenuScope } from "@/hooks/useMenuTree";
import { formatSplitCodeLabel } from "@/lib/splitCode";
import { getOrderOriginLabel } from "@/lib/orderPresentation";
import type { TrayItemType } from "@/hooks/useTrayOrder";

interface SelectedProduct {
  id: string;
  menu_node_id: string;
  description: string;
  subcategory_id: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
  icon?: string | null;
  image_url?: string | null;
}

interface BulkIncludedPreviewAssignment {
  id: string;
  included_node_name: string;
  ranges: Array<{
    id: string;
    amount_from: number;
    amount_to: number;
    included_quantity: number;
    display_order: number | null;
  }>;
}

interface BulkIncludedPreviewRow {
  id: string;
  included_node_name: string;
  matched_quantity: number;
}

const Ordenes = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, branches, permissions, setActiveBranch } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const qc = useQueryClient();
  const orderId = searchParams.get("order");
  const fromMesas = searchParams.get("from") === "mesas";
  const [pendingTrayType, setPendingTrayType] = useState<TrayItemType | null>(null);
  const effectiveTrayType: TrayItemType = pendingTrayType ?? "B";
  const [pendingMenuScopeSelection, setPendingMenuScopeSelection] = useState<MenuScope | null>(null);

  const { order, isLoading, addItem, removeItem, updateQuantity, sendToKitchen, moveToTable, updateMenuScope, updateSpecialTotal, convertToSpecial } = useOrder(orderId);
  const trayMenuScope: MenuScope =
    effectiveTrayType === "A"
      ? "TABLE"
      : effectiveTrayType === "C"
        ? "BULK"
        : "TAKEOUT";
  const persistedMenuScope: MenuScope = order?.menu_scope === "TAKEOUT" ? "TAKEOUT" : "TABLE";
  const currentMenuScope: MenuScope = order?.is_tray_order
    ? trayMenuScope
    : pendingMenuScopeSelection
      ? pendingMenuScopeSelection
    : order?.order_type === "TAKEOUT"
      ? "TAKEOUT"
      : persistedMenuScope;
  const menu = useMenuData(currentMenuScope);
  const tablesQuery = useTablesWithStatus();

  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [removingSplit, setRemovingSplit] = useState(false);
  const [showDeleteSplitConfirm, setShowDeleteSplitConfirm] = useState(false);
  const [showChangeTableDialog, setShowChangeTableDialog] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<OrderSummary | null>(null);
  const [inlineCancelOpen, setInlineCancelOpen] = useState(false);
  const [inlineCancelVisibleItems, setInlineCancelVisibleItems] = useState<OrderItemSummary[]>([]);
  const [inlineCancelQtyByItem, setInlineCancelQtyByItem] = useState<Record<string, number>>({});
  const [inlineCancellationType, setInlineCancellationType] = useState<"partial" | "total">("partial");
  const [inlineRequiresAuthorization, setInlineRequiresAuthorization] = useState(false);
  const [specialTotalInput, setSpecialTotalInput] = useState("");
  const [convertSpecialDialogOpen, setConvertSpecialDialogOpen] = useState(false);
  const [convertSpecialTotalInput, setConvertSpecialTotalInput] = useState("");
  const receiptRef = useRef<HTMLDivElement>(null);
  const syncedOrderBranchRef = useRef<string | null>(null);
  const isBulkScopeSelection = currentMenuScope === "BULK";

  const canOperateOrders = canOperate(permissions, "ordenes");
  const canManageOrders = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");
  const canCancelOrders = canOperateOrders || canManageOrders;
  const canAuthorizeCancel =
    canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global")
    || Boolean(shiftGateQuery.data?.canAuthorizeOrderCancel)
    || Boolean(shiftGateQuery.data?.isSupervisor);
  const isTrayOrder = Boolean(order?.is_tray_order);

  useEffect(() => {
    if (!orderId || !order?.branch_id || !activeBranchId) return;
    if (order.branch_id === activeBranchId) return;
    if (syncedOrderBranchRef.current === order.branch_id) return;

    const matchingBranch = branches.find((branch) => branch.id === order.branch_id);
    if (!matchingBranch) {
      toast.error("Esta orden pertenece a una sucursal que no esta disponible en tu contexto actual.");
      syncedOrderBranchRef.current = order.branch_id;
      return;
    }

    syncedOrderBranchRef.current = order.branch_id;
    void setActiveBranch(matchingBranch).then(() => {
      toast.info("Se cambio la sucursal activa para mostrar la orden en su contexto correcto.");
    });
  }, [orderId, order?.branch_id, activeBranchId, branches, setActiveBranch]);

  useEffect(() => {
    if (!order?.is_special) {
      setSpecialTotalInput("");
      return;
    }

    setSpecialTotalInput(
      order.special_total_manual == null ? "" : Number(order.special_total_manual).toFixed(2),
    );
  }, [order?.id, order?.is_special, order?.special_total_manual]);

  useEffect(() => {
    if (!isTrayOrder) {
      setPendingTrayType(null);
      return;
    }

    setPendingTrayType((current) => current ?? "B");
  }, [isTrayOrder, order?.id]);

  useEffect(() => {
    if (order?.is_tray_order) {
      setPendingMenuScopeSelection(null);
      return;
    }

    if (order?.order_type === "DINE_IN") {
      setPendingMenuScopeSelection("TABLE");
      return;
    }

    setPendingMenuScopeSelection(null);
  }, [order?.id, order?.is_tray_order, order?.order_type]);

  const isTakeout = order?.order_type === "TAKEOUT";
  const interactiveMenuScope =
    !isTrayOrder && pendingMenuScopeSelection
      ? pendingMenuScopeSelection
      : currentMenuScope;

  const printReceipt = useCallback(() => {
    window.print();
  }, []);

  const handleMobileBackToMesas = useCallback(() => {
    if (fromMesas) {
      navigate("/mesas", { replace: true });
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }

    if (order?.table_id || order?.is_tray_order || order?.order_type === "TAKEOUT") {
      navigate("/mesas", { replace: true });
      return;
    }

    navigate("/ordenes", { replace: true });
  }, [fromMesas, navigate, order?.is_tray_order, order?.order_type, order?.table_id]);

  const handleSelectMenuProduct = useCallback(async (node: MenuNode) => {
    const legacyProductId = node.legacy_product_id ?? node.id;
    let legacyProduct = menu.products.find(
      (product) => product.menu_node_id === node.id || product.id === legacyProductId,
    );

    if (!legacyProduct) {
      const { data, error } = await supabase
        .from("products")
        .select("id, description, subcategory_id, unit_price, price_mode")
        .eq("id", node.id)
        .single();

      if (error) {
        toast.error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
        return;
      }

      legacyProduct = {
        id: data.id,
        menu_node_id: node.id,
        description: data.description ?? node.name,
        subcategory_id: data.subcategory_id,
        unit_price: data.unit_price == null ? (node.price ?? null) : Number(data.unit_price),
        price_mode: isTrayOrder
          ? (effectiveTrayType === "C" ? "MANUAL" : "FIXED")
          : data.price_mode,
      };
    }

    setSelectedProduct({
      ...legacyProduct,
      price_mode: isTrayOrder
        ? (effectiveTrayType === "C" ? "MANUAL" : "FIXED")
        : legacyProduct.price_mode,
    });
  }, [effectiveTrayType, isTrayOrder, menu.products]);

  const bulkIncludedPreviewQuery = useQuery({
    queryKey: ["bulk-included-preview", activeBranchId, selectedProduct?.menu_node_id],
    queryFn: async () => {
      if (!activeBranchId || !selectedProduct?.menu_node_id || !isBulkScopeSelection) return [] as BulkIncludedPreviewAssignment[];

      const { data: assignments, error: assignmentsError } = await supabase
        .from("bulk_included_products" as never)
        .select("id, included_node_id, display_order")
        .eq("menu_node_id", selectedProduct.menu_node_id)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      if (assignmentsError) throw assignmentsError;

      const assignmentRows = (assignments ?? []) as Array<{
        id: string;
        included_node_id: string;
        display_order?: number | null;
      }>;
      if (assignmentRows.length === 0) return [];

      const includedNodeIds = assignmentRows.map((row) => row.included_node_id);
      const { data: includedNodes, error: includedNodesError } = await supabase
        .from("menu_nodes" as never)
        .select("id, name")
        .in("id", includedNodeIds);
      if (includedNodesError) throw includedNodesError;

      const { data: ranges, error: rangesError } = await supabase
        .from("bulk_included_product_ranges" as never)
        .select("id, bulk_included_product_id, amount_from, amount_to, included_quantity, display_order")
        .in("bulk_included_product_id", assignmentRows.map((row) => row.id))
        .order("display_order", { ascending: true });
      if (rangesError) throw rangesError;

      const includedNodesById = new Map(
        ((includedNodes ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]),
      );

      return assignmentRows.map((assignment) => ({
        id: assignment.id,
        included_node_name: includedNodesById.get(assignment.included_node_id) ?? "Producto incluido",
        ranges: ((ranges ?? []) as Array<{
          id: string;
          bulk_included_product_id: string;
          amount_from: number | string;
          amount_to: number | string;
          included_quantity: number;
          display_order?: number | null;
        }>)
          .filter((range) => range.bulk_included_product_id === assignment.id)
          .map((range) => ({
            id: range.id,
            amount_from: Number(range.amount_from),
            amount_to: Number(range.amount_to),
            included_quantity: Number(range.included_quantity),
            display_order: range.display_order ?? 0,
          }))
          .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0)),
      }));
    },
    enabled: !!activeBranchId && !!selectedProduct?.menu_node_id && isBulkScopeSelection,
  });

  const resolveBulkIncludedPreview = useCallback((unitPrice: number, quantity: number) => {
    const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
    const safeQuantity = Math.max(0, quantity);
    const assignments = bulkIncludedPreviewQuery.data ?? [];

    return assignments.flatMap((assignment) => {
      const matchedRange = assignment.ranges.find((range) => safeUnitPrice >= range.amount_from && safeUnitPrice <= range.amount_to) ?? null;
      if (!matchedRange || matchedRange.included_quantity <= 0 || safeQuantity <= 0) return [];

      return [{
        id: assignment.id,
        included_node_name: assignment.included_node_name,
        matched_quantity: matchedRange.included_quantity * safeQuantity,
      } satisfies BulkIncludedPreviewRow];
    });
  }, [bulkIncludedPreviewQuery.data]);

  const buildBulkIncludedItemNote = useCallback((unitPrice: number, quantity: number) => {
    const previewRows = resolveBulkIncludedPreview(unitPrice, quantity);
    if (previewRows.length === 0) return null;
    return `Entregar: ${previewRows.map((row) => `${row.included_node_name} X${row.matched_quantity}`).join(", ")}`;
  }, [resolveBulkIncludedPreview]);

  if (!orderId) {
    return (
      <div className="ordenes-mobile-touch flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-4">
          <OrdersList onCancelOrder={canCancelOrders ? setCancelOrder : undefined} readOnly={!canCancelOrders} />
        </div>
        {cancelOrder && user && canCancelOrders && (
        <CancelOrderDialog
          orderId={cancelOrder.id}
          orderNumber={cancelOrder.order_number}
          userId={user.id}
          open={!!cancelOrder}
          onOpenChange={(open) => !open && setCancelOrder(null)}
          canAuthorizeCancel={canAuthorizeCancel}
          isCancelRequested={!!cancelOrder.cancel_requested_at}
          visibleItems={cancelOrder.items}
        />
      )}
      </div>
    );
  }

  if (isLoading || menu.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-destructive">Orden no encontrada</p>
      </div>
    );
  }

  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);
  const total = order.items.reduce((s, i) => s + i.total, 0);
  const specialTotalManual = order.special_total_manual == null ? null : Number(order.special_total_manual);
  const specialDifference = specialTotalManual == null ? null : Math.round((specialTotalManual - total) * 100) / 100;
  const hasDraftItems = order.items.some((i) => i.status === "DRAFT");
  const hasSentItems = order.items.some((i) => i.status !== "DRAFT");
  const isSent = order.status === "SENT_TO_KITCHEN";
  const hasSiblings = order.siblings.length > 0;
  const hasOrderItems = order.items.length > 0;
  const allExistingSplitsHaveItems = !hasSiblings || order.siblings.every((sibling) => sibling.item_count > 0);
  const canSplit =
    order.order_type === "DINE_IN" &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    order.items.length > 0 &&
    allExistingSplitsHaveItems;
  const canDeleteSplit =
    canOperateOrders &&
    !!order.split_id &&
    hasSiblings &&
    !order.sent_to_kitchen_at &&
    !order.ready_at &&
    !order.dispatched_at &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED";
  const canShowChangeTable =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED";
  const canChangeTable = canShowChangeTable && hasOrderItems;
  const canEditItems = canOperateOrders && order.status !== "PAID" && order.status !== "CANCELLED";
  const canShowConvertToSpecial =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    !order.is_special &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED";
  const canConvertToSpecial = canShowConvertToSpecial && hasOrderItems;
  const orderOriginLabel = getOrderOriginLabel({
    orderType: order.order_type,
    tableName: order.table_name,
    splitCode: order.split_code,
    isSpecial: order.is_special,
    isTrayOrder: order.is_tray_order,
  });
  const tableWatermark =
    order.is_tray_order
      ? "ORDEN BANDEJA"
      : order.is_special
      ? "ORDEN ESPECIAL"
      : order.order_type === "DINE_IN"
        ? formatSplitCodeLabel(order.split_code) || (order.table_name ?? "").trim()
        : "PARA LLEVAR";
  const statusLabel: Record<string, string> = {
    DRAFT: "Borrador",
    SENT_TO_KITCHEN: "En cocina",
    READY: "Lista para despachar",
    KITCHEN_DISPATCHED: "Despachada",
    PAID: "Pagada",
    CANCELLED: "Cancelada",
  };

  const statusColor: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SENT_TO_KITCHEN: "bg-primary/15 text-primary",
    READY: "border border-emerald-300 bg-emerald-50 text-emerald-800",
    KITCHEN_DISPATCHED: "border border-amber-300 bg-amber-50 text-amber-900",
    PAID: "bg-accent/15 text-accent",
    CANCELLED: "bg-destructive/15 text-destructive",
  };

  const handleSplit = async () => {
    if (!user || !order.table_id || !canOperateOrders) return;
    if (order.order_type !== "DINE_IN" || order.status === "PAID" || order.status === "CANCELLED") return;
    if (order.items.length <= 0) {
      toast.error("La mesa debe tener al menos un item para dividirse");
      return;
    }
    if (!allExistingSplitsHaveItems) {
      toast.error("No puedes crear una nueva division hasta que todas las divisiones anteriores tengan al menos un item");
      return;
    }
    setSplitting(true);
    try {
      const tableName = order.table_name ?? "Mesa";
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

      if (!hasSiblings) {
        const { data: splitA, error: errA } = await supabase
          .from("table_splits")
          .insert({ table_id: order.table_id, split_code: `${tableName}A` })
          .select("id")
          .single();
        if (errA) throw errA;

        const { data: splitB, error: errB } = await supabase
          .from("table_splits")
          .insert({ table_id: order.table_id, split_code: `${tableName}B` })
          .select("id")
          .single();
        if (errB) throw errB;

        const { error: updateCurrentError } = await supabase.from("orders").update({ split_id: splitA.id }).eq("id", order.id);
        if (updateCurrentError) throw updateCurrentError;

        const { data: newOrder, error: newOrderError } = await supabase
          .from("orders")
          .insert({
          table_id: order.table_id,
          split_id: splitB.id,
          order_type: "DINE_IN" as const,
          menu_scope: order.menu_scope ?? "TABLE",
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
          })
          .select("id")
          .single();
        if (newOrderError || !newOrder) throw newOrderError ?? new Error("No se pudo crear la nueva division");

        toast.success("Mesa dividida en A y B");
        navigate(`/ordenes?order=${newOrder.id}${fromMesas ? "&from=mesas" : ""}`, { replace: true });
      } else {
        const nextIndex = order.siblings.length;
        const nextLetter = letters[nextIndex] ?? `${nextIndex + 1}`;

        const { data: newSplit, error: splitErr } = await supabase
          .from("table_splits")
          .insert({ table_id: order.table_id, split_code: `${tableName}${nextLetter}` })
          .select("id")
          .single();
        if (splitErr) throw splitErr;

        const { data: newOrder, error: newOrderError } = await supabase
          .from("orders")
          .insert({
          table_id: order.table_id,
          split_id: newSplit.id,
          order_type: "DINE_IN" as const,
          menu_scope: order.menu_scope ?? "TABLE",
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
          })
          .select("id")
          .single();
        if (newOrderError || !newOrder) throw newOrderError ?? new Error("No se pudo crear la nueva division");

        toast.success(`Sub-mesa ${tableName}${nextLetter} creada`);
        navigate(`/ordenes?order=${newOrder.id}${fromMesas ? "&from=mesas" : ""}`, { replace: true });
      }

      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSplitting(false);
    }
  };

  const handleDeleteSplit = async () => {
    if (!order.split_id || !canDeleteSplit) return;

    setRemovingSplit(true);
    try {
      const sourceTableId = order.table_id;
      await supabase.from("orders").delete().eq("id", order.id);
      await supabase.from("table_splits").update({ is_active: false }).eq("id", order.split_id);

      if (sourceTableId) {
        const { data: remainingOrders, error: remainingOrdersError } = await supabase
          .from("orders")
          .select("id, split_id, status, order_items(id)")
          .eq("table_id", sourceTableId)
          .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"]);

        if (remainingOrdersError) throw remainingOrdersError;

        const activeRemainingOrders = (remainingOrders ?? []).filter((candidate) => {
          const hasItems = Array.isArray(candidate.order_items) && candidate.order_items.length > 0;
          return candidate.status !== "DRAFT" || hasItems;
        });

        if (activeRemainingOrders.length === 1 && activeRemainingOrders[0].split_id) {
          const remaining = activeRemainingOrders[0];

          const { error: collapseOrderError } = await supabase
            .from("orders")
            .update({ split_id: null })
            .eq("id", remaining.id);
          if (collapseOrderError) throw collapseOrderError;

          const { error: deactivateSplitError } = await supabase
            .from("table_splits")
            .update({ is_active: false })
            .eq("id", remaining.split_id);
          if (deactivateSplitError) throw deactivateSplitError;
        }
      }

      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["orders"] });

      const remainingSibling = order.siblings.find((sibling) => sibling.id !== order.id);
      toast.success("Division eliminada");

      if (remainingSibling) {
        navigate(`/ordenes?order=${remainingSibling.id}${fromMesas ? "&from=mesas" : ""}`, { replace: true });
      } else {
        navigate("/mesas", { replace: true });
      }
    } catch (err: any) {
      toast.error(err.message || "No se pudo eliminar la division");
    } finally {
      setRemovingSplit(false);
      setShowDeleteSplitConfirm(false);
    }
  };

  const handleChangeTable = (destinationTableId: string) => {
    moveToTable.mutate(destinationTableId, {
      onSuccess: (result) => {
        setShowChangeTableDialog(false);
        toast.success(
          result.destination_was_occupied
            ? `Orden movida. Se creo ${result.split_code ?? "una nueva division"} en la mesa destino.`
            : "Orden movida directamente a la mesa destino.",
        );
      },
    });
  };

  const handleSaveSpecialTotal = () => {
    const rawValue = specialTotalInput.trim().replace(",", ".");
    if (!rawValue) {
      updateSpecialTotal.mutate(null, {
        onSuccess: () => toast.success("Total especial limpiado"),
      });
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Ingresa un total especial valido");
      return;
    }

    updateSpecialTotal.mutate(Math.round(parsed * 100) / 100, {
      onSuccess: () => toast.success("Total especial actualizado"),
    });
  };

  const handleConvertToSpecial = () => {
    const rawValue = convertSpecialTotalInput.trim().replace(",", ".");
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Ingresa un total especial valido");
      return;
    }

    convertToSpecial.mutate(Math.round(parsed * 100) / 100, {
      onSuccess: () => {
        setConvertSpecialDialogOpen(false);
      },
    });
  };

  const handleRequestInlineCancel = async (
      item: {
        id: string;
        product_id?: string;
        description_snapshot: string;
        quantity: number;
        quantity_ordered?: number;
        quantity_dispatched?: number;
        quantity_remaining?: number;
        quantity_cancellable?: number;
        total: number;
        unit_price?: number;
        status: string;
        tray_item_type?: "A" | "B" | "C" | null;
        modifiers: { id: string; description: string }[];
        item_note?: string | null;
      },
    qty: number,
  ) => {
    const maxQty = Math.max(0, item.quantity_cancellable ?? item.quantity_remaining ?? item.quantity);
    if (maxQty <= 0) {
      toast.error("Este item ya no tiene cantidad anulable.");
      return;
    }

    const normalizedQty = Math.max(1, Math.min(maxQty, Math.floor(qty)));
    const unitPrice =
      Number(item.unit_price ?? 0) > 0
        ? Number(item.unit_price ?? 0)
        : maxQty > 0
          ? Number(item.total ?? 0) / maxQty
          : 0;
    let requiresAuthorization = !canAuthorizeCancel;

    if (activeBranchId && item.product_id) {
      try {
        const { data, error } = await (supabase as any).rpc("get_branch_cancel_policy_for_product", {
          p_branch_id: activeBranchId,
          p_product_id: item.product_id,
        });
        if (error) throw error;

        const policyRow = Array.isArray(data) ? data[0] : data;
        const allowDirectByCategory = Boolean(policyRow?.allow_direct_cancel);
        requiresAuthorization = !(canAuthorizeCancel && allowDirectByCategory);
      } catch (error: any) {
        toast.error(error?.message || "No se pudo validar la politica de anulacion para este producto.");
        return;
      }
    }

    setInlineCancelVisibleItems([
        {
          id: item.id,
          description_snapshot: item.description_snapshot,
          quantity: normalizedQty,
          quantity_total: item.quantity_ordered ?? item.quantity,
          quantity_dispatched: item.quantity_dispatched ?? 0,
          quantity_remaining: item.quantity_remaining ?? 0,
          total: Math.round(normalizedQty * unitPrice * 100) / 100,
          status: item.status,
          tray_item_type: item.tray_item_type ?? null,
          modifiers: item.modifiers.map((modifier) => ({ description: modifier.description })),
          item_note: item.item_note ?? null,
        },
    ]);
    setInlineCancelQtyByItem({ [item.id]: normalizedQty });
    setInlineCancellationType("partial");
    setInlineRequiresAuthorization(requiresAuthorization);
    setInlineCancelOpen(true);
  };

  const menuPanel = canEditItems ? (
    <div className="space-y-3">
      {isTrayOrder ? (
        <div className="rounded-[24px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-4 shadow-[0_18px_42px_-30px_rgba(245,158,11,0.3)]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {([
              { value: "B", label: "Con Envase" },
              { value: "A", label: "Sin envase" },
              { value: "C", label: "A granel" },
            ] as Array<{ value: TrayItemType; label: string }>).map((option) => {
              const checked = effectiveTrayType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setPendingTrayType(option.value);
                    setSelectedProduct(null);
                  }}
                  aria-pressed={checked}
                  className={cn(
                    "flex items-center gap-2 text-sm font-semibold transition",
                    checked
                      ? "text-amber-900"
                      : "text-amber-800/90",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border transition",
                      checked
                        ? "border-amber-600"
                        : "border-amber-500/70",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full transition",
                        checked ? "bg-amber-600" : "bg-transparent",
                      )}
                    />
                  </span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>

        </div>
      ) : null}

      {order.order_type === "DINE_IN" ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground disabled:opacity-60"
            onClick={() => {
              if (interactiveMenuScope === "TABLE") return;
              setPendingMenuScopeSelection("TABLE");
              updateMenuScope.mutate("TABLE", {
                onError: () => setPendingMenuScopeSelection(null),
              });
            }}
            disabled={updateMenuScope.isPending}
            aria-pressed={interactiveMenuScope === "TABLE"}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
                interactiveMenuScope === "TABLE" ? "border-primary" : "border-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  interactiveMenuScope === "TABLE" ? "bg-primary" : "bg-transparent",
                )}
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ChefHat className="h-4 w-4" />
              Menu Mesas
            </span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground disabled:opacity-60"
            onClick={() => {
              if (interactiveMenuScope === "TAKEOUT") return;
              setPendingMenuScopeSelection("TAKEOUT");
              updateMenuScope.mutate("TAKEOUT", {
                onError: () => setPendingMenuScopeSelection(null),
              });
            }}
            disabled={updateMenuScope.isPending}
            aria-pressed={interactiveMenuScope === "TAKEOUT"}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
                interactiveMenuScope === "TAKEOUT" ? "border-primary" : "border-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  interactiveMenuScope === "TAKEOUT" ? "bg-primary" : "bg-transparent",
                )}
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShoppingBag className="h-4 w-4" />
              Con envase
            </span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground disabled:opacity-60"
            onClick={() => {
              if (interactiveMenuScope === "BULK") return;
              setPendingMenuScopeSelection("BULK");
            }}
            disabled={updateMenuScope.isPending}
            aria-pressed={interactiveMenuScope === "BULK"}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
                interactiveMenuScope === "BULK" ? "border-primary" : "border-muted-foreground/50",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  interactiveMenuScope === "BULK" ? "bg-primary" : "bg-transparent",
                )}
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Scale className="h-4 w-4" />
              A granel
            </span>
          </button>
        </div>
      ) : null}
      <MenuNavigator
        menuScope={currentMenuScope}
        trayMode={isTrayOrder && effectiveTrayType === "C"}
        onSelectProduct={handleSelectMenuProduct}
        renderNodeAction={(node) =>
          !node.is_active && node.node_type === "product" ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-700">
              Producto agotado
            </div>
          ) : null
        }
      />
    </div>
  ) : (
    <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      Modo consulta: puedes ver la orden, pero no agregar ni editar items.
    </div>
  );

  const orderPanel = (mobile: boolean) => (
    <div className={cn("flex w-full min-w-0 flex-col", mobile ? "h-full" : "h-auto")}>
      <div className="mb-3 flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="shrink-0 font-display text-sm font-bold">Orden</h2>
          <p className="truncate text-xs font-semibold text-muted-foreground">{order.order_code ?? `#${order.order_number}`}</p>
        </div>
        {mobile ? (
          <Button variant="ghost" size="sm" className="h-11 px-3 gap-2 text-sm 2xl:hidden" onClick={() => setShowCart(false)}>
            <Menu className="h-4 w-4" />
            Ver menu
          </Button>
        ) : null}
      </div>

      <div className={cn("min-h-0", mobile && "flex-1")}>
        {order.is_special && (
          <div className="mb-4 rounded-[24px] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 shadow-[0_18px_42px_-30px_rgba(249,115,22,0.35)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-black text-foreground">Orden Especial</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  El total manual manda en caja, pero el total real de los items sigue visible como referencia.
                </p>
              </div>
              <Badge variant="outline" className="border-orange-300 bg-white/90 text-orange-800">
                Cobro manual
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Total real</p>
                <p className="mt-1 font-display text-2xl font-black text-sky-900">${total.toFixed(2)}</p>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Total especial</p>
                <p className="mt-1 font-display text-2xl font-black text-orange-900">
                  {specialTotalManual == null ? "--" : `$${specialTotalManual.toFixed(2)}`}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Diferencia</p>
                <p className="mt-1 font-display text-2xl font-black text-amber-900">
                  {specialDifference == null ? "--" : `$${specialDifference.toFixed(2)}`}
                </p>
              </div>
            </div>

            {canEditItems ? (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  inputMode="decimal"
                  value={specialTotalInput}
                  onChange={(event) => setSpecialTotalInput(event.target.value)}
                  placeholder="Ingresa el total manual"
                  className="h-11 rounded-xl"
                />
                <Button
                  type="button"
                  className="h-11 rounded-xl"
                  disabled={updateSpecialTotal.isPending}
                  onClick={handleSaveSpecialTotal}
                >
                  {updateSpecialTotal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar total especial"}
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-white/70 px-3 py-2 text-xs text-muted-foreground">
                Solo consulta: el total especial se administra desde una sesion con permisos operativos.
              </div>
            )}
          </div>
        )}

        <OrderItemsList
          items={order.items}
          onRemove={(id) => removeItem.mutate(id)}
          onUpdateQty={(id, qty, price) => updateQuantity.mutate({ itemId: id, quantity: qty, unit_price: price })}
          onRequestCancel={handleRequestInlineCancel}
          disableDraftEditing={!canEditItems}
          disableOperationalCancel={order.status === "PAID"}
        />
      </div>

      {canOperateOrders && hasDraftItems && order.status !== "PAID" && order.status !== "CANCELLED" && (
        <Button
          onClick={() => {
            sendToKitchen.mutate(undefined, {
              onSuccess: () => {
                if (isTakeout) {
                  printReceipt();
                  setTimeout(() => navigate("/mesas"), 500);
                }
              },
            });
          }}
          disabled={sendToKitchen.isPending}
          className="mt-4 h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
        >
          {sendToKitchen.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : hasSentItems ? (
            <>
              <ChefHat className="h-5 w-5" />
              Enviar nuevos items - ${total.toFixed(2)}
            </>
          ) : isTakeout ? (
            <>
              <CircleDollarSign className="h-5 w-5" />
              Enviar a caja - ${total.toFixed(2)}
            </>
          ) : (
            <>
              <ChefHat className="h-5 w-5" />
              Enviar a cocina - ${total.toFixed(2)}
            </>
          )}
        </Button>
      )}

      {!canOperateOrders && (
        <div className="mt-4 rounded-xl bg-muted p-3 text-center text-xs text-muted-foreground">
          Modo consulta: sin acciones operativas sobre la orden.
        </div>
      )}

      {isSent && (
        <div className="mt-4 rounded-xl bg-primary/10 p-3 text-center">
          <p className="text-sm font-medium text-primary">Orden en cocina</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Esperando despacho</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="ordenes-mobile-touch flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start gap-1 border-b border-border bg-card/50 px-3 py-3 sm:px-4">
        <div className="min-w-0 w-full space-y-2">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0 flex flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={handleMobileBackToMesas}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Volver a Mesas"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {order.is_tray_order ? (
                  <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-amber-800 dark:text-amber-400">
                    <ShoppingBag className="h-4 w-4" />
                    Para Llevar
                  </div>
                ) : order.is_special ? (
                  <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-orange-800 dark:text-orange-400">
                    <Sparkles className="h-4 w-4" />
                    Orden Especial
                  </div>
                ) : order.table_name ? (
                  <div className="shrink-0 whitespace-nowrap text-sm font-extrabold text-sky-800 dark:text-sky-400">
                    {order.table_name}
                  </div>
                ) : isTakeout ? (
                  <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-emerald-800 dark:text-emerald-400">
                    <ShoppingBag className="h-4 w-4" />
                    Para llevar
                  </div>
                ) : null}
                {!canOperateOrders && (
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    Solo consulta
                  </span>
                )}
                {hasSiblings &&
                  order.siblings.map((sib) => (
                    <Button
                      key={sib.id}
                      variant={sib.id === order.id ? "default" : "outline"}
                      size="sm"
                      className="h-8 shrink-0 gap-1 rounded-lg px-2.5 text-[11px]"
                      onClick={() => navigate(`/ordenes?order=${sib.id}${fromMesas ? "&from=mesas" : ""}`, { replace: true })}
                    >
                      {formatSplitCodeLabel(sib.split_code)}
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {sib.item_count}
                      </Badge>
                    </Button>
                  ))}
            </div>

            {order.table_id && (
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <Button
                  variant={canSplit ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-9 w-9 shrink-0 rounded-lg p-0 2xl:h-7 2xl:w-7",
                    canSplit
                      ? "shadow-[0_14px_28px_-18px_rgba(249,115,22,0.8)]"
                      : "text-muted-foreground",
                  )}
                  onClick={handleSplit}
                  disabled={!canSplit || splitting}
                  title={
                    !canOperateOrders
                      ? "No tienes permiso para dividir mesas"
                      : order.items.length <= 0
                        ? "La mesa debe tener al menos un item para dividirse"
                        : !allExistingSplitsHaveItems
                          ? "Todas las divisiones existentes deben tener al menos un item"
                          : !canSplit
                            ? "La mesa debe seguir activa para dividirse"
                            : undefined
                  }
                >
                  {splitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Split className="h-3.5 w-3.5" />}
                </Button>

                {hasSiblings && (
                  <Button
                    variant={canDeleteSplit ? "destructive" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-9 w-9 shrink-0 rounded-lg p-0 2xl:h-7 2xl:w-7",
                      !canDeleteSplit && "text-muted-foreground",
                    )}
                    onClick={() => setShowDeleteSplitConfirm(true)}
                    disabled={!canDeleteSplit || removingSplit}
                    title={
                      !canDeleteSplit
                        ? "Solo puedes eliminar la division si no ha sido despachada, pagada o cancelada"
                        : "Eliminar esta division"
                    }
                  >
                    {removingSplit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {canShowConvertToSpecial && (
              <Button
                variant="outline"
                size="sm"
                className="h-11 shrink-0 gap-1 rounded-lg px-3 text-xs 2xl:h-7"
                onClick={() => {
                  setConvertSpecialTotalInput(total.toFixed(2));
                  setConvertSpecialDialogOpen(true);
                }}
                disabled={!canConvertToSpecial}
                title={!canConvertToSpecial ? "La orden debe tener al menos un item" : "Convertir en orden especial"}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Convertir Ord. Espec.
              </Button>
            )}
            {order.table_id && (
              <>
                <Button
                  variant={canChangeTable ? "outline" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-11 shrink-0 gap-1 rounded-lg px-3 text-xs 2xl:h-7",
                    !canChangeTable && "text-muted-foreground",
                  )}
                  onClick={() => setShowChangeTableDialog(true)}
                  disabled={!canChangeTable || moveToTable.isPending}
                  title={
                    !canChangeTable
                      ? hasOrderItems
                        ? "Solo puedes cambiar de mesa ordenes DINE_IN activas"
                        : "La orden debe tener al menos un item"
                      : "Cambiar esta orden de mesa"
                  }
                >
                  {moveToTable.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                  Cambiar mesa
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="relative ml-auto h-11 min-w-[52px] shrink-0 rounded-xl px-3 2xl:hidden"
                  onClick={() => setShowCart(!showCart)}
                >
                  <ShoppingBag className="h-4 w-4" />
                  {itemCount > 0 && (
                    <span className="absolute right-1 top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                      {itemCount}
                    </span>
                  )}
                </Button>

              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 overflow-hidden 2xl:hidden">
        <div className={cn("flex-1 overflow-y-auto p-3 pb-24", showCart && "hidden")}>
          {menuPanel}
        </div>

        <div className={cn("flex w-full flex-col overflow-y-auto border-border p-3 pb-24", !showCart && "hidden")}>
          {orderPanel(true)}
        </div>
      </div>

      <div className="relative z-10 hidden flex-1 overflow-hidden p-4 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_520px] 2xl:gap-4">
        <div className="min-w-0 overflow-y-auto">
          {menuPanel}
        </div>
        <div className="min-w-0 overflow-y-auto">
          <div className="w-full rounded-[28px] border border-orange-200/80 bg-white/88 p-5 shadow-[0_24px_60px_-40px_rgba(249,115,22,0.25)] backdrop-blur-sm">
            <div className="w-full">
              {orderPanel(false)}
            </div>
          </div>
        </div>
      </div>

      {!showCart && itemCount > 0 && (
        <button onClick={() => setShowCart(true)} className="fixed bottom-24 left-3 right-3 z-30 flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-transform active:scale-95 2xl:hidden">
          <ShoppingBag className="h-5 w-5" />
          <span className="font-display text-sm font-bold">{itemCount} items - ${total.toFixed(2)}</span>
        </button>
      )}

      <AddItemDialog
        product={canEditItems ? selectedProduct : null}
        modifiers={
          selectedProduct
            ? (
              !isTrayOrder || effectiveTrayType !== "A"
                ? menu.modifiers.filter((mod: any) => mod.node_id === selectedProduct.menu_node_id)
                : []
            )
            : []
        }
        open={canEditItems && !!selectedProduct}
        onClose={() => {
          setSelectedProduct(null);
        }}
        priceModeOverride={isTrayOrder ? (effectiveTrayType === "C" ? "MANUAL" : "FIXED") : undefined}
        manualPriceLabel={isTrayOrder && effectiveTrayType === "C" ? "Precio manual" : "Precio"}
        confirmLabel={isTrayOrder ? "Agregar item bandeja" : "Agregar"}
        hideQuantity={isBulkScopeSelection}
        extraContent={({ unitPrice, quantity }) => {
          if (!isBulkScopeSelection) return null;

          const previewRows = resolveBulkIncludedPreview(unitPrice, quantity);
          if (previewRows.length === 0) {
            return (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                No hay productos adicionales a entregar para este monto.
              </div>
            );
          }

          return (
            <div className="space-y-2 rounded-2xl border border-orange-200 bg-orange-50/70 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                Productos adicionales a entregar
              </div>
              <div className="space-y-1.5">
                {previewRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{row.included_node_name}</span>
                    <Badge className="rounded-lg bg-orange-500 text-white hover:bg-orange-500">
                      x{row.matched_quantity}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          );
        }}
        buildItemNote={({ unitPrice, quantity }) => (
          isBulkScopeSelection ? buildBulkIncludedItemNote(unitPrice, quantity) : null
        )}
        onConfirm={(data) => {
          addItem.mutate({
            ...data,
            modifier_ids: isTrayOrder && effectiveTrayType === "A" ? [] : data.modifier_ids,
            tray_item_type: isTrayOrder ? effectiveTrayType : undefined,
            tray_container_cost: 0,
          }, {
            onSuccess: () => {
              setSelectedProduct(null);
            },
          });
        }}
        adding={addItem.isPending}
      />

      {order && (
        <ThermalReceipt
          ref={receiptRef}
          orderNumber={order.order_code ?? `#${order.order_number}`}
          orderType={order.order_type}
          isSpecial={order.is_special}
          isTrayOrder={order.is_tray_order}
          tableName={order.table_name}
          items={order.items}
          total={total}
          createdAt={order.created_at}
        />
      )}

      <AlertDialog open={showDeleteSplitConfirm} onOpenChange={setShowDeleteSplitConfirm}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar division</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara la division seleccionada y su orden asociada. Esta accion solo debe hacerse si esa division aun no ha sido despachada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingSplit}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSplit} disabled={removingSplit || !canDeleteSplit}>
              {removingSplit ? "Eliminando..." : "Eliminar division"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ChangeTableDialog
        open={showChangeTableDialog}
        onOpenChange={setShowChangeTableDialog}
        currentTableId={order.table_id}
        currentTableName={order.table_name}
        currentSplitCode={order.split_code}
        tables={tablesQuery.data}
        moving={moveToTable.isPending}
        onConfirm={handleChangeTable}
      />

      <Dialog open={convertSpecialDialogOpen} onOpenChange={setConvertSpecialDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-black text-foreground">Convertir en orden especial</DialogTitle>
            <DialogDescription>
              La mesa se liberara y esta cuenta pasara a cobrarse con un total manual. El total real de items seguira visible como referencia.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Origen</p>
                <p className="mt-1 font-display text-lg font-black text-sky-900">{orderOriginLabel}</p>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Total real actual</p>
                <p className="mt-1 font-display text-lg font-black text-orange-900">${total.toFixed(2)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Total especial manual</label>
              <Input
                inputMode="decimal"
                value={convertSpecialTotalInput}
                onChange={(event) => setConvertSpecialTotalInput(event.target.value)}
                placeholder="Ingresa el total a cobrar"
                className="h-11 rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                Puedes usar el total real como base y luego ajustarlo si el cliente deja una parte pendiente o se acuerda un cobro distinto.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConvertSpecialDialogOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleConvertToSpecial} disabled={convertToSpecial.isPending}>
              {convertToSpecial.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Convertir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {user && canCancelOrders && (
        <CancelOrderDialog
          orderId={order.id}
          orderNumber={order.order_number}
          userId={user.id}
          open={inlineCancelOpen}
          onOpenChange={(open) => {
            setInlineCancelOpen(open);
            if (!open) {
              setInlineCancelVisibleItems([]);
              setInlineCancelQtyByItem({});
              setInlineCancellationType("partial");
              setInlineRequiresAuthorization(false);
            }
          }}
          canAuthorizeCancel={canAuthorizeCancel}
          isCancelRequested={!!order.cancel_requested_at}
          visibleItems={inlineCancelVisibleItems}
          initialCancellationType={inlineCancellationType}
          initialCancelQtyByItem={inlineCancelQtyByItem}
          compactPresetMode={true}
          requiresAuthorizationOverride={inlineRequiresAuthorization}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          .ordenes-mobile-touch button,
          .ordenes-mobile-touch [role="button"] {
            min-height: 44px;
          }

          .ordenes-mobile-touch input,
          .ordenes-mobile-touch select {
            min-height: 44px;
            font-size: 16px;
          }
        }

        @media print {
          body * { visibility: hidden !important; }
          .print\\:block, .print\\:block * { visibility: visible !important; }
          .print\\:block { position: absolute; left: 0; top: 0; }
        }
      `}</style>
    </div>
  );
};

export default Ordenes;


