import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { fetchOrderDetail, fetchSiblingOrders, getOrderQueryKey, isTemporaryOrderItemId, useOrder, type SiblingOrder } from "@/hooks/useOrder";
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
import MergeSplitOrdersDialog from "@/components/order/MergeSplitOrdersDialog";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, ChefHat, ShoppingBag, CircleDollarSign, BookOpenText, MoreVertical, ArrowRightLeft, Sparkles, ChevronLeft, Scale, Ban, SquarePlus, X, UserRound } from "lucide-react";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { OrderSummary, type OrderItemSummary } from "@/hooks/useOrdersByStatus";
import { canManage, canOperate } from "@/lib/permissions";
import { fetchMenuTreeNodes, type MenuNode, type MenuScope } from "@/hooks/useMenuTree";
import { useCancellation } from "@/hooks/useCancellation";
import { getOrderOriginLabel, getOrderRef } from "@/lib/orderPresentation";
import type { TrayItemType } from "@/hooks/useTrayOrder";
import { dbSelect } from "@/services/DatabaseService";

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

interface ProductModifierOption {
  id: string;
  description: string;
}

interface TakeoutCajaPreview {
  orderLabel: string;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
    modifiers: string[];
    note: string | null;
  }>;
  total: number;
}

interface MenuProductLookupResult {
  product: SelectedProduct;
  modifiers: ProductModifierOption[];
}

const sortMenuNodes = (nodes: MenuNode[]) =>
  [...nodes].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });

function buildCompositeMenuNodes(scopeNodes: MenuNode[], tableNodes: MenuNode[]) {
  const scopeRootNodes = sortMenuNodes(
    scopeNodes.filter((node) => node.parent_id === null && node.node_type === "category"),
  );
  const tableRootNodes = sortMenuNodes(
    tableNodes.filter((node) => node.parent_id === null && node.node_type === "category"),
  );

  const tableRootsToAppend = tableRootNodes.slice(1);
  if (tableRootsToAppend.length === 0) {
    return scopeNodes;
  }

  const allowedRootIds = new Set(tableRootsToAppend.map((node) => node.id));
  const tableNodesById = new Map(tableNodes.map((node) => [node.id, node]));
  const includedTableNodes = tableNodes.filter((node) => {
    if (allowedRootIds.has(node.id)) return true;

    let currentParentId = node.parent_id;
    while (currentParentId) {
      if (allowedRootIds.has(currentParentId)) return true;
      currentParentId = tableNodesById.get(currentParentId)?.parent_id ?? null;
    }

    return false;
  });

  const nextRootDisplayOrder = scopeRootNodes.reduce(
    (maxValue, node) => Math.max(maxValue, Number(node.display_order ?? 0)),
    0,
  );
  const appendedRootDisplayOrder = new Map(
    tableRootsToAppend.map((node, index) => [node.id, nextRootDisplayOrder + index + 1]),
  );

  const normalizedTableNodes = includedTableNodes.map((node) => ({
    ...node,
    display_order:
      node.parent_id === null
        ? (appendedRootDisplayOrder.get(node.id) ?? node.display_order)
        : node.display_order,
  }));

  return [...scopeNodes, ...normalizedTableNodes];
}

/**
 * Diagnostico de rendimiento (2026-03-30)
 * - Medicion directa disponible desde este entorno: RTT base al endpoint REST de Supabase ~777ms.
 * - Ruta lenta original al abrir una mesa: `orders` -> `restaurant_tables` -> `table_splits` -> `order_items`
 *   -> `get_order_operational_snapshot` -> el mismo snapshot otra vez via `fetchOperationalMapsForOrders`
 *   -> `order_item_modifiers` -> siblings/splits; en paralelo la pantalla quedaba bloqueada esperando `useMenuData`
 *   (categorias, subcategorias, productos y modificadores completos).
 * - Con ese encadenamiento, la primera apertura acumulaba varios round-trips antes de pintar la orden.
 */

async function fetchMenuProductLookup(params: {
  branchId: string;
  node: MenuNode;
  isTrayOrder: boolean;
  trayType: TrayItemType;
}): Promise<MenuProductLookupResult> {
  const candidateProductIds = Array.from(new Set(
    (
      params.node.menu_scope === "TABLE"
        ? [params.node.id, params.node.legacy_product_id]
        : [params.node.legacy_product_id, params.node.id]
    ).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  ));

  if (candidateProductIds.length === 0) {
    throw new Error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
  }

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id, description, subcategory_id, unit_price, price_mode")
    .in("id", candidateProductIds);

  if (productError) {
    throw new Error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
  }

  const productRowsById = new Map(
    ((productRows ?? []) as Array<{
      id: string;
      description: string | null;
      subcategory_id: string;
      unit_price: number | null;
      price_mode: "FIXED" | "MANUAL";
    }>).map((row) => [row.id, row]),
  );
  const productRow = candidateProductIds
    .map((productId) => productRowsById.get(productId))
    .find((row): row is NonNullable<typeof row> => Boolean(row));

  if (!productRow) {
    throw new Error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
  }

  const priceMode =
    params.isTrayOrder
      ? (params.trayType === "C" ? "MANUAL" : "FIXED")
      : params.node.manual_price_inherited
        ? "MANUAL"
        : productRow.price_mode;

  const resolvedDescription = params.node.name.trim() || productRow.description || "Producto";
  const resolvedUnitPrice =
    params.node.price == null
      ? (productRow.unit_price == null ? null : Number(productRow.unit_price))
      : Number(params.node.price);

  const modifierNodeIds = [params.node.id, ...(params.node.ancestor_ids ?? [])];
  const { data: links, error: linksError } = await supabase
    .from("menu_node_modifiers" as any)
    .select("node_id, modifier_id, display_order, is_active")
    .in("node_id", modifierNodeIds)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (linksError) throw linksError;

  const modifierLinks = (links ?? []) as Array<{
    node_id: string;
    modifier_id: string;
    display_order?: number | null;
  }>;
  const modifierIdSet = new Set<string>(modifierLinks.map((link) => link.modifier_id).filter(Boolean));
  const modifierIds = Array.from(modifierIdSet);

  let modifiers: ProductModifierOption[] = [];
  if (modifierIds.length > 0) {
    const modifierRows = await dbSelect<{ id: string; description: string }>("modifiers", {
      select: "id, description",
      branchId: params.branchId,
      filters: [
        { column: "is_active", op: "eq", value: true },
        { column: "id", op: "in", value: modifierIds },
      ],
      orderBy: { column: "description" },
    });

    const modifiersById = new Map(modifierRows.map((modifier) => [modifier.id, modifier]));
    const linksByNode = new Map<string, typeof modifierLinks>();
    for (const link of modifierLinks) {
      const bucket = linksByNode.get(link.node_id) ?? [];
      bucket.push(link);
      linksByNode.set(link.node_id, bucket);
    }

    const seenModifierIds = new Set<string>();
    modifiers = modifierNodeIds.flatMap((nodeId) => {
      const nodeLinks = linksByNode.get(nodeId) ?? [];
      return nodeLinks.flatMap((link) => {
        if (seenModifierIds.has(link.modifier_id)) return [];
        const modifier = modifiersById.get(link.modifier_id);
        if (!modifier) return [];
        seenModifierIds.add(link.modifier_id);
        return [{ id: modifier.id, description: modifier.description }];
      });
    });
  }

  return {
    product: {
      id: productRow.id,
      menu_node_id: params.node.id,
      description: resolvedDescription,
      subcategory_id: productRow.subcategory_id,
      unit_price: resolvedUnitPrice,
      price_mode: priceMode,
      icon: params.node.icon ?? null,
      image_url: params.node.image_url ?? null,
    },
    modifiers,
  };
}

function OrdenesSkeleton() {
  return (
    <div className="ordenes-mobile-touch flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-card/50 px-3 py-3 sm:px-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
          <Skeleton className="h-4 w-40 rounded-full" />
        </div>
      </div>

      <div className="grid flex-1 gap-4 px-3 py-4 2xl:grid-cols-[1.1fr_0.9fr] 2xl:px-4">
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-[24px]" />
          <Skeleton className="h-16 rounded-[24px]" />
          <Skeleton className="h-16 rounded-[24px]" />
          <Skeleton className="h-16 rounded-[24px]" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-12 rounded-[20px]" />
          <Skeleton className="h-[32rem] rounded-[28px]" />
        </div>
      </div>
    </div>
  );
}

const seedDraftTableOrderCache = (
  qc: ReturnType<typeof useQueryClient>,
  orderId: string,
  source: {
    branchId: string;
    tableId: string;
    tableName?: string;
    createdAt: string;
    tableOrderPosition: number;
    siblings: Array<{
      id: string;
      order_number: number | null;
      order_code: string | null;
      split_code: string | null;
      table_order_position: number | null;
      item_count: number;
    }>;
  },
) => {
  qc.setQueryData(getOrderQueryKey(orderId), {
    id: orderId,
    order_number: null,
    order_code: null,
    status: "DRAFT",
    order_type: "DINE_IN",
    menu_scope: "TABLE",
    is_special: false,
    special_total_manual: null,
    branch_id: source.branchId,
    table_id: source.tableId,
    table_order_position: source.tableOrderPosition,
    split_id: null,
    split_code: null,
    table_name: source.tableName,
    created_at: source.createdAt,
    items: [],
    siblings: source.siblings,
  });
};

const Ordenes = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, branches, permissions, setActiveBranch, isGlobalAdmin } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const qc = useQueryClient();
  const orderId = searchParams.get("order");
  const fromMesas = searchParams.get("from") === "mesas";
  const [pendingTrayType, setPendingTrayType] = useState<TrayItemType | null>(null);
  const effectiveTrayType: TrayItemType = pendingTrayType ?? "B";
  const [pendingMenuScopeSelection, setPendingMenuScopeSelection] = useState<MenuScope | null>(null);

  const { order, isLoading, addItem, removeItem, updateQuantity, sendToKitchen, moveToTable, createTableOrder, deleteTableOrder, updateMenuScope, updateSpecialTotal, convertToSpecial, closeOrder, lockOrder, unlockOrder } = useOrder(orderId);
  const { cancelOrderMutation } = useCancellation();
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
  const tablesQuery = useTablesWithStatus();
  const tables = tablesQuery.data?.tables;
  const scopeCompositeMenuQuery = useQuery({
    queryKey: ["scope-composite-menu-tree", activeBranchId, currentMenuScope],
    queryFn: async () => {
      const [scopeNodes, tableNodes] = await Promise.all([
        fetchMenuTreeNodes({ branchId: activeBranchId!, menuScope: currentMenuScope }),
        fetchMenuTreeNodes({ branchId: activeBranchId!, menuScope: "TABLE" }),
      ]);

      return buildCompositeMenuNodes(scopeNodes, tableNodes);
    },
    enabled: !!activeBranchId && (currentMenuScope === "TAKEOUT" || currentMenuScope === "BULK"),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [selectedProductModifiers, setSelectedProductModifiers] = useState<ProductModifierOption[]>([]);
  const [selectingProductId, setSelectingProductId] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [removingSplit, setRemovingSplit] = useState(false);
  const [redirectingAfterDelete, setRedirectingAfterDelete] = useState(false);
  const [showDeleteSplitConfirm, setShowDeleteSplitConfirm] = useState(false);
  const [showCloseOrderConfirm, setShowCloseOrderConfirm] = useState(false);
  const [showChangeTableDialog, setShowChangeTableDialog] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<OrderSummary | null>(null);
  const [mergeSplitOpen, setMergeSplitOpen] = useState(false);
  const [inlineCancelOpen, setInlineCancelOpen] = useState(false);
  const [inlineCancelVisibleItems, setInlineCancelVisibleItems] = useState<OrderItemSummary[]>([]);
  const [inlineCancelQtyByItem, setInlineCancelQtyByItem] = useState<Record<string, number>>({});
  const [inlineCancellationType, setInlineCancellationType] = useState<"partial" | "total">("partial");
  const [specialTotalInput, setSpecialTotalInput] = useState("");
  const [convertSpecialDialogOpen, setConvertSpecialDialogOpen] = useState(false);
  const [convertSpecialTotalInput, setConvertSpecialTotalInput] = useState("");
  const [takeoutCajaPreview, setTakeoutCajaPreview] = useState<TakeoutCajaPreview | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const syncedOrderBranchRef = useRef<string | null>(null);
  const isBulkScopeSelection = currentMenuScope === "BULK";

  const currentTableOrder: SiblingOrder | null = order
    ? {
        id: order.id,
        order_number: order.order_number,
        order_code: order.order_code,
        split_code: order.split_code ?? null,
        table_order_position: order.table_order_position ?? 1,
        item_count: order.items.length,
      }
    : null;

  const [fromEditarLocked, setFromEditarLocked] = useState(false);
  const [stagedItems, setStagedItems] = useState(order?.items ?? []);
  const [stagedDirty, setStagedDirty] = useState(false);
  const [stagedCancellationData, setStagedCancellationData] = useState<{ reason: string; notes: string } | null>(null);

  useEffect(() => {
    if (order && !stagedDirty) {
      setStagedItems(order.items);
    }
  }, [order?.items, stagedDirty]);

  const tableOrdersQuery = useQuery({
    queryKey: ["table-orders", order?.table_id ?? null],
    queryFn: () => fetchSiblingOrders(order!.table_id!),
    enabled: !!order?.table_id,
    staleTime: 0,
    refetchOnMount: "always",
    gcTime: 2 * 60_000,
    placeholderData: currentTableOrder ? [currentTableOrder] : undefined,
  });

  const canManageOrders = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");
  // Operar en Ã³rdenes: permiso explÃ­cito del mÃ³dulo, flags del turno, o administraciÃ³n global/sucursal.
  // Sin esto, un superadmin con `permissions` vacÃ­o en el RPC veÃ­a solo modo consulta aunque tuviera acceso total.
  const canOperateOrders =
    isGlobalAdmin
    || canManageOrders
    || canOperate(permissions, "ordenes")
    || canOperate(permissions, "mesas")
    || Boolean(shiftGateQuery.data?.canServeTables)
    || Boolean(shiftGateQuery.data?.canAccessOrders)
    || Boolean(shiftGateQuery.data?.isSupervisor);
  const canCancelOrders = canOperateOrders || canManageOrders;
  const hasDirectCancelRole =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global")
    || Boolean(shiftGateQuery.data?.isSupervisor);
  const canAuthorizeCancel =
    hasDirectCancelRole
    || Boolean(shiftGateQuery.data?.canAuthorizeOrderCancel);
  const isTrayOrder = Boolean(order?.is_tray_order);
  const canUseEditarOrden =
    isGlobalAdmin
    || canManageOrders
    || Boolean(shiftGateQuery.data?.canEditOrders)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  useEffect(() => {
    setRedirectingAfterDelete(false);
  }, [orderId]);

  const fromEditar = searchParams.get("from") === "editar" && canUseEditarOrden;

  useEffect(() => {
    if (fromEditar && order && (order.status === "PAID" || order.status === "CANCELLED")) {
      navigate("/editar-orden", { replace: true });
    }
  }, [fromEditar, order?.status, navigate]);

  useEffect(() => {
    if (fromEditar && order?.id && !order.locked_for_editing && !fromEditarLocked) {
      lockOrder.mutate();
      setFromEditarLocked(true);
    }
  }, [fromEditar, order?.id, order?.locked_for_editing, fromEditarLocked, lockOrder]);

  useEffect(() => {
    if (!orderId || isLoading || shiftGateQuery.isLoading) return;
    if (order || redirectingAfterDelete || removingSplit) return;

    navigate(fromEditar ? "/editar-orden" : "/mesas", { replace: true });
  }, [fromEditar, isLoading, navigate, order, orderId, redirectingAfterDelete, removingSplit, shiftGateQuery.isLoading]);

  useEffect(() => {
    return () => {
      if (fromEditar && orderId) {
        // Unlock on unmount
        supabase.from("orders").update({ locked_for_editing: false }).eq("id", orderId).then(() => {});
      }
    };
  }, [fromEditar, orderId]);

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
    // Cuando cambiamos de orden fisica, limpiamos cualquier seleccion pendiente
    // para que tome el valor de la nueva orden desde la DB.
    setPendingMenuScopeSelection(null);
    setPendingTrayType(null);
    setSelectedProduct(null);
    setSelectedProductModifiers([]);
    setSelectingProductId(null);
    setShowCart(false);
  }, [orderId]);

  const isTakeout = order?.order_type === "TAKEOUT";
  const sendsDraftItemsToCaja = true;
  const interactiveMenuScope =
    !isTrayOrder && pendingMenuScopeSelection
      ? pendingMenuScopeSelection
      : currentMenuScope;

  const buildTakeoutCajaPreview = useCallback((sourceOrder = order): TakeoutCajaPreview | null => {
    if (!sourceOrder) return null;

    const visibleItems = sourceOrder.items
      .filter((item) => Number(item.quantity ?? 0) > 0)
      .map((item) => ({
        id: item.id,
        description: item.description_snapshot || "Item sin nombre",
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unit_price ?? 0),
        total: Number(item.total ?? 0),
        modifiers: (item.modifiers ?? [])
          .map((modifier) => String(modifier.description ?? "").trim())
          .filter(Boolean),
        note: String(item.item_note ?? "").trim() || null,
      }));

    return {
      orderLabel: getOrderRef(sourceOrder.order_code, sourceOrder.order_number),
      items: visibleItems,
      total: visibleItems.reduce((sum, item) => sum + item.total, 0),
    };
  }, [order]);

  const handleMobileBackToMesas = useCallback(() => {
    if (fromMesas) {
      navigate("/mesas", { replace: true });
      return;
    }
    
    if (fromEditar) {
      navigate("/editar-orden", { replace: true });
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
  }, [fromEditar, fromMesas, navigate, order?.is_tray_order, order?.order_type, order?.table_id]);

  const bulkIncludedPreviewQuery = useQuery({
    queryKey: ["bulk-included-preview", activeBranchId, selectedProduct?.menu_node_id],
    queryFn: async () => {
      if (!activeBranchId || !selectedProduct?.menu_node_id || !isBulkScopeSelection) return [] as BulkIncludedPreviewAssignment[];

      const { data: assignments, error: assignmentsError } = await supabase
        .from("bulk_included_products" as any)
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
        .from("menu_nodes" as any)
        .select("id, name")
        .in("id", includedNodeIds);
      if (includedNodesError) throw includedNodesError;

      const { data: ranges, error: rangesError } = await supabase
        .from("bulk_included_product_ranges" as any)
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
          <OrdersList
            onCancelOrder={canCancelOrders ? setCancelOrder : undefined}
            onOpenMergeSplitTool={canOperateOrders ? () => setMergeSplitOpen(true) : undefined}
            readOnly={!canOperateOrders}
          />
        </div>
        {cancelOrder && user && canCancelOrders && (
        <CancelOrderDialog
          orderId={cancelOrder.id}
          orderNumber={getOrderRef(cancelOrder.order_code, cancelOrder.order_number)}
          userId={user.id}
          open={!!cancelOrder}
          onOpenChange={(open) => !open && setCancelOrder(null)}
          canAuthorizeCancel={canAuthorizeCancel}
          isCancelRequested={!!cancelOrder.cancel_requested_at}
          visibleItems={cancelOrder.items}
        />
      )}
      <MergeSplitOrdersDialog
        open={mergeSplitOpen}
        onOpenChange={setMergeSplitOpen}
        initialSourceOrderId={undefined}
        initialSourceOption={undefined}
      />
      </div>
    );
  }

  if (isLoading || shiftGateQuery.isLoading) {
    return <OrdenesSkeleton />;
  }

  if (!order) {
    return <OrdenesSkeleton />;
  }

  const itemsToUse = fromEditar ? stagedItems : order.items;
  const itemCount = itemsToUse.reduce((s, i) => s + i.quantity, 0);
  const getTableOrderButtonLabel = (tableOrder: { order_number: number | null; table_order_position: number | null }) => {
    const orderNumber = Number(tableOrder.order_number ?? 0);
    if (orderNumber > 0) {
      return String(orderNumber).padStart(4, "0").slice(-4);
    }
    return `Orden ${Number(tableOrder.table_order_position ?? 1)}`;
  };

  const total = itemsToUse.reduce((s, i) => s + i.total, 0);
  const draftItemsTotal = itemsToUse
    .filter((item) => item.status === "DRAFT")
    .reduce((sum, item) => sum + item.total, 0);
  const specialTotalManual = order.special_total_manual == null ? null : Number(order.special_total_manual);
  const specialDifference = specialTotalManual == null ? null : Math.round((specialTotalManual - total) * 100) / 100;
  const hasDraftItems = itemsToUse.some((i) => i.status === "DRAFT");
  const hasTemporaryDraftItems = itemsToUse.some((i) => i.status === "DRAFT" && isTemporaryOrderItemId(i.id));
  const hasPendingCancellationItems = itemsToUse.some((item) =>
    item.status === "PENDING_CANCELLATION" ||
    item.status === "ITEM_PENDING_CANCELLATION" ||
    Math.max(0, Number((item as any).quantity_requested ?? 0)) > 0,
  );
  const hasSentItems = itemsToUse.some((i) => i.status !== "DRAFT");
  const isSent = order.status === "SENT_TO_KITCHEN";
  const tableOrders = tableOrdersQuery.data?.length
    ? tableOrdersQuery.data
    : currentTableOrder
      ? [currentTableOrder]
      : [];
  const mergedTableOrders = currentTableOrder
    ? tableOrders
        .map((tableOrder) => (tableOrder.id === currentTableOrder.id ? currentTableOrder : tableOrder))
        .sort((left, right) => {
          const leftPos = Number(left.table_order_position ?? Number.MAX_SAFE_INTEGER);
          const rightPos = Number(right.table_order_position ?? Number.MAX_SAFE_INTEGER);

          if (leftPos !== rightPos) {
            return leftPos - rightPos;
          }

          return Number(left.order_number ?? 0) - Number(right.order_number ?? 0);
        })
    : tableOrders;
  const hasSiblings = mergedTableOrders.length > 1;
  const hasOrderItems = itemsToUse.length > 0;
  const allExistingTableOrdersHaveItems = mergedTableOrders.every((sibling) => sibling.item_count > 0);


  const sourceParams = fromMesas ? "&from=mesas" : fromEditar ? "&from=editar" : "";
  
  // Lock para Editar Orden: solo permite entrar si ya existe AL MENOS un item despachado (desde cocina)
  // o si el estado general de la orden ya es KITCHEN_DISPATCHED.
  const hasDispatchedItemsInOriginal = order.items.some((item) => Number(item.quantity_dispatched ?? 0) > 0 || item.status === "DISPATCHED");
  const isLockedFromEditar = fromEditar && !hasDispatchedItemsInOriginal && order.status !== "KITCHEN_DISPATCHED" && order.status !== "PAID" && order.status !== "CANCELLED";

  const hasDispatchedItems = itemsToUse.some((item) => Number(item.quantity_dispatched ?? 0) > 0 || item.status === "DISPATCHED");
  const hasVoidableItemsInEditar = itemsToUse.some((item) => {
    if (item.status === "ITEM_PENDING_CANCELLATION" || item.status === "PENDING_CANCELLATION") {
      return false;
    }

    return (
      Number(item.quantity_dispatched ?? 0) > 0 ||
      item.status === "DISPATCHED" ||
      item.status === "PAID"
    );
  });
  const canSplit =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !isLockedFromEditar &&
    order.items.length > 0 &&
    allExistingTableOrdersHaveItems;
  const canDeleteSplit =
    canOperateOrders &&
    hasSiblings &&
    !order.sent_to_kitchen_at &&
    !order.ready_at &&
    !order.dispatched_at &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !isLockedFromEditar;
  const canShowChangeTable =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !fromEditar;
  const canChangeTable = canShowChangeTable && hasOrderItems;
  const canShowCloseOrder =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    !order.is_special &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !isLockedFromEditar &&
    hasSentItems;
  const allSentItemsDispatched = itemsToUse
    .filter((item) => item.status !== "DRAFT")
    .every((item) => Number(item.quantity_remaining ?? 0) <= 0);
  const canCloseOrder = canShowCloseOrder && !hasDraftItems && !hasPendingCancellationItems && allSentItemsDispatched;
  const isClosedForPayment =
    order.order_type === "DINE_IN" &&
    !order.is_special &&
    !!order.table_id &&
    order.status === "KITCHEN_DISPATCHED";

  const canEditItems =
    (canOperateOrders || fromEditar) &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !hasPendingCancellationItems &&
    !isLockedFromEditar;
  const handleSelectMenuProduct = async (node: MenuNode) => {
    if (!activeBranchId) return;
    if (hasPendingCancellationItems) {
      toast.error("No puedes agregar items mientras exista al menos un item con anulacion pendiente.");
      return;
    }

    setSelectedProduct(null);
    setSelectedProductModifiers([]);
    setSelectingProductId(node.id);
    try {
      const lookup = await qc.fetchQuery({
        queryKey: ["menu-product-lookup", activeBranchId, currentMenuScope, node.id, isTrayOrder ? effectiveTrayType : "STANDARD"],
        queryFn: () =>
          fetchMenuProductLookup({
            branchId: activeBranchId,
            node,
            isTrayOrder,
            trayType: effectiveTrayType,
          }),
        staleTime: 60_000,
        gcTime: 10 * 60_000,
      });

      setSelectedProduct(lookup.product);
      setSelectedProductModifiers(lookup.modifiers);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo cargar el producto seleccionado.");
    } finally {
      setSelectingProductId(null);
    }
  };
  const canShowConvertToSpecial =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    !order.is_special &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !fromEditar;
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
        ? (order.table_name ?? "").trim()
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
      toast.error("La orden actual debe tener al menos un item");
      return;
    }
    if (!allExistingTableOrdersHaveItems) {
      toast.error("No puedes crear una nueva orden hasta que todas las ordenes activas de la mesa tengan al menos un item");
      return;
    }
    setSplitting(true);
    try {
      const newOrderId = await createTableOrder.mutateAsync();
      if (order.table_id) {
        qc.setQueryData(["table-orders", order.table_id], [
          ...tableOrders,
          {
            id: newOrderId,
            order_number: null,
            order_code: null,
            split_code: null,
            table_order_position: tableOrders.length + 1,
            item_count: 0,
          },
        ] satisfies SiblingOrder[]);
      }
      seedDraftTableOrderCache(qc, newOrderId, {
        branchId: order.branch_id,
        tableId: order.table_id,
        tableName: order.table_name,
        createdAt: new Date().toISOString(),
        tableOrderPosition: mergedTableOrders.length + 1,
        siblings: [
          ...mergedTableOrders,
          {
            id: newOrderId,
            order_number: null,
            order_code: null,
            split_code: null,
            table_order_position: mergedTableOrders.length + 1,
            item_count: 0,
          },
        ],
      });
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(newOrderId),
        queryFn: () => fetchOrderDetail(newOrderId),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
      navigate(`/ordenes?order=${newOrderId}${sourceParams}`, { replace: true });

      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    } catch (err: any) {
      const rawMessage = String(err?.message ?? "");

      if (rawMessage.includes("No se encontro la orden origen")) {
        try {
          const refreshedTableOrders = await fetchSiblingOrders(order.table_id);
          qc.setQueryData(["table-orders", order.table_id], refreshedTableOrders);
          qc.invalidateQueries({ queryKey: ["tables-with-status"] });
          qc.invalidateQueries({ queryKey: ["order"] });
          qc.invalidateQueries({ queryKey: ["orders"] });

          const fallbackOrderId = refreshedTableOrders[0]?.id ?? null;
          if (fallbackOrderId) {
            toast.error("La orden actual ya no estaba vigente. Te llevamos a la orden activa de la mesa.");
            navigate(`/ordenes?order=${fallbackOrderId}${sourceParams}`, { replace: true });
            return;
          }

          toast.error("La orden actual ya no estaba vigente. La mesa quedo disponible nuevamente.");
          navigate("/mesas", { replace: true });
          return;
        } catch {
          toast.error("La orden actual ya no estaba vigente. Recarga el estado de la mesa e intenta otra vez.");
          return;
        }
      }

      toast.error(err.message);
    } finally {
      setSplitting(false);
    }
  };

  const handleDeleteSplit = async () => {
    if (!canDeleteSplit) return;

    setRemovingSplit(true);
    setRedirectingAfterDelete(true);
    try {
      const remainingOrderId = await deleteTableOrder.mutateAsync();
      if (order.table_id) {
        qc.setQueryData(
          ["table-orders", order.table_id],
          tableOrders.filter((tableOrder) => tableOrder.id !== order.id) satisfies SiblingOrder[],
        );
      }
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["orders"] });

      toast.success("Orden eliminada");

      const fallbackRemainingOrderId = tableOrders.find((tableOrder) => tableOrder.id !== order.id)?.id ?? null;
      const nextOrderId = remainingOrderId || fallbackRemainingOrderId;

      if (nextOrderId) {
        await qc.fetchQuery({
          queryKey: getOrderQueryKey(nextOrderId),
          queryFn: () => fetchOrderDetail(nextOrderId),
          staleTime: 15_000,
          gcTime: 10 * 60_000,
        });
        qc.removeQueries({ queryKey: ["order", orderId] });
        navigate(`/ordenes?order=${nextOrderId}${sourceParams}`, { replace: true });
      } else {
        qc.removeQueries({ queryKey: ["order", orderId] });
        navigate("/mesas", { replace: true });
      }
    } catch (err: any) {
      setRedirectingAfterDelete(false);
      toast.error(err.message || "No se pudo eliminar la orden");
    } finally {
      setRemovingSplit(false);
      setShowDeleteSplitConfirm(false);
    }
  };

  const handleCloseOrder = () => {
    closeOrder.mutate(undefined, {
      onSuccess: () => {
        setShowCloseOrderConfirm(false);
        navigate("/mesas", { replace: true });
      },
    });
  };

  const handleAcceptEditedOrderChanges = async () => {
    try {
      const resolveMissingMenuNodeId = async (item: {
        product_id?: string;
        menu_node_id?: string | null;
        tray_item_type?: "A" | "B" | "C" | null;
      }) => {
        if (item.menu_node_id) return item.menu_node_id;
        if (!item.product_id || !order?.branch_id) return null;

        const preferredScope =
          item.tray_item_type === "C"
            ? "BULK"
            : order.order_type === "TAKEOUT"
              ? "TAKEOUT"
              : "TABLE";

        const { data, error } = await supabase
          .from("menu_nodes" as any)
          .select("id, menu_scope")
          .eq("branch_id", order.branch_id)
          .eq("node_type", "product")
          .eq("is_active", true)
          .or(`legacy_product_id.eq.${item.product_id},id.eq.${item.product_id}`)
          .order("display_order", { ascending: true });

        if (error) throw error;

        const rows = ((data ?? []) as Array<{ id: string; menu_scope?: string | null }>);
        const preferredMatch = rows.find((row) => row.menu_scope === preferredScope);
        return preferredMatch?.id ?? rows[0]?.id ?? null;
      };

      // Snapshot order.items BEFORE any mutations to prevent temp IDs injected
      // by optimistic updates from leaking into DB calls later.
      const originalOrderItems = [...order.items];
      const originalIds = new Set(originalOrderItems.map((item) => item.id));
      const stagedIds = new Set(stagedItems.map((item) => item.id));

      // Create new items and capture the generated ids so we can dispatch them immediately.
      const toAdd = stagedItems.filter((item) => !originalIds.has(item.id));
      const newAddedIds: { order_item_id: string; quantity_dispatched: number }[] = [];

      for (const item of toAdd) {
        const resolvedMenuNodeId = await resolveMissingMenuNodeId(item as {
          product_id?: string;
          menu_node_id?: string | null;
          tray_item_type?: "A" | "B" | "C" | null;
        });

        const reqData = {
          product_id: item.product_id,
          menu_node_id: resolvedMenuNodeId,
          description_snapshot: item.description_snapshot,
          item_note: item.item_note ?? null,
          unit_price: item.unit_price,
          quantity: item.quantity,
          modifier_ids: item.modifiers.map((modifier) => modifier.modifier_id).filter(Boolean) as string[],
          tray_item_type: item.tray_item_type as "A" | "B" | "C" | undefined,
          tray_container_cost: item.tray_container_cost ?? 0,
        };

        const preAddItems = await supabase.from("order_items").select("id").eq("order_id", orderId);
        await addItem.mutateAsync(reqData);

        const postAddItems = await supabase.from("order_items").select("id").eq("order_id", orderId);
        const postIds = new Set((postAddItems.data ?? []).map((row) => row.id));
        for (const previous of preAddItems.data ?? []) {
          postIds.delete(previous.id);
        }

        const newlyCreatedId = Array.from(postIds)[0];
        if (newlyCreatedId) {
          newAddedIds.push({ order_item_id: newlyCreatedId, quantity_dispatched: item.quantity });
        }
      }

      // Remove draft items that were discarded while editing.
      const toRemove = originalOrderItems.filter((item) => !stagedIds.has(item.id) && item.status === "DRAFT");
      for (const item of toRemove) {
        await removeItem.mutateAsync(item.id);
      }

      // Persist quantity updates for existing items.
      for (const staged of stagedItems) {
        if (!originalIds.has(staged.id)) continue;

        const original = originalOrderItems.find((item) => item.id === staged.id);
        if (original && original.status === "DRAFT" && original.quantity !== staged.quantity) {
          await updateQuantity.mutateAsync({
            itemId: staged.id,
            quantity: staged.quantity,
            unit_price: staged.unit_price,
          });
        }
      }

      const cancellationSelections = originalOrderItems
        .filter((item) => originalIds.has(item.id) && item.status !== "DRAFT")
        .map((item) => {
          const staged = stagedItems.find((stagedItem) => stagedItem.id === item.id);
          const targetQuantity = Math.max(0, Number(staged?.quantity ?? 0));
          const currentQuantity = Math.max(0, Number(item.quantity ?? 0));
          const quantityCancelled = Math.max(0, currentQuantity - targetQuantity);

          if (quantityCancelled <= 0) return null;

          return {
            order_item_id: item.id,
            quantity_cancelled: quantityCancelled,
            status: item.status,
            description_snapshot: item.description_snapshot,
            unit_price: Number(item.unit_price ?? 0),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (cancellationSelections.length > 0 && user) {
        const isTotalCancellation = stagedItems.every((item) => item.quantity === 0);

        await cancelOrderMutation.mutateAsync({
          orderId,
          items: cancellationSelections,
          userId: user.id,
          cancellationType: isTotalCancellation ? "total" : "partial",
          requiresAuthorization: false,
          cancellationData: {
            reason: stagedCancellationData?.reason ?? "otro",
            notes: stagedCancellationData?.notes
              ? stagedCancellationData.notes
              : isClosedForPayment
                ? "Anulacion aplicada automaticamente al aceptar cambios en orden cerrada."
                : "Anulacion aplicada automaticamente al aceptar cambios en orden despachada.",
            cancelledBy: user.id,
          },
        });
      }

      if (newAddedIds.length > 0 && user) {
        await supabase.rpc("dispatch_order_quantities", {
          p_order_id: orderId,
          p_dispatched_by: user.id,
          p_items: newAddedIds,
          p_operation_type: "partial",
          p_source_module: "dispatch",
          p_notes: isClosedForPayment ? "Añado editando orden cerrada" : "Añado editando orden despachada",
        });
      }

      await unlockOrder.mutateAsync();
      setStagedDirty(false);
      toast.success(
        isClosedForPayment
          ? "Cambios aceptados. Los nuevos items quedaron cerrados para cobro."
          : "Cambios aceptados. Los nuevos items quedaron despachados.",
      );
      navigate("/editar-orden", { replace: true });
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleChangeTable = (destinationTableId: string) => {
    moveToTable.mutate(destinationTableId, {
      onSuccess: (result) => {
        setShowChangeTableDialog(false);
        toast.success(
          result.destination_was_occupied
            ? "Orden movida. Se agrego como una nueva orden en la mesa destino."
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

  const handleRequestInlineCancel = (
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
    if (fromEditar) return;
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

    setInlineCancelVisibleItems([
        {
          id: item.id,
          product_id: item.product_id,
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
    setInlineCancelOpen(true);
  };

  const menuPanel = canEditItems ? (
    <div className="space-y-3">
      {isTrayOrder ? (
        <div className="rounded-[24px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-4 shadow-[0_18px_42px_-30px_rgba(245,158,11,0.3)]">
          <div className="scrollbar-none -mx-1 flex flex-nowrap items-center gap-x-2 overflow-x-auto px-1 pb-0.5 sm:gap-x-4">
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
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition sm:gap-2 sm:text-sm",
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
        <div className="scrollbar-none -mx-1 overflow-x-auto px-1 pb-0.5">
          <Tabs
            value={interactiveMenuScope}
            onValueChange={(value) => {
              const nextScope = value as MenuScope;
              if (interactiveMenuScope === nextScope) return;

              if (nextScope === "BULK") {
                setPendingMenuScopeSelection("BULK");
                return;
              }

              setPendingMenuScopeSelection(nextScope);
              updateMenuScope.mutate(nextScope, {
                onError: () => setPendingMenuScopeSelection(null),
              });
            }}
          >
            <TabsList className="h-auto min-w-max justify-start gap-1 rounded-[24px] border-amber-200 bg-gradient-to-r from-amber-50 via-white to-yellow-50 p-1.5">
              <TabsTrigger
                value="TABLE"
                disabled={updateMenuScope.isPending}
                className="min-h-11 min-w-[6.9rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[8.75rem] sm:gap-2 sm:px-3 sm:text-sm"
              >
                <ChefHat className="h-4 w-4 shrink-0" />
                <span>Menu Mesas</span>
              </TabsTrigger>
              <TabsTrigger
                value="TAKEOUT"
                disabled={updateMenuScope.isPending}
                className="min-h-11 min-w-[6.4rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[8.5rem] sm:gap-2 sm:px-3 sm:text-sm"
              >
                <ShoppingBag className="h-4 w-4 shrink-0" />
                <span>Con envase</span>
              </TabsTrigger>
              <TabsTrigger
                value="BULK"
                disabled={updateMenuScope.isPending}
                className="min-h-11 min-w-[5.9rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[7.75rem] sm:gap-2 sm:px-3 sm:text-sm"
              >
                <Scale className="h-4 w-4 shrink-0" />
                <span>A granel</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      ) : null}
      <MenuNavigator
        menuScope={currentMenuScope}
        nodesOverride={currentMenuScope === "TAKEOUT" || currentMenuScope === "BULK" ? scopeCompositeMenuQuery.data ?? null : null}
        forceLoading={(currentMenuScope === "TAKEOUT" || currentMenuScope === "BULK") && scopeCompositeMenuQuery.isLoading}
        trayMode={isTrayOrder && effectiveTrayType === "C"}
        onSelectProduct={handleSelectMenuProduct}
        renderNodeAction={(node) =>
          selectingProductId === node.id ? (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2 text-center text-xs font-bold text-orange-700">
              Cargando...
            </div>
          ) : !node.is_active && node.node_type === "product" ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-700">
              Producto agotado
            </div>
          ) : null
        }
      />
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center space-y-4 rounded-3xl border border-dashed border-border bg-card/50 p-8 text-center">
      <div className="rounded-full bg-muted p-4">
        <Ban className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="max-w-md space-y-2">
        <p className="text-base font-bold text-foreground">
          {isLockedFromEditar
            ? "Mesa no editable"
            : hasPendingCancellationItems
            ? "Anulación pendiente"
            : order.status === "PAID" || order.status === "CANCELLED"
            ? "Orden finalizada"
            : !canOperateOrders
            ? "Acceso restringido"
            : "Consulta restringida"}
        </p>
        <p className="text-sm text-muted-foreground">
          {isLockedFromEditar
            ? "En el modo 'Editar Orden', esta orden no puede ser editada porque aún no tiene ítems despachados desde cocina."
            : hasPendingCancellationItems
            ? "Esta orden tiene al menos un item con anulacion pendiente: no puedes agregar ni editar items hasta resolver la solicitud."
            : order.status === "PAID" || order.status === "CANCELLED"
            ? "Esta orden ya ha sido pagada o cancelada y se encuentra en modo solo lectura."
            : !canOperateOrders
            ? "No tienes permiso de operación en Órdenes para esta sucursal o tu turno no tiene acceso operativo."
            : "No puedes agregar más items en este estado de la orden o modo de acceso."}
        </p>
      </div>
      <Button
        variant="outline"
        className="h-11 rounded-xl px-8"
        onClick={handleMobileBackToMesas}
      >
        <ChevronLeft className="mr-2 h-4 w-4" />
        Volver a la lista
      </Button>
    </div>
  );

  const orderPanel = (mobile: boolean) => (
    <div className={cn("flex w-full min-w-0 flex-col", mobile ? "h-full" : "h-auto")}>
      <div className="mb-3 flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="shrink-0 font-display text-sm font-bold">Orden</h2>
          <p className="truncate text-xs font-semibold text-muted-foreground">{getOrderRef(order.order_code, order.order_number)}</p>
          {order.created_by_name && (
            <p className="hidden min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-muted-foreground sm:flex">
              <UserRound className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{order.created_by_name}</span>
            </p>
          )}
        </div>
      </div>
      {order.created_by_name && (
        <p className="mb-3 flex items-center gap-1.5 truncate text-xs font-semibold text-muted-foreground sm:hidden">
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{order.created_by_name}</span>
        </p>
      )}

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
                  onChange={(event) => setSpecialTotalInput(sanitizeDecimalInput(event.target.value))}
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
          items={fromEditar ? stagedItems : order.items}
          alwaysShowControls={false}
          hideItemControls={false}
          editableItemIds={[]}
          onRemove={(id) => {
            if (fromEditar) {
              setStagedDirty(true);
              setStagedItems((prev) => {
                const item = prev.find(i => i.id === id);
                if (item && item.status !== "DRAFT") {
                  return prev.map(i => i.id === id ? { ...i, quantity: 0, total: 0 } : i);
                }
                return prev.filter((i) => i.id !== id);
              });
            } else {
              removeItem.mutate(id);
            }
          }}
          onUpdateQty={(id, qty, price) => {
            if (fromEditar) {
              setStagedDirty(true);
              setStagedItems((prev) =>
                prev.map((i) =>
                  i.id === id ? { ...i, quantity: qty, total: qty * price } : i
                )
              );
            } else {
              updateQuantity.mutate({ itemId: id, quantity: qty, unit_price: price });
            }
          }}
          onRequestCancel={fromEditar ? undefined : handleRequestInlineCancel}
          disableDraftEditing={!canEditItems}
          disableOperationalCancel={order.status === "PAID"}
        />
      </div>

      {!fromEditar && canOperateOrders && hasDraftItems && order.status !== "PAID" && order.status !== "CANCELLED" && (
        <Button
          onClick={() => {
            sendToKitchen.mutate(undefined, {
              onSuccess: async () => {
                navigate(`/caja?order=${encodeURIComponent(orderId)}`);
              },
            });
          }}
          disabled={sendToKitchen.isPending || addItem.isPending || hasTemporaryDraftItems}
          title={addItem.isPending || hasTemporaryDraftItems ? "Espera a que el item termine de guardarse" : undefined}
          className="mt-4 h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
        >
          {sendToKitchen.isPending || addItem.isPending || hasTemporaryDraftItems ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : hasSentItems ? (
            <>
              <ChefHat className="h-5 w-5" />
              Enviar nuevos items - ${draftItemsTotal.toFixed(2)}
            </>
          ) : sendsDraftItemsToCaja ? (
            <>
              <CircleDollarSign className="h-5 w-5" />
              Enviar a caja - ${draftItemsTotal.toFixed(2)}
            </>
          ) : (
            <>
              <ChefHat className="h-5 w-5" />
              Enviar a cocina - ${draftItemsTotal.toFixed(2)}
            </>
          )}
        </Button>
      )}

      {!canOperateOrders && (
        <div className="mt-4 rounded-xl bg-muted p-3 text-center text-xs text-muted-foreground">
          Modo consulta: sin acciones operativas sobre la orden.
        </div>
      )}

      {(canShowCloseOrder || (canCancelOrders && hasSentItems && order.status !== "PAID" && order.status !== "CANCELLED") || fromEditar) && (
        <div
          className={cn(
            "mt-4 grid gap-3",
            fromEditar
              ? "grid-cols-1 sm:grid-cols-2"
              : "grid-cols-2",
          )}
        >
          {fromEditar ? (
            <>
              <Button
                variant="outline"
                className="h-12 w-full gap-2 rounded-xl border-slate-200 font-display text-base font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => navigate("/editar-orden")}
              >
                <X className="h-5 w-5" />
                Cancelar edición
              </Button>
              {canEditItems && (
                <Button
                  className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
                  variant="info"
                  disabled={!stagedDirty && stagedItems.length === order.items.length}
                  onClick={handleAcceptEditedOrderChanges}
                >
                  <Sparkles className="h-5 w-5" />
                  Aceptar cambios
                </Button>
              )}
              {canCancelOrders && hasSentItems && order.status !== "PAID" && order.status !== "CANCELLED" && (
                <Button
                  variant="destructive"
                  className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold sm:col-span-2"
                  disabled={hasDraftItems || hasPendingCancellationItems}
                  title={
                    hasPendingCancellationItems
                      ? "No puedes anular la orden mientras exista al menos un item con anulacion pendiente"
                      : hasDraftItems
                        ? "No puedes anular la orden mientras existan items nuevos en borrador"
                        : "Anular orden"
                  }
                  onClick={() => {
                    setInlineCancelVisibleItems(itemsToUse);
                    setInlineCancelQtyByItem({});
                    setInlineCancellationType("total");
                    setInlineCancelOpen(true);
                  }}
                >
                  <Ban className="h-5 w-5" />
                  Anular orden
                </Button>
              )}
            </>
          ) : (
            <>
              {canShowCloseOrder && (
                <Button
                  variant="outline"
                  className="h-12 w-full gap-2 rounded-xl border-emerald-300 bg-emerald-50 font-display text-base font-semibold text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900"
                  onClick={() => setShowCloseOrderConfirm(true)}
                  disabled={closeOrder.isPending || !canCloseOrder}
                  title={
                    hasPendingCancellationItems
                      ? "No puedes cerrar la orden mientras exista al menos un item con anulacion pendiente"
                      : !canCloseOrder
                        ? "Solo puedes cerrar la orden cuando no haya items nuevos en borrador y todos los items enviados esten completamente despachados"
                        : "Cerrar orden"
                  }
                >
                  {closeOrder.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <CircleDollarSign className="h-5 w-5" />}
                  Cerrar orden
                </Button>
              )}

              {canCancelOrders && hasSentItems && order.status !== "PAID" && order.status !== "CANCELLED" && (
                <Button
                  variant="destructive"
                  className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
                  disabled={hasDraftItems || hasPendingCancellationItems}
                  title={
                    hasPendingCancellationItems
                      ? "No puedes anular la orden mientras exista al menos un item con anulacion pendiente"
                      : hasDraftItems
                        ? "No puedes anular la orden mientras existan items nuevos en borrador"
                        : "Anular orden"
                  }
                  onClick={() => {
                    setInlineCancelVisibleItems(itemsToUse);
                    setInlineCancelQtyByItem({});
                    setInlineCancellationType("total");
                    setInlineCancelOpen(true);
                  }}
                >
                  <Ban className="h-5 w-5" />
                  Anular orden
                </Button>
              )}
            </>
          )}
        </div>
      )}

    </div>
  );

  return (
    <div className="ordenes-mobile-touch flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-start gap-1 border-b border-border bg-card/50 px-3 py-3 sm:px-4">
        <div className="min-w-0 w-full space-y-2">
          <div className="flex items-center justify-between gap-1">
            <div className="scrollbar-none min-w-0 flex flex-1 items-center gap-2 overflow-x-auto">
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
            </div>

            {order.table_id && (
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-9 shrink-0 rounded-lg p-0 2xl:hidden"
                      aria-label="Abrir menu de acciones"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 2xl:hidden">
                    {canShowConvertToSpecial && (
                      <DropdownMenuItem
                        onClick={() => {
                          setConvertSpecialTotalInput(total.toFixed(2));
                          setConvertSpecialDialogOpen(true);
                        }}
                        disabled={!canConvertToSpecial}
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Convertir orden especial
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onClick={() => setMergeSplitOpen(true)}
                      disabled={!canOperateOrders}
                    >
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Mover Items/Mesa
                    </DropdownMenuItem>
                    {canShowChangeTable && (
                      <DropdownMenuItem
                        onClick={() => setShowChangeTableDialog(true)}
                        disabled={!canChangeTable || moveToTable.isPending}
                      >
                        {moveToTable.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                        Cambiar mesa
                      </DropdownMenuItem>
                    )}
                    {hasSiblings && (
                      <DropdownMenuItem
                        onClick={() => setShowDeleteSplitConfirm(true)}
                        disabled={!canDeleteSplit || removingSplit}
                        className="text-destructive focus:text-destructive"
                      >
                        {removingSplit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                        Eliminar orden
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {hasSiblings && (
                  <Button
                    variant={canDeleteSplit ? "destructive" : "ghost"}
                    size="sm"
                    className={cn(
                      "hidden h-9 w-9 shrink-0 rounded-lg p-0 2xl:inline-flex 2xl:h-7 2xl:w-7",
                      !canDeleteSplit && "text-muted-foreground",
                    )}
                    onClick={() => setShowDeleteSplitConfirm(true)}
                    disabled={!canDeleteSplit || removingSplit}
                    title={
                      !canDeleteSplit
                        ? "Solo puedes eliminar una orden borrador que aun no haya sido enviada, pagada o anulada"
                        : "Eliminar esta orden"
                    }
                  >
                    {removingSplit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            )}
          </div>

          {order.table_id && (
            <div className="flex items-center gap-2 pb-1">
              <div className="scrollbar-none flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto pr-1">
                {mergedTableOrders.map((tableOrder, index) => (
                  <button
                    key={tableOrder.id}
                    type="button"
                    className={cn(
                      "group flex h-10 shrink-0 items-center gap-2 border border-border bg-card px-3 text-[11px] font-semibold text-foreground transition-colors",
                      index === 0 && "rounded-l-xl",
                      index === mergedTableOrders.length - 1 && "border-r-0",
                      tableOrder.id === order.id
                        ? "border-orange-300 bg-orange-50 text-orange-900 shadow-[0_10px_20px_-18px_rgba(249,115,22,0.85)]"
                        : "hover:bg-muted/60",
                    )}
                    onClick={() => navigate(`/ordenes?order=${tableOrder.id}${sourceParams}`, { replace: true })}
                  >
                    <span className="whitespace-nowrap">{getTableOrderButtonLabel(tableOrder)}</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "px-1.5 py-0 text-[10px]",
                        tableOrder.id === order.id && "bg-orange-100 text-orange-700",
                      )}
                    >
                      {tableOrder.item_count}
                    </Badge>
                    {tableOrder.id === order.id && canDeleteSplit && (
                      <span
                        role="button"
                        aria-label="Eliminar orden activa"
                        className={cn(
                          "ml-1 inline-flex h-4 w-4 items-center justify-center rounded-sm text-orange-700 opacity-0 transition-opacity",
                          "group-hover:opacity-100",
                        )}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setShowDeleteSplitConfirm(true);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  className={cn(
                    "flex h-10 shrink-0 items-center justify-center rounded-r-xl border border-border bg-card px-3 text-muted-foreground transition-colors hover:bg-muted/60",
                    (!canSplit || splitting) && "cursor-not-allowed opacity-50",
                  )}
                  onClick={handleSplit}
                  disabled={!canSplit || splitting}
                  title={
                    !canOperateOrders
                      ? "No tienes permiso para crear nuevas ordenes en la mesa"
                      : order.items.length <= 0
                        ? "La orden actual debe tener al menos un item"
                        : !allExistingTableOrdersHaveItems
                          ? "Todas las ordenes existentes deben tener al menos un item"
                          : !canSplit
                            ? "La mesa debe seguir activa para crear otra orden"
                            : "Nueva orden"
                  }
                >
                  {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquarePlus className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "relative h-10 min-w-[46px] shrink-0 overflow-visible rounded-xl px-2 2xl:hidden",
                  showCart && "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 hover:text-orange-800",
                )}
                onClick={() => setShowCart((current) => !current)}
                aria-label={showCart ? "Volver al menu" : "Ver orden"}
              >
                {showCart ? <BookOpenText className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                {!showCart && itemCount > 0 && (
                  <span className="absolute right-1 top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground shadow-sm">
                    {itemCount}
                  </span>
                )}
              </Button>
            </div>
          )}

          <div className="scrollbar-none flex items-center gap-2 overflow-x-auto pb-1">
            {canShowConvertToSpecial && (
              <Button
                variant="outline"
                size="sm"
                className="hidden h-11 shrink-0 gap-1 rounded-lg px-3 text-xs 2xl:inline-flex 2xl:h-7"
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
            {canShowChangeTable && (
              <>
                <Button
                  variant={canChangeTable ? "outline" : "ghost"}
                  size="sm"
                  className={cn(
                    "hidden h-11 shrink-0 gap-1 rounded-lg px-3 text-xs 2xl:inline-flex 2xl:h-7",
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
              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 overflow-hidden 2xl:hidden">
        <div
          className={cn(
            "min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 pb-24",
            showCart && "hidden",
          )}
        >
          {menuPanel}
        </div>

        <div className={cn("flex w-full flex-col overflow-y-auto border-border p-3 pb-24", !showCart && "hidden")}>
          {orderPanel(true)}
        </div>
      </div>

      <div className="relative z-10 hidden flex-1 overflow-hidden p-4 2xl:grid 2xl:grid-cols-[minmax(0,1fr)_520px] 2xl:gap-4">
        <div className="min-w-0 overflow-x-hidden overflow-y-auto">
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
        modifiers={selectedProduct && (!isTrayOrder || effectiveTrayType !== "A") ? selectedProductModifiers : []}
        open={canEditItems && !!selectedProduct}
        onClose={() => {
          setSelectedProduct(null);
          setSelectedProductModifiers([]);
        }}
        priceModeOverride={isTrayOrder ? (effectiveTrayType === "C" ? "MANUAL" : "FIXED") : undefined}
        manualPriceLabel={isTrayOrder && effectiveTrayType === "C" ? "Precio manual" : "Precio"}
        confirmLabel="Agregar"
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
          const selectedModifierIds = isTrayOrder && effectiveTrayType === "A" ? [] : data.modifier_ids;
          const modifierDescriptionById = new Map(
            selectedProductModifiers.map((modifier) => [modifier.id, modifier.description]),
          );
          const selectedModifierSnapshots = selectedModifierIds.map((id) => ({
            modifier_id: id,
            description: modifierDescriptionById.get(id) ?? "",
          }));

          if (fromEditar) {
            setStagedDirty(true);
            setStagedItems((prev) => [
              ...prev,
              {
                id: `staged-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                product_id: data.product_id,
                menu_node_id: selectedProduct?.menu_node_id ?? null,
                description_snapshot: data.description_snapshot,
                item_note: data.item_note ?? null,
                quantity: data.quantity,
                quantity_ordered: data.quantity,
                original_quantity: data.quantity,
                cancelled_quantity: 0,
                unit_price: data.unit_price,
                total: data.quantity * data.unit_price + (data.quantity > 0 ? (data.tray_container_cost ?? 0) : 0),
                status: "DRAFT",
                tray_item_type: isTrayOrder ? effectiveTrayType : isBulkScopeSelection ? "C" : null,
                tray_container_cost: 0,
                quantity_sent: 0,
                quantity_ready_available: 0,
                quantity_dispatched: 0,
                quantity_remaining: data.quantity,
                quantity_cancelled: 0,
                quantity_cancellable: 0,
                modifiers: selectedModifierSnapshots.map((modifier) => ({
                  id: `temp-mod-${modifier.modifier_id}`,
                  modifier_id: modifier.modifier_id,
                  description: modifier.description,
                })),
              } as any,
            ]);
            setSelectedProduct(null);
            return;
          }

          addItem.mutate({
            ...data,
            menu_node_id: selectedProduct?.menu_node_id ?? null,
            modifier_ids: selectedModifierIds,
            modifier_snapshots: selectedModifierSnapshots,
            tray_item_type: isTrayOrder ? effectiveTrayType : isBulkScopeSelection ? "C" : undefined,
            tray_container_cost: 0,
          }, {
            onSuccess: () => {
              setSelectedProduct(null);
            },
          });
        }}
        adding={addItem.isPending}
      />

      <Dialog open={!!takeoutCajaPreview} onOpenChange={(open) => !open && setTakeoutCajaPreview(null)}>
        <DialogContent className="max-w-lg rounded-3xl border border-orange-200 p-0">
          <DialogHeader className="border-b border-orange-100 bg-gradient-to-r from-orange-50 to-amber-50 px-5 py-4">
            <DialogTitle className="font-display text-lg font-black text-foreground">
              Orden enviada a Caja
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <span className="block text-xs font-bold uppercase tracking-widest text-orange-700">Numero de orden</span>
              <span className="block font-mono text-3xl font-black tracking-wide text-slate-950">
                {takeoutCajaPreview?.orderLabel ?? "--"}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
            {takeoutCajaPreview?.items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-bold text-slate-900">{item.description}</p>
                    {item.modifiers.length > 0 && (
                      <div className="mt-1 space-y-0.5 text-xs font-semibold text-red-600">
                        {item.modifiers.map((modifier, index) => (
                          <p key={`${item.id}-modifier-${index}`}>- {modifier}</p>
                        ))}
                      </div>
                    )}
                    {item.note && (
                      <p className="mt-1 break-words text-xs italic text-slate-500">Nota: {item.note}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-bold text-slate-500">Cant. {item.quantity}</p>
                    <p className="text-sm font-black text-slate-950">${item.total.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between border-t border-slate-200 px-1 pt-4">
              <span className="text-sm font-bold uppercase tracking-wide text-slate-500">Total</span>
              <span className="text-2xl font-black text-slate-950">${(takeoutCajaPreview?.total ?? 0).toFixed(2)}</span>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-100 px-5 py-4">
            <Button
              className="w-full rounded-xl"
              onClick={() => {
                setTakeoutCajaPreview(null);
                navigate("/mesas");
              }}
            >
              Aceptar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {order && (
        <ThermalReceipt
          ref={receiptRef}
          orderNumber={getOrderRef(order.order_code, order.order_number)}
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
            <AlertDialogTitle>Eliminar orden</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara la orden seleccionada dentro de la mesa. Esta accion solo debe hacerse si la orden aun no ha sido enviada a cocina.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingSplit}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSplit} disabled={removingSplit || !canDeleteSplit}>
              {removingSplit ? "Eliminando..." : "Eliminar orden"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showCloseOrderConfirm} onOpenChange={setShowCloseOrderConfirm}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar orden</AlertDialogTitle>
            <AlertDialogDescription>
              La orden se desvinculara de la mesa y quedara lista para pagar en Caja. Si la mesa tiene otras ordenes activas, esas ordenes seguiran ocupandola.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeOrder.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleCloseOrder();
              }}
              disabled={closeOrder.isPending}
            >
              {closeOrder.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar cierre
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
        tables={tables}
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
                onChange={(event) => setConvertSpecialTotalInput(sanitizeDecimalInput(event.target.value))}
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
          orderNumber={getOrderRef(order.order_code, order.order_number)}
          userId={user.id}
          open={inlineCancelOpen}
          onOpenChange={(open) => {
            setInlineCancelOpen(open);
            if (!open) {
              setInlineCancelVisibleItems([]);
              setInlineCancelQtyByItem({});
              setInlineCancellationType("partial");
            }
          }}
          canAuthorizeCancel={canAuthorizeCancel}
          isCancelRequested={!!order.cancel_requested_at}
          visibleItems={inlineCancelVisibleItems}
          initialCancellationType={inlineCancellationType}
          initialCancelQtyByItem={inlineCancelQtyByItem}
          compactPresetMode={true}
          onBufferedCancel={fromEditar ? (items, cancelData) => {
            setStagedCancellationData(cancelData);
            setStagedDirty(true);
            setStagedItems((prev) => {
              let next = [...prev];
              for (const cancelledItem of items) {
                const existingIndex = next.findIndex((i) => i.id === cancelledItem.order_item_id);
                if (existingIndex >= 0) {
                  const existing = next[existingIndex];
                  const newQty = Math.max(0, existing.quantity - cancelledItem.quantity_cancelled);
                  next[existingIndex] = {
                    ...existing,
                    quantity: newQty,
                    total: newQty * existing.unit_price,
                  };
                }
              }
              return next;
            });
          } : undefined}
        />
      )}

      <MergeSplitOrdersDialog
        open={mergeSplitOpen}
        onOpenChange={setMergeSplitOpen}
        initialSourceOrderId={order.id}
        initialSourceOption={{
          id: order.id,
          orderId: order.id,
          label: `${order.table_name ?? "Mesa"} (${String(order.order_number ?? 0).padStart(4, "0").slice(-4)})`,
          orderCode: order.order_code,
          tableName: order.table_name ?? "Mesa",
          tableId: order.table_id,
          splitCode: order.split_code ?? null,
          splitId: order.split_id,
          status: order.status,
          menuScope: order.menu_scope,
          sortKey: `0000-${order.table_name ?? "Mesa"}-${order.order_number ?? 0}`,
          hasOperationalItems: order.items.some((item) => item.status !== "DRAFT"),
        }}
      />

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

