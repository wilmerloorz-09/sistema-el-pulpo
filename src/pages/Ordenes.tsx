import React, { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  compareSiblingOrderTabs,
  fetchOrderDetail,
  fetchSiblingOrders,
  fetchTakeoutSiblingOrders,
  fetchExpressSiblingOrders,
  fetchExtraSiblingOrders,
  applyKitchenPendingItemChanges,
  getOrderQueryKey,
  isTemporaryOrderItemId,
  persistOrderItemLineQuantity,
  seedDineInDraftOrderCache,
  useOrder,
  buildItemPreviewLinesForTableCard,
  type Order,
  type SiblingOrder,
} from "@/hooks/useOrder";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import MenuNavigator from "@/components/order/MenuNavigator";
import FrequentProductCards from "@/components/order/FrequentProductCards";
import type { FrequentProductContext } from "@/hooks/useFrequentProducts";
import { buildCompositeMenuNodes } from "@/lib/compositeMenuTree";
import AddItemDialog from "@/components/order/AddItemDialog";
import OrderItemsList from "@/components/order/OrderItemsList";
import ThermalReceipt from "@/components/order/ThermalReceipt";
import OrdersList from "@/components/order/OrdersList";
import CancelOrderDialog from "@/components/order/CancelOrderDialog";
import ChangeTableDialog from "@/components/order/ChangeTableDialog";
import ConvertirOrdenEspecialDialog from "@/components/order/ConvertirOrdenEspecialDialog";
import MergeSplitOrdersDialog from "@/components/order/MergeSplitOrdersDialog";
import PaymentDialog from "@/components/caja/PaymentDialog";
import PaymentDialogV2 from "@/components/caja/PaymentDialogV2";
import { USE_PAYMENT_DIALOG_V2, canOpenPaymentUiOnDevice } from "@/lib/cajaPaymentUi";
import { catalogToPaymentDenoms } from "@/lib/cajaDenominations";
import { useCaja, type PayableOrder } from "@/hooks/useCaja";
import { TrayItemChip } from "@/components/order/TrayItemChip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Loader2, ChefHat, ShoppingBag, CircleDollarSign, BookOpenText, MoreVertical, ArrowRightLeft, Sparkles, ChevronLeft, ChevronRight, Scale, Ban, SquarePlus, X, UserRound, Pencil, Menu, Truck, Zap } from "lucide-react";
import { sanitizeDecimalInput } from "@/lib/numericInput";
import { cn } from "@/lib/utils";
import { isMesasListOrigin, mesasListPathForOrigin, MESAS_V2_CARDS_PARAM, formatTableBadge } from "@/lib/mesasFlow";
import { toast } from "sonner";
import type { OrderSummary } from "@/hooks/useOrdersByStatus";
import { canManage, canOperate } from "@/lib/permissions";
import { fetchMenuTreeNodes, type MenuNode, type MenuScope } from "@/hooks/useMenuTree";
import { useCancellation } from "@/hooks/useCancellation";
import { getOrderMesaHeaderNumber, getOrderRef } from "@/lib/orderPresentation";
import { getOrderStatusLabel, isExtraOrder as orderIsExtra, isOrderItemEditableInDispatchFirstEditMode, isSpecialOrderExplicitZeroTotal } from "@/lib/orderFlow";
import {
  computeKitchenSendMoneyDelta,
  formatKitchenSendMoneyDelta,
  hasKitchenPendingChanges,
  reconcileKitchenStagedItems,
} from "@/lib/kitchenPendingChanges";
import type { TrayItemType } from "@/hooks/useTrayOrder";
import { dbSelect } from "@/services/DatabaseService";
import { useBreakpoint } from "@/hooks/useBreakpoint";

/** Una sola RPC create_dine_in_order por mesa+orden optimista (evita doble creación en Strict Mode). */
const mesaOpenDineInCreateByKey = new Map<string, Promise<string>>();

/** Estado en tarjetas del selector de cuentas (mesa). */
const ORDER_STICKY_CHROME_BAR_CLASS =
  "fixed inset-x-0 top-below-app-header z-40 border-b border-orange-300/90 bg-gradient-to-b from-amber-50 via-orange-50 to-amber-100 px-3 py-2.5 shadow-[0_4px_12px_-8px_rgba(234,88,12,0.35),inset_0_1px_0_0_rgba(251,146,60,0.45)] sm:px-4 sm:py-3 md:relative md:sticky md:inset-x-auto md:top-0 md:z-20 md:rounded-t-3xl md:border md:border-orange-300/90 md:shadow-[inset_0_1px_0_0_rgba(251,146,60,0.45)]";

const ORDER_STICKY_CHROME_SPACER_CLASS = "h-[3.75rem] shrink-0 md:hidden";

const MESA_PICKER_CARD_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  SENT_TO_KITCHEN: "En caja",
  READY: "Listo",
  KITCHEN_DISPATCHED: "Despachado",
  PAID: "Pagado",
  CANCELLED: "Anulada",
  PENDING_CANCELLATION: "Pendiente",
};

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

const SUPABASE_IN_CHUNK_SIZE = 200;

async function fetchRowsInChunks<T>(
  ids: string[],
  fetchChunk: (chunkIds: string[]) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  if (ids.length === 0) return [];

  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += SUPABASE_IN_CHUNK_SIZE) {
    const chunkIds = ids.slice(index, index + SUPABASE_IN_CHUNK_SIZE);
    const { data, error } = await fetchChunk(chunkIds);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/** En memoria: enlaces nodo↔modificador + textos, para armar la lista sin esperar al lookup del producto */
interface BranchModifiersCatalog {
  links: Array<{ node_id: string; modifier_id: string; display_order: number | null }>;
  modifiersById: Map<string, { id: string; description: string }>;
  parentByNodeId: Map<string, string | null>;
}

async function fetchBranchModifiersCatalog(branchId: string): Promise<BranchModifiersCatalog> {
  const { data: nodeRows, error: nErr } = await supabase
    .from("menu_nodes" as any)
    .select("id, parent_id")
    .eq("branch_id", branchId);
  if (nErr) throw nErr;

  const typedNodeRows = (nodeRows ?? []) as Array<{ id: string; parent_id: string | null }>;
  const parentByNodeId = new Map(typedNodeRows.map((row) => [row.id, row.parent_id ?? null]));
  const nodeIds = typedNodeRows.map((row) => row.id).filter(Boolean);
  if (nodeIds.length === 0) {
    return { links: [], modifiersById: new Map(), parentByNodeId };
  }

  const linkRows = await fetchRowsInChunks<{ node_id: string; modifier_id: string; display_order: number | null }>(
    nodeIds,
    async (chunkIds) =>
      supabase
        .from("menu_node_modifiers" as any)
        .select("node_id, modifier_id, display_order")
        .in("node_id", chunkIds)
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
  );

  const links = linkRows.sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
  const modifierIds = [...new Set(links.map((l) => l.modifier_id).filter(Boolean))];
  if (modifierIds.length === 0) {
    return { links, modifiersById: new Map(), parentByNodeId };
  }

  const modRows = await fetchRowsInChunks<{ id: string; description: string }>(
    modifierIds,
    async (chunkIds) =>
      supabase
        .from("modifiers" as any)
        .select("id, description")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .in("id", chunkIds),
  );

  const modifiersById = new Map(modRows.map((modifier) => [modifier.id, modifier]));
  return { links, modifiersById, parentByNodeId };
}

/** Producto primero, luego ancestros (padre → abuelo). Usa parent_id del catalogo si el nodo no trae ancestor_ids. */
function resolveModifierNodeIds(node: MenuNode, catalog: BranchModifiersCatalog): string[] {
  if (node.ancestor_ids && node.ancestor_ids.length > 0) {
    return [node.id, ...node.ancestor_ids];
  }

  const ancestors: string[] = [];
  const visited = new Set<string>();
  let currentParentId = node.parent_id ?? catalog.parentByNodeId.get(node.id) ?? null;

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    ancestors.push(currentParentId);
    currentParentId = catalog.parentByNodeId.get(currentParentId) ?? null;
  }

  return [node.id, ...ancestors];
}

/** Misma prioridad que en `fetchMenuProductLookup` (ancestro → producto, sin duplicar ids) */
function buildModifiersForProductNode(node: MenuNode, catalog: BranchModifiersCatalog): ProductModifierOption[] {
  const modifierNodeIds = resolveModifierNodeIds(node, catalog);
  const modifierLinks = catalog.links
    .filter((link) => modifierNodeIds.includes(link.node_id))
    .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));

  const linksByNode = new Map<string, typeof modifierLinks>();
  for (const link of modifierLinks) {
    const bucket = linksByNode.get(link.node_id) ?? [];
    bucket.push(link);
    linksByNode.set(link.node_id, bucket);
  }

  const seenModifierIds = new Set<string>();
  return modifierNodeIds.flatMap((nodeId) => {
    const nodeLinks = linksByNode.get(nodeId) ?? [];
    return nodeLinks.flatMap((link) => {
      if (seenModifierIds.has(link.modifier_id)) return [];
      const modifier = catalog.modifiersById.get(link.modifier_id);
      if (!modifier) return [];
      seenModifierIds.add(link.modifier_id);
      return [{ id: modifier.id, description: modifier.description }];
    });
  });
}

interface OrdenesErrorBoundaryState {
  error: Error | null;
}

class OrdenesErrorBoundary extends React.Component<{ children: React.ReactNode; orderId: string | null }, OrdenesErrorBoundaryState> {
  constructor(props: { children: React.ReactNode; orderId: string | null }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): OrdenesErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Error al abrir la orden", error);
  }

  componentDidUpdate(prevProps: { orderId: string | null }) {
    if (prevProps.orderId !== this.props.orderId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-5 text-center shadow-sm">
          <p className="font-display text-lg font-black text-red-800">No se pudo abrir la orden</p>
          <p className="mt-2 break-words text-sm font-medium text-red-700">{this.state.error.message}</p>
          <Button type="button" className="mt-4 rounded-xl" onClick={() => this.setState({ error: null })}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }
}

function normalizeMenuLabel(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function resolveRootCategoryName(node: MenuNode, nodes: MenuNode[] | null | undefined) {
  const nodesById = new Map((nodes ?? []).map((candidate) => [candidate.id, candidate]));
  const ancestorIds = node.ancestor_ids ?? [];
  const rootFromAncestors = [...ancestorIds].reverse()
    .map((ancestorId) => nodesById.get(ancestorId))
    .find((ancestor) => ancestor?.node_type === "category");

  if (rootFromAncestors?.name) return rootFromAncestors.name;

  let currentParentId = node.parent_id;
  let lastCategoryName: string | null = null;
  while (currentParentId) {
    const parent = nodesById.get(currentParentId);
    if (!parent) break;
    if (parent.node_type === "category") lastCategoryName = parent.name;
    currentParentId = parent.parent_id;
  }

  return lastCategoryName;
}

function isPlatosRootCategory(value?: string | null) {
  return normalizeMenuLabel(value).includes("PLATOS");
}

function buildProductLoadingShell(node: MenuNode, isTrayOrder: boolean, trayType: TrayItemType) {
  const price_mode: "FIXED" | "MANUAL" = isTrayOrder
    ? trayType === "C"
      ? "MANUAL"
      : "FIXED"
    : node.manual_price_inherited
      ? "MANUAL"
      : "FIXED";
  return {
    description: node.name.trim() || "Producto",
    unit_price: node.price == null ? null : Number(node.price),
    price_mode,
    icon: node.icon ?? null,
    image_url: node.image_url ?? null,
  };
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
  /** Si viene, los modificadores se resuelven en memoria (sin 3.er round-trip) */
  catalog?: BranchModifiersCatalog | null;
}): Promise<MenuProductLookupResult> {
  const { data: freshNode, error: freshNodeError } = await supabase
    .from("menu_nodes" as any)
    .select("legacy_product_id")
    .eq("id", params.node.id)
    .maybeSingle();
  if (freshNodeError) throw freshNodeError;

  const resolvedLegacyProductId =
    typeof freshNode?.legacy_product_id === "string" && freshNode.legacy_product_id.trim().length > 0
      ? freshNode.legacy_product_id
      : params.node.legacy_product_id;

  const candidateProductIds = Array.from(
    new Set(
      (
        params.node.menu_scope === "TABLE"
          ? [params.node.id, resolvedLegacyProductId]
          : [resolvedLegacyProductId, params.node.id]
      ).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );

  if (candidateProductIds.length === 0) {
    throw new Error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
  }

  const modifierNodeIds = params.catalog
    ? resolveModifierNodeIds(params.node, params.catalog)
    : [params.node.id, ...(params.node.ancestor_ids ?? [])];

  let modifiers: ProductModifierOption[];
  let productRows: unknown[] | null;

  if (params.catalog) {
    modifiers = buildModifiersForProductNode(params.node, params.catalog);
    const { data, error: productError } = await supabase
      .from("products")
      .select("id, description, subcategory_id, unit_price, price_mode")
      .in("id", candidateProductIds);
    if (productError) {
      throw new Error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
    }
    productRows = data ?? [];
  } else {
    const [productsRes, linksRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, description, subcategory_id, unit_price, price_mode")
        .in("id", candidateProductIds),
      supabase
        .from("menu_node_modifiers" as any)
        .select("node_id, modifier_id, display_order, is_active")
        .in("node_id", modifierNodeIds)
        .eq("is_active", true)
        .order("display_order", { ascending: true }),
    ]);

    const { data: pr, error: productError } = productsRes;
    const { data: links, error: linksError } = linksRes;

    if (productError) {
      throw new Error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
    }
    if (linksError) throw linksError;
    productRows = pr ?? [];

    const modifierLinks = (links ?? []) as Array<{
      node_id: string;
      modifier_id: string;
      display_order?: number | null;
    }>;
    const modifierIdSet = new Set<string>(modifierLinks.map((link) => link.modifier_id).filter(Boolean));
    const modifierIds = Array.from(modifierIdSet);

    modifiers = [];
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

      <div className="grid flex-1 gap-4 px-3 py-4 md:grid-cols-2">
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

/** Solo listado: evita montar useCaja, mesas, menús y el resto de OrdenesContent (carga como Caja > Por cobrar). */
function OrdenesListShell() {
  const { user } = useAuth();
  const { permissions, isGlobalAdmin } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const [cancelOrder, setCancelOrder] = useState<OrderSummary | null>(null);
  const [mergeSplitOpen, setMergeSplitOpen] = useState(false);

  const canManageOrders = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");
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

const EMPTY_ITEMS: any[] = [];

const OrdenesContent = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, activeBranch, branches, permissions, setActiveBranch, isGlobalAdmin } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const { isDesktop, isTablet10 } = useBreakpoint();
  const qc = useQueryClient();
  const orderId = searchParams.get("order");
  const mesaOpenAttemptRef = useRef(0);
  const [pendingTrayType, setPendingTrayType] = useState<TrayItemType | null>(null);
  const effectiveTrayType: TrayItemType = pendingTrayType ?? "B";
  const [pendingMenuScopeSelection, setPendingMenuScopeSelection] = useState<MenuScope | null>(null);

  const {
    order,
    isLoading,
    isFetching,
    isError,
    error,
    addItem,
    removeItem,
    updateQuantity,
    sendToKitchen,
    sendToDispatch,
    moveToTable,
    createTableOrder,
    deleteTableOrder,
    updateMenuScope,
    updateSpecialTotal,
    closeOrder,
    lockOrder,
    unlockOrder,
  } = useOrder(orderId);
  const orderItems = order?.items ?? EMPTY_ITEMS;
  const { cancelOrderMutation } = useCancellation();

  // Permisos y estados base moved up to avoid TDZ
  const canManageOrders = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");
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
    || canOperateOrders
    || Boolean(shiftGateQuery.data?.canEditOrders)
    || Boolean(shiftGateQuery.data?.isSupervisor);
  const fromEditar = searchParams.get("from") === "editar" && canUseEditarOrden;
  const origin = searchParams.get("origin");
  const originParam = origin ? `&origin=${origin}` : "";
  const mesasChromeActive =
    !fromEditar
    && (isMesasListOrigin(origin) || (order?.order_type === "DINE_IN" && Boolean(order?.table_id)));
  const mesaCardsParam =
    mesasChromeActive && searchParams.get(MESAS_V2_CARDS_PARAM) === "1" ? `&${MESAS_V2_CARDS_PARAM}=1` : "";
  const sourceParams = (fromEditar ? "&from=editar" : "") + originParam + mesaCardsParam;
  const sourceParamsNoMesaCards = (fromEditar ? "&from=editar" : "") + originParam;
  const isTakeoutOrder = order?.order_type === "TAKEOUT" && !order?.is_tray_order && !order?.is_special;
  const isExpressOrder = order?.order_type === "EXPRESS" && !order?.is_tray_order && !order?.is_special;
  const isExtraOrder = orderIsExtra(order);
  const activeWorkflowMode = activeBranch?.workflow_mode ?? "CASH_THEN_DISPATCH";
  const isDispatchFirstFlow = isExpressOrder || (activeWorkflowMode === "DISPATCH_THEN_CASH" && !isTakeoutOrder);
  const useKitchenStaging = isDispatchFirstFlow && !fromEditar;
  const isTakeoutMenuOrder = isTakeoutOrder || isExpressOrder;
  const isBranchSiblingOrder = isTakeoutOrder || isExpressOrder || isExtraOrder;
  const frequentProductContext = useMemo((): FrequentProductContext | null => {
    if (isExtraOrder) return "EXTRA";
    if (isExpressOrder) return "EXPRESS";
    if (isTakeoutOrder) return "TAKEOUT";
    if (order?.order_type === "DINE_IN" && order?.table_id && !order?.is_special && !order?.is_tray_order) {
      return "MESA";
    }
    return null;
  }, [
    isExtraOrder,
    isExpressOrder,
    isTakeoutOrder,
    order?.order_type,
    order?.table_id,
    order?.is_special,
    order?.is_tray_order,
  ]);

  const canOperateMesasForOpen =
    canOperate(permissions, "mesas")
    || Boolean(shiftGateQuery.data?.canServeTables)
    || Boolean(shiftGateQuery.data?.isSupervisor);

  const openTableIdForCreate = searchParams.get("openTable");

  useEffect(() => {
    const mesasOriginTag = searchParams.get("origin");
    if (!openTableIdForCreate || !orderId) return;
    if (!isMesasListOrigin(mesasOriginTag)) return;
    if (!user || !activeBranchId) return;
    if (shiftGateQuery.isLoading) return;

    if (!canOperateMesasForOpen) {
      toast.error("No tienes permiso para abrir mesas.");
      qc.removeQueries({ queryKey: getOrderQueryKey(orderId) });
      navigate(mesasListPathForOrigin(mesasOriginTag), { replace: true });
      return;
    }

    const flightKey = `${openTableIdForCreate}:${orderId}`;
    const tableNameFromUrl = (() => {
      const enc = searchParams.get("tableName");
      return enc ? decodeURIComponent(enc) : undefined;
    })();

    let rpcPromise = mesaOpenDineInCreateByKey.get(flightKey);
    if (!rpcPromise) {
      rpcPromise = (async () => {
        const { data, error } = await supabase.rpc("create_dine_in_order" as any, {
          p_branch_id: activeBranchId,
          p_created_by: user.id,
          p_table_id: openTableIdForCreate,
          p_is_special: false,
        } as any);
        if (error) throw error;
        return String(data);
      })();
      mesaOpenDineInCreateByKey.set(flightKey, rpcPromise);
      void rpcPromise.finally(() => {
        mesaOpenDineInCreateByKey.delete(flightKey);
      });
    }

    const myAttempt = ++mesaOpenAttemptRef.current;
    let cancelled = false;

    void rpcPromise
      .then((realId) => {
        if (cancelled || myAttempt !== mesaOpenAttemptRef.current) return;

        if (realId === orderId) {
          navigate(`/ordenes?order=${realId}&origin=${mesasOriginTag}`, { replace: true });
          qc.invalidateQueries({ queryKey: ["orders"] });
          qc.invalidateQueries({ queryKey: ["tables-with-status"] });
          qc.invalidateQueries({ queryKey: ["table-orders", openTableIdForCreate] });
          void qc.prefetchQuery({
            queryKey: getOrderQueryKey(realId),
            queryFn: () => fetchOrderDetail(realId),
            staleTime: 15_000,
            gcTime: 10 * 60_000,
          });
          return;
        }

        const cached = qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined;
        if (cached) {
          const nextSiblings = (cached.siblings ?? []).map((s) =>
            s.id === orderId ? { ...s, id: realId } : s,
          );
          const siblings: SiblingOrder[] =
            nextSiblings.length > 0
              ? nextSiblings
              : [
                  {
                    id: realId,
                    order_number: null,
                    order_code: null,
                    split_code: null,
                    table_order_position: cached.table_order_position ?? 1,
                    item_count: 0,
                    created_at: cached.created_at,
                  },
                ];
          qc.setQueryData(getOrderQueryKey(realId), {
            ...cached,
            id: realId,
            siblings,
          } as Order);
        } else {
          const nowIso = new Date().toISOString();
          seedDineInDraftOrderCache(qc, realId, {
            branchId: activeBranchId,
            tableId: openTableIdForCreate,
            tableName: tableNameFromUrl,
            createdAt: nowIso,
            tableOrderPosition: 1,
            siblings: [
              {
                id: realId,
                order_number: null,
                order_code: null,
                split_code: null,
                table_order_position: 1,
                item_count: 0,
                created_at: nowIso,
              },
            ],
          });
        }

        // Navegar antes de borrar caché del id optimista: si no, la URL sigue con el UUID viejo,
        // useOrder pierde datos y el efecto de "orden inexistente" manda al listado de mesas.
        navigate(`/ordenes?order=${realId}&origin=${mesasOriginTag}`, { replace: true });
        queueMicrotask(() => {
          qc.removeQueries({ queryKey: getOrderQueryKey(orderId) });
        });
        qc.invalidateQueries({ queryKey: ["orders"] });
        qc.invalidateQueries({ queryKey: ["tables-with-status"] });
        qc.invalidateQueries({ queryKey: ["table-orders", openTableIdForCreate] });
        void qc.prefetchQuery({
          queryKey: getOrderQueryKey(realId),
          queryFn: () => fetchOrderDetail(realId),
          staleTime: 15_000,
          gcTime: 10 * 60_000,
        });
      })
      .catch((err: any) => {
        if (cancelled || myAttempt !== mesaOpenAttemptRef.current) return;
        toast.error(err?.message || "Error al abrir la mesa");
        qc.removeQueries({ queryKey: getOrderQueryKey(orderId) });
        navigate(mesasListPathForOrigin(mesasOriginTag), { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [
    openTableIdForCreate,
    orderId,
    searchParams,
    user,
    activeBranchId,
    shiftGateQuery.isLoading,
    canOperateMesasForOpen,
    navigate,
    qc,
  ]);

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
    : order?.order_type === "EXTRA"
      ? "TABLE"
      : order?.order_type === "TAKEOUT" || order?.order_type === "EXPRESS"
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

  useQuery({
    queryKey: ["branch-modifiers-catalog", activeBranchId],
    queryFn: () => fetchBranchModifiersCatalog(activeBranchId!),
    enabled: !!activeBranchId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [selectedProductRootName, setSelectedProductRootName] = useState<string | null>(null);
  const [selectedProductModifiers, setSelectedProductModifiers] = useState<ProductModifierOption[]>([]);
  const [productLoadingShell, setProductLoadingShell] = useState<ReturnType<typeof buildProductLoadingShell> | null>(null);
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
  const specialTotalDebounceTimeoutRef = useRef<any>(null);
  const [specialGroupInput, setSpecialGroupInput] = useState("");
  const specialGroupDebounceTimeoutRef = useRef<any>(null);
  const [convertSpecialDialogOpen, setConvertSpecialDialogOpen] = useState(false);
  const [convertingToSpecial, setConvertingToSpecial] = useState(false);
  const [takeoutCajaPreview, setTakeoutCajaPreview] = useState<TakeoutCajaPreview | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  /** Evita volver a forzar el panel de orden en movil si el usuario ya paso al menu (misma orden). Se limpia al cambiar `orderId`. */
  const mobileOrderDetailBootstrappedForIdRef = useRef<string | null>(null);
  /** Ignora respuestas async de selecciones de producto anteriores (doble toque / red lenta en movil). */
  const productSelectSeqRef = useRef(0);
  const syncedOrderBranchRef = useRef<string | null>(null);
  const tableOrdersTabsRef = useRef<HTMLDivElement>(null);
  const [tableOrdersTabsOverflow, setTableOrdersTabsOverflow] = useState({
    left: false,
    right: false,
  });
  const [paymentDialogOpenForOrderId, setPaymentDialogOpenForOrderId] = useState<string | null>(null);
  const [showCajaUnopenedAlert, setShowCajaUnopenedAlert] = useState(false);
  const showPaymentDialog = Boolean(orderId && paymentDialogOpenForOrderId === orderId);


  const { 
    shift,
    paymentMethods, 
    denominations, 
    payOrder, 
    prepareTransferProof, 
    discardPreparedTransferProof, 
    getTransferProofReadiness,
    openCashRegister
  } = useCaja();

  // Denominaciones del cliente se usan directamente en PaymentDialogV2 (independiente de plantilla).

  const payableOrder: PayableOrder | null = useMemo(() => {
    if (!order) return null;
    const realTotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    return {
      id: order.id,
      order_number: order.order_number,
      order_code: order.order_code,
      order_type: order.order_type,
      is_special: order.is_special,
      is_tray_order: order.is_tray_order,
      created_by: order.created_by,
      created_by_name: order.created_by_name,
      special_total_manual: order.special_total_manual,
      special_real_total: realTotal,
      special_paid_amount: 0,
      special_pending_amount: order.is_special
        ? (order.special_total_manual ?? realTotal)
        : realTotal,
      table_name: order.table_name,
      table_name_snapshot: order.table_name,
      split_code: order.split_code,
      total: realTotal,
      ready_to_collect: true,
      items: orderItems.map(item => ({
        id: item.id,
        product_id: item.product_id,
        menu_node_id: null,
        image_url: null,
        icon: null,
        description_snapshot: item.description_snapshot,
        quantity: item.original_quantity ?? item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        tray_item_type: item.tray_item_type,
        tray_container_cost: item.tray_container_cost,
        paid_at: item.paid_at ?? null,
        quantity_paid: item.quantity_paid ?? 0,
        quantity_pending: item.quantity,
        pending_total: item.quantity > 0
          ? (item.quantity * item.unit_price + Number(item.tray_container_cost ?? 0))
          : 0,
      }))
    };
  }, [order, orderItems]);

  const isBulkScopeSelection = currentMenuScope === "BULK";
  const shouldCalculateBulkIncludedByAmount = isBulkScopeSelection && isPlatosRootCategory(selectedProductRootName);
  const showMenuScopeTabs = order?.order_type === "DINE_IN" || isTakeoutMenuOrder;
  const menuScopeOptions: Array<{ value: MenuScope; label: string; icon: ReactNode; className: string }> = isTakeoutMenuOrder
    ? [
        {
          value: "TAKEOUT",
          label: "Con envase",
          icon: <ShoppingBag className="h-4 w-4 shrink-0" />,
          className: "min-h-11 min-w-[6.4rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[8.5rem] sm:gap-2 sm:px-3 sm:text-sm",
        },
        ...(!order?.is_special
          ? [
              {
                value: "BULK" as MenuScope,
                label: "A granel",
                icon: <Scale className="h-4 w-4 shrink-0" />,
                className: "min-h-11 min-w-[5.9rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[7.75rem] sm:gap-2 sm:px-3 sm:text-sm",
              },
            ]
          : []),
      ]
    : [
        {
          value: "TABLE",
          label: "Menu Mesas",
          icon: <ChefHat className="h-4 w-4 shrink-0" />,
          className: "min-h-11 min-w-[6.9rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[8.75rem] sm:gap-2 sm:px-3 sm:text-sm",
        },
        {
          value: "TAKEOUT",
          label: "Con envase",
          icon: <ShoppingBag className="h-4 w-4 shrink-0" />,
          className: "min-h-11 min-w-[6.4rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[8.5rem] sm:gap-2 sm:px-3 sm:text-sm",
        },
        ...(!order?.is_special
          ? [
              {
                value: "BULK" as MenuScope,
                label: "A granel",
                icon: <Scale className="h-4 w-4 shrink-0" />,
                className: "min-h-11 min-w-[5.9rem] gap-1.5 rounded-[18px] px-2.5 text-[11px] sm:min-w-[7.75rem] sm:gap-2 sm:px-3 sm:text-sm",
              },
            ]
          : []),
      ];

  /** Misma normalización que fetchSiblingOrders para que el orden de pestañas no salte al fusionar/refetch. */
  const currentTableOrder: SiblingOrder | null = order
    ? {
        id: order.id,
        order_number: order.order_number,
        order_code: order.order_code,
        status: order.status,
        split_code: order.split_code ?? null,
        table_order_position: Number(order.table_order_position ?? 0) || null,
        created_at: order.created_at ?? null,
        item_count: orderItems.length,
        item_preview_lines: buildItemPreviewLinesForTableCard(order.items ?? []),
      }
    : null;

  const [fromEditarLocked, setFromEditarLocked] = useState(false);
  const [stagedItems, setStagedItems] = useState(order?.items ?? []);
  const [stagedDirty, setStagedDirty] = useState(false);
  const [kitchenBaselineItems, setKitchenBaselineItems] = useState(order?.items ?? []);
  const [stagedCancellationData, setStagedCancellationData] = useState<{ reason: string; notes: string } | null>(null);
  const [acceptingEditChanges, setAcceptingEditChanges] = useState(false);
  const [deletingCajaOrder, setDeletingCajaOrder] = useState(false);
  const [confirmDeleteCajaOrderOpen, setConfirmDeleteCajaOrderOpen] = useState(false);
  const [deleteCajaOrderError, setDeleteCajaOrderError] = useState("");
  const [sendingKitchenChanges, setSendingKitchenChanges] = useState(false);
  const kitchenBaselineOrderIdRef = useRef<string | null>(null);

  const itemsToUse = (fromEditar || useKitchenStaging) ? stagedItems : (order?.items ?? []);
  const isPaidItem = (item: any) => {
    const status = String(item.status ?? "");
    const orderedQuantity = Math.max(0, Number(item.quantity_ordered ?? item.original_quantity ?? item.quantity ?? 0));
    const pendingQuantity = Math.max(0, Number(item.quantity ?? 0));

    return (
      status === "PAID" ||
      Boolean(item.paid_at) ||
      Math.max(0, Number((item as any).quantity_paid ?? 0)) > 0 ||
      (orderedQuantity > 0 && pendingQuantity <= 0 && !status.includes("CANCEL"))
    );
  };

  useEffect(() => {
    if (fromEditar) {
      if (order && !stagedDirty) {
        setStagedItems(orderItems);
      }
      return;
    }

    if (!useKitchenStaging) {
      setStagedDirty(false);
      setStagedItems(orderItems);
      return;
    }

    if (isLoading || !orderId) return;

    if (kitchenBaselineOrderIdRef.current !== orderId) {
      kitchenBaselineOrderIdRef.current = orderId;
      setStagedDirty(false);
      setKitchenBaselineItems(orderItems);
      setStagedItems(orderItems);
      return;
    }

    if (!stagedDirty) {
      setStagedItems(orderItems);
    }
  }, [fromEditar, useKitchenStaging, orderId, orderItems, stagedDirty, isLoading, order]);

  useEffect(() => {
    if (!useKitchenStaging || fromEditar || isLoading) return;

    setStagedItems((prev) => reconcileKitchenStagedItems(prev, orderItems));
  }, [useKitchenStaging, fromEditar, isLoading, orderItems]);

  useEffect(() => {
    if (!useKitchenStaging || !stagedDirty || isLoading) return;

    setStagedItems((prev) => {
      const reconciled = reconcileKitchenStagedItems(prev, orderItems);
      const prevIds = new Set(reconciled.map((item) => item.id));
      const baselineIds = new Set(kitchenBaselineItems.map((item) => item.id));
      // Solo incorporar lineas realmente nuevas (p.ej. addItem), no reinyectar
      // borradores que el usuario ya quito del staging aunque sigan un instante en BD.
      const newFromServer = orderItems.filter(
        (item) => !prevIds.has(item.id) && !baselineIds.has(item.id),
      );
      if (newFromServer.length === 0) return reconciled;
      return [...reconciled, ...newFromServer];
    });
  }, [useKitchenStaging, stagedDirty, orderItems, isLoading, kitchenBaselineItems]);

  const tableOrdersQuery = useQuery({
    queryKey: isExpressOrder
      ? ["express-orders", order?.branch_id ?? null]
      : isExtraOrder
        ? ["extra-orders", order?.branch_id ?? null, user?.id ?? "_"]
        : isTakeoutOrder
          ? ["takeout-orders", order?.branch_id ?? null]
          : ["table-orders", order?.table_id ?? null],
    queryFn: () =>
      isExpressOrder
        ? fetchExpressSiblingOrders(order!.branch_id)
        : isExtraOrder
          ? fetchExtraSiblingOrders(order!.branch_id, user!.id)
          : isTakeoutOrder
            ? fetchTakeoutSiblingOrders(order!.branch_id)
            : fetchSiblingOrders(order!.table_id!, order!.branch_id, order!.id),
    enabled: isBranchSiblingOrder ? !!order?.branch_id : !!order?.table_id,
    staleTime: isBranchSiblingOrder ? 0 : 8_000,
    refetchOnMount: isBranchSiblingOrder ? "always" : true,
    gcTime: 2 * 60_000,
    /** Mesa: datos precargados desde Mesas/MesasV2 en caché. Llevar/Express/Extra: orden actual mientras llegan hermanos. */
    placeholderData: () => {
      if (isBranchSiblingOrder) {
        return currentTableOrder ? [currentTableOrder] : undefined;
      }
      const tid = order?.table_id;
      if (!tid) return undefined;
      return qc.getQueryData(["table-orders", tid]) as SiblingOrder[] | undefined;
    },
  });

  /** Lista de hermanos en mesa (solo DINE_IN): misma regla que `mergedTableOrders` para gestos táctiles. */
  const mergedTableOrdersForSwipe = useMemo((): SiblingOrder[] => {
    if (!order || order.order_type !== "DINE_IN" || !order.table_id) return [];
    const ct: SiblingOrder = {
      id: order.id,
      order_number: order.order_number,
      order_code: order.order_code,
      status: order.status,
      split_code: order.split_code ?? null,
      table_order_position: Number(order.table_order_position ?? 0) || null,
      created_at: order.created_at ?? null,
      item_count: orderItems.length,
      item_preview_lines: buildItemPreviewLinesForTableCard(order.items ?? []),
    };
    const tableOrders = tableOrdersQuery.data?.length
      ? tableOrdersQuery.data
      : [ct];
    return tableOrders
      .map((tableOrder) => (tableOrder.id === ct.id ? ct : tableOrder))
      .sort(compareSiblingOrderTabs);
  }, [
    order?.id,
    order?.table_id,
    order?.order_type,
    order?.order_number,
    order?.order_code,
    order?.split_code,
    order?.table_order_position,
    order?.created_at,
    orderItems.length,
    tableOrdersQuery.data,
  ]);

  const isMesasChromeUiForSwipe =
    mesasChromeActive && order?.order_type === "DINE_IN" && Boolean(order?.table_id);
  const showMesasV2CardPickerForSwipe =
    isMesasChromeUiForSwipe &&
    searchParams.get(MESAS_V2_CARDS_PARAM) === "1" &&
    mergedTableOrdersForSwipe.length >= 1;

  const tableOrderSwipeEnabled =
    !isDesktop &&
    Boolean(orderId) &&
    !fromEditar &&
    Boolean(order) &&
    order.order_type === "DINE_IN" &&
    Boolean(order.table_id) &&
    mergedTableOrdersForSwipe.length > 1 &&
    !showMesasV2CardPickerForSwipe;

  const mergedTableOrdersSwipeKey = mergedTableOrdersForSwipe
    .map((o) => `${o.id}:${o.item_count ?? 0}`)
    .join("|");

  useEffect(() => {
    if (!tableOrderSwipeEnabled || !orderId) return;

    const siblings = mergedTableOrdersForSwipe;
    const touchRef = { x: 0, y: 0, t: 0, active: false };

    const hasOpenModal = () =>
      Boolean(
        document.querySelector('[role="dialog"][data-state="open"]') ||
          document.querySelector('[role="alertdialog"][data-state="open"]'),
      );

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target?.closest("[data-no-order-swipe]")) return;
      touchRef.active = true;
      touchRef.x = e.touches[0].clientX;
      touchRef.y = e.touches[0].clientY;
      touchRef.t = Date.now();
    };

    const onEnd = (e: TouchEvent) => {
      if (!touchRef.active) return;
      touchRef.active = false;
      if (e.changedTouches.length !== 1) return;
      if (hasOpenModal()) return;

      const dx = e.changedTouches[0].clientX - touchRef.x;
      const dy = e.changedTouches[0].clientY - touchRef.y;
      const dt = Date.now() - touchRef.t;

      if (dt > 700) return;
      if (Math.abs(dx) < 72) return;
      if (Math.abs(dx) < Math.abs(dy) * 2) return;

      const idx = siblings.findIndex((o) => o.id === orderId);
      if (idx < 0) return;

      if (dx < 0) {
        if (idx < siblings.length - 1) {
          const next = siblings[idx + 1];
          navigate(`/ordenes?order=${next.id}${sourceParams}`, { replace: true });
        }
      } else if (idx > 0) {
        const prev = siblings[idx - 1];
        navigate(`/ordenes?order=${prev.id}${sourceParams}`, { replace: true });
      }
    };

    const onCancel = () => {
      touchRef.active = false;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, [tableOrderSwipeEnabled, orderId, mergedTableOrdersSwipeKey, navigate, sourceParams, mergedTableOrdersForSwipe]);

  const updateTableOrdersTabsOverflow = useCallback(() => {
    const el = tableOrdersTabsRef.current;
    if (!el) return;

    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setTableOrdersTabsOverflow({
      left: el.scrollLeft > 2,
      right: el.scrollLeft < maxScrollLeft - 2,
    });
  }, []);

  const scrollTableOrdersTabs = useCallback((direction: "left" | "right") => {
    const el = tableOrdersTabsRef.current;
    if (!el) return;

    const amount = Math.max(180, el.clientWidth * 0.7);
    el.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  }, []);

  const handleDeleteCajaOrder = useCallback(async () => {
    if (!user || !order || deletingCajaOrder) return;

    setDeletingCajaOrder(true);
    setDeleteCajaOrderError("");
    try {
      const activeItems = (order.items ?? []).filter(
        (item) => Math.max(0, Number(item.quantity ?? 0)) > 0 || item.status === "DRAFT",
      );
      const isCurrentCajaItem = (item: (typeof activeItems)[number]) =>
        item.status !== "DRAFT" &&
        Number(item.quantity_dispatched ?? 0) <= 0 &&
        item.status !== "DISPATCHED" &&
        !(
          item.status === "PENDING_CANCELLATION" ||
          item.status === "ITEM_PENDING_CANCELLATION" ||
          Math.max(0, Number((item as any).quantity_requested ?? 0)) > 0
        ) &&
        !isPaidItem(item);
      const canDeleteCurrentOrder =
        activeItems.length > 0 &&
        activeItems.every((item) => item.status === "DRAFT" || isCurrentCajaItem(item)) &&
        !activeItems.some((item) => item.status === "DRAFT" && isTemporaryOrderItemId(item.id));

      if (!canDeleteCurrentOrder) {
        throw new Error("Solo puedes eliminar la orden si todos los items estan en borrador o en cocina/caja, sin pagos ni despacho.");
      }

      const draftItems = activeItems.filter((item) => item.status === "DRAFT");
      const sentItems = activeItems.filter((item) => item.status !== "DRAFT");

      if (sentItems.length === 0) {
        if (!order.table_id) {
          for (const item of draftItems) {
            await persistOrderItemLineQuantity(item.id, 0, item.unit_price, item.quantity, item.status);
          }
        } else {
          await deleteTableOrder.mutateAsync();
        }
      } else {
        // Evitar cancelOrderMutation: su onSuccess hace refetchQueries(["orders"]) y puede colgar el diálogo.
        const isBenignDeleteError = (raw: unknown) => {
          const message = String((raw as { message?: string })?.message ?? raw ?? "").toLowerCase();
          return (
            message.includes("ya esta cancelada")
            || message.includes("ya está cancelada")
            || message.includes("no hay cantidades pendientes")
            || message.includes("no hay items")
            || message.includes("orden cerrada")
          );
        };

        const { error: cancelError } = await (supabase as any).rpc("cancel_order_quantities", {
          p_order_id: order.id,
          p_cancelled_by: user.id,
          p_reason: "Eliminacion de orden",
          p_notes: "Orden eliminada directamente desde el detalle de la orden.",
          p_items: [],
          p_cancellation_type: "total",
        });

        if (cancelError) {
          const message = String(cancelError.message ?? "");
          if (message.toLowerCase().includes("requiere autorizacion")) {
            throw new Error("Esta orden requiere autorizacion de supervisor para eliminarse.");
          }

          if (!isBenignDeleteError(cancelError)) {
            // Fallback: anular cada linea enviada (despacho primero).
            for (const item of sentItems) {
              try {
                await persistOrderItemLineQuantity(
                  item.id,
                  0,
                  item.unit_price,
                  item.quantity,
                  item.status,
                );
              } catch (lineError) {
                if (!isBenignDeleteError(lineError)) throw lineError;
              }
            }
          }
          // Si ya quedó cancelada / sin cantidades, el objetivo se cumplió: no reintentar RPC.
        }

        for (const item of draftItems) {
          try {
            await persistOrderItemLineQuantity(item.id, 0, item.unit_price, item.quantity, item.status);
          } catch (lineError) {
            if (!isBenignDeleteError(lineError)) throw lineError;
          }
        }
      }

      qc.invalidateQueries({ queryKey: getOrderQueryKey(order.id) });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["payable-orders"] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["table-orders"] });
      qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      setConfirmDeleteCajaOrderOpen(false);

      if (order.table_id) {
        navigate(mesasListPathForOrigin(origin), { replace: true });
      } else if (sourceParams.includes("origin=para-llevar")) {
        navigate("/para-llevar", { replace: true });
      } else if (sourceParams.includes("origin=express")) {
        navigate("/express", { replace: true });
      } else if (sourceParams.includes("origin=extra")) {
        navigate("/extra", { replace: true });
      } else if (sourceParams.includes("origin=orden-especial")) {
        navigate("/orden-especial", { replace: true });
      } else {
        navigate("/ordenes", { replace: true });
      }
    } catch (error: any) {
      console.error("Error eliminando orden en caja:", error);
      const message = error?.message || "Error desconocido";
      setDeleteCajaOrderError(`No se pudo eliminar la orden: ${message}`);
    } finally {
      setDeletingCajaOrder(false);
    }
  }, [deleteTableOrder, deletingCajaOrder, isPaidItem, navigate, order, origin, qc, sourceParams, user]);

  useEffect(() => {
    updateTableOrdersTabsOverflow();

    const el = tableOrdersTabsRef.current;
    if (!el) return;

    const handleScroll = () => updateTableOrdersTabsOverflow();
    const handleResize = () => updateTableOrdersTabsOverflow();
    el.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      el.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [order?.id, tableOrdersQuery.data?.length, updateTableOrdersTabsOverflow]);


  useEffect(() => {
    setRedirectingAfterDelete(false);
  }, [orderId]);


  useEffect(() => {
    const isEditableStatus =
      order?.status === "SENT_TO_KITCHEN" ||
      order?.status === "READY" ||
      order?.status === "KITCHEN_DISPATCHED";

    if (fromEditar && order && !isEditableStatus) {
      const origin = searchParams.get("origin");
      if (!origin || origin === "editar") {
        navigate("/editar-orden", { replace: true });
      } else {
        navigate(`/ordenes?order=${orderId}&from=${origin}`, { replace: true });
      }
    }
  }, [fromEditar, order?.status, navigate]);

  useEffect(() => {
    if (fromEditar && order?.id && !order.locked_for_editing && !fromEditarLocked) {
      lockOrder.mutate();
      setFromEditarLocked(true);
    }
  }, [fromEditar, order?.id, order?.locked_for_editing, fromEditarLocked, lockOrder]);

  // Radix deja body con pointer-events:none si el dropdown que abrio "Editar orden"
  // se desmonta al cambiar la vista; sin esta limpieza toda la pantalla queda sin clics.
  useEffect(() => {
    const clearBodyPointerLock = () => {
      if (document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }
    };
    clearBodyPointerLock();
    const timeoutId = window.setTimeout(clearBodyPointerLock, 350);
    return () => window.clearTimeout(timeoutId);
  }, [fromEditar]);

  useEffect(() => {
    if (!orderId || isLoading || isFetching || shiftGateQuery.isLoading) return;
    if (order || redirectingAfterDelete || removingSplit) return;
    // Apertura optimista de mesa libre: aún no hay fila en BD o la RPC está en curso.
    if (isMesasListOrigin(searchParams.get("origin")) && searchParams.get("openTable")) return;

    const originValue = searchParams.get("origin");
    const fallbackPath =
      originValue === "para-llevar"
        ? "/para-llevar"
        : originValue === "express"
          ? "/express"
          : originValue === "extra"
            ? "/extra"
        : originValue === "orden-especial"
          ? "/orden-especial"
          : isMesasListOrigin(originValue)
            ? mesasListPathForOrigin(originValue)
            : fromEditar
              ? "/editar-orden"
              : "/mesas";

    if (isError && error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    navigate(fallbackPath, { replace: true });
  }, [
    fromEditar,
    isFetching,
    isLoading,
    isError,
    error,
    navigate,
    order,
    orderId,
    redirectingAfterDelete,
    removingSplit,
    searchParams,
    shiftGateQuery.isLoading,
  ]);

  useEffect(() => {
    return () => {
      if (fromEditar && orderId) {
        // Unlock on unmount
        supabase.from("orders").update({ locked_for_editing: false }).eq("id", orderId).then(() => {});
      }
    };
  }, [fromEditar, orderId]);

  useEffect(() => {
    if (!orderId || !order?.branch_id) return;
    if (activeBranchId === order.branch_id) {
      syncedOrderBranchRef.current = order.branch_id;
      return;
    }

    const matchingBranch = branches.find((branch) => branch.id === order.branch_id);
    if (!matchingBranch) {
      toast.error("Esta orden pertenece a una sucursal que no esta disponible en tu contexto actual.");
      return;
    }

    const previousBranchId = activeBranchId;
    void setActiveBranch(matchingBranch).then(() => {
      syncedOrderBranchRef.current = order.branch_id;
      if (previousBranchId && previousBranchId !== order.branch_id) {
        toast.info("Se cambio la sucursal activa para mostrar la orden en su contexto correcto.");
      }
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
    setSpecialGroupInput(
      order.special_group_total == null ? "" : Number(order.special_group_total).toFixed(2),
    );
  }, [order?.id, order?.is_special, order?.special_total_manual, order?.special_group_total]);

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
    setSelectedProductRootName(null);
    setSelectedProductModifiers([]);
    setProductLoadingShell(null);
    setSelectingProductId(null);
    setShowCart(false);
    mobileOrderDetailBootstrappedForIdRef.current = null;
    // Siempre forzamos el cierre del dialogo al cambiar de mesa o refrescar
    setPaymentDialogOpenForOrderId(null);
  }, [orderId]);

  /** Mesa + una sola orden: en movil abrir primero el detalle si la orden esta en caja, pagada o despachada. */
  useEffect(() => {
    if (isDesktop) return;
    if (fromEditar) return;
    if (!orderId || !order || order.id !== orderId) return;
    if (mobileOrderDetailBootstrappedForIdRef.current === orderId) return;
    if (order.order_type !== "DINE_IN" || !order.table_id) return;
    if (showMesasV2CardPickerForSwipe) return;
    if (mergedTableOrdersForSwipe.length !== 1) return;
    if (mergedTableOrdersForSwipe[0]?.id !== order.id) return;
    const st = order.status;
    if (st !== "SENT_TO_KITCHEN" && st !== "PAID" && st !== "KITCHEN_DISPATCHED") return;

    mobileOrderDetailBootstrappedForIdRef.current = orderId;
    setShowCart(true);
  }, [
    isDesktop,
    fromEditar,
    orderId,
    order,
    mergedTableOrdersForSwipe,
    mergedTableOrdersSwipeKey,
    showMesasV2CardPickerForSwipe,
  ]);

  // Limpieza total al salir del modulo para evitar "fantasmas"
  useEffect(() => {
    return () => {
      setPaymentDialogOpenForOrderId(null);
      setTakeoutCajaPreview(null);
    };
  }, []);

  const isTakeout = order?.order_type === "TAKEOUT";
  const canUseCaja = 
    isGlobalAdmin || 
    canManageOrders || 
    Boolean(shiftGateQuery.data?.canUseCaja);
  useEffect(() => {
    if (!order || !isTakeoutOrder) return;
    if (paymentDialogOpenForOrderId === order.id) return;

    let cancelled = false;
    void fetchTakeoutSiblingOrders(order.branch_id)
      .then((orders) => {
        if (cancelled) return;
        const currentOrderIsStillActive = orders.some((takeoutOrder) => takeoutOrder.id === order.id);
        if (currentOrderIsStillActive) return;

        const nextOrderId = orders.find((takeoutOrder) => takeoutOrder.id !== order.id)?.id ?? null;
        navigate(nextOrderId ? `/ordenes?order=${nextOrderId}${sourceParams}` : "/para-llevar", { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate("/para-llevar", { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [isTakeoutOrder, navigate, order, paymentDialogOpenForOrderId, sourceParams]);

  useEffect(() => {
    if (!order || !isExpressOrder) return;
    if (paymentDialogOpenForOrderId === order.id) return;

    if (order.status === "KITCHEN_DISPATCHED" || order.status === "PAID") {
      navigate("/express", { replace: true });
      return;
    }

    let cancelled = false;
    void fetchExpressSiblingOrders(order.branch_id)
      .then((orders) => {
        if (cancelled) return;
        const currentOrderIsStillActive = orders.some((expressOrder) => expressOrder.id === order.id);
        if (currentOrderIsStillActive) return;

        const nextOrderId = orders.find((expressOrder) => expressOrder.id !== order.id)?.id ?? null;
        navigate(nextOrderId ? `/ordenes?order=${nextOrderId}${sourceParams}` : "/express", { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate("/express", { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [isExpressOrder, navigate, order, order?.status, paymentDialogOpenForOrderId, sourceParams]);

  useEffect(() => {
    if (!order || !isExtraOrder) return;
    if (paymentDialogOpenForOrderId === order.id) return;

    let cancelled = false;
    if (!user?.id) return;
    void fetchExtraSiblingOrders(order.branch_id, user.id)
      .then((orders) => {
        if (cancelled) return;
        const currentOrderIsStillActive = orders.some((extraOrder) => extraOrder.id === order.id);
        if (currentOrderIsStillActive) return;

        const nextOrderId = orders.find((extraOrder) => extraOrder.id !== order.id)?.id ?? null;
        navigate(nextOrderId ? `/ordenes?order=${nextOrderId}${sourceParams}` : "/extra", { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate("/extra", { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [isExtraOrder, navigate, order, paymentDialogOpenForOrderId, sourceParams, user?.id]);

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
    if (fromEditar) {
      const editOrigin = origin || "editar";
      navigate(`/ordenes?order=${orderId}&from=${editOrigin}`, { replace: true });
      return;
    }

    if (origin === "para-llevar" || isTakeoutOrder) {
      navigate("/para-llevar", { replace: true });
      return;
    }

    if (origin === "express" || isExpressOrder) {
      navigate("/express", { replace: true });
      return;
    }

    if (origin === "extra" || isExtraOrder) {
      navigate("/extra", { replace: true });
      return;
    }

    if (isMesasListOrigin(origin) || order?.table_id) {
      navigate(mesasListPathForOrigin(origin), { replace: true });
      return;
    }

    if (origin === "orden-especial" || order?.is_special) {
      navigate("/orden-especial", { replace: true });
      return;
    }

    navigate("/ordenes", { replace: true });
  }, [fromEditar, isExpressOrder, isExtraOrder, isTakeoutOrder, navigate, order?.is_special, order?.table_id, orderId, origin]);

  const bulkIncludedPreviewQuery = useQuery({
    queryKey: ["bulk-included-preview", activeBranchId, selectedProduct?.menu_node_id, shouldCalculateBulkIncludedByAmount],
    queryFn: async () => {
      if (!activeBranchId || !selectedProduct?.menu_node_id || !shouldCalculateBulkIncludedByAmount) return [] as BulkIncludedPreviewAssignment[];

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
    enabled: !!activeBranchId && !!selectedProduct?.menu_node_id && shouldCalculateBulkIncludedByAmount,
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

  if (isLoading && !order) {
    return <OrdenesSkeleton />;
  }

  if (!order) {
    return <OrdenesSkeleton />;
  }

  const itemCount = itemsToUse.reduce((s, i) => s + i.quantity, 0);
  /** En móvil el panel de orden se oculta detrás de `showCart`; `quantity` puede ser 0 con líneas despachadas aún visibles. */
  const mobileOrderBadgeCount = itemsToUse.reduce((sum, i) => {
    const qo = Number((i as { quantity_ordered?: number }).quantity_ordered ?? 0);
    if (qo > 0) return sum + qo;
    return sum + Math.max(0, Number(i.quantity ?? 0));
  }, 0);
  const getTableOrderButtonLabel = (tableOrder: { order_code?: string | null; order_number: number | null; table_order_position: number | null }) => {
    const label = getOrderMesaHeaderNumber({
      orderCode: tableOrder.order_code,
      orderNumber: tableOrder.order_number,
      tableOrderPosition: tableOrder.table_order_position,
    });
    return label.match(/^\d+$/) ? label : `Orden ${label}`;
  };

  const total = itemsToUse.reduce((s, i) => s + i.total, 0);
  const draftItemsTotal = itemsToUse
    .filter((item) => item.status === "DRAFT")
    .reduce((sum, item) => sum + item.total, 0);
  const effectiveSpecialTotalManual = useMemo((): number | null => {
    if (!order.is_special) return null;
    const rawValue = specialTotalInput.trim().replace(",", ".");
    if (!rawValue) return null;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed * 100) / 100;
  }, [order.is_special, specialTotalInput]);
  const specialDifference =
    effectiveSpecialTotalManual == null
      ? null
      : Math.round((effectiveSpecialTotalManual - total) * 100) / 100;

  /** Orden especial MIXTA: parte con valor manual (grupo) + resto a precio real. */
  const isMixedSpecial = Boolean(order.is_special) && order.special_group_total != null;
  const specialBreakdown = useMemo(() => {
    const lines = itemsToUse.map((item) => {
      const qty = Math.max(0, Number(item.quantity ?? 0));
      const especialQty = Math.min(Math.max(0, Number((item as any).cantidad_especial ?? 0)), qty);
      const normalQty = Math.max(0, qty - especialQty);
      const unit = Number(item.unit_price ?? 0);
      return {
        item,
        especialQty,
        normalQty,
        unit,
        especialRealTotal: Math.round(especialQty * unit * 100) / 100,
        normalTotal: Math.round(normalQty * unit * 100) / 100,
      };
    });
    const especialLines = lines.filter((l) => l.especialQty > 0);
    const normalLines = lines.filter((l) => l.normalQty > 0);
    const restRealTotal = Math.round(normalLines.reduce((s, l) => s + l.normalTotal, 0) * 100) / 100;
    const especialRealRef = Math.round(especialLines.reduce((s, l) => s + l.especialRealTotal, 0) * 100) / 100;
    return { especialLines, normalLines, restRealTotal, especialRealRef };
  }, [itemsToUse]);

  const specialGroupValueNum = useMemo(() => {
    const fallback = order.special_group_total != null ? Number(order.special_group_total) : 0;
    const raw = specialGroupInput.trim().replace(",", ".");
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
  }, [specialGroupInput, order.special_group_total]);

  const mixedGeneralTotal = Math.round((specialGroupValueNum + specialBreakdown.restRealTotal) * 100) / 100;

  /** Items del resto proyectados a cantidad normal (sin unidades del grupo especial). */
  const mixedRestoItems = useMemo(() => {
    return specialBreakdown.normalLines.map((l) => {
      const item = l.item;
      const especialQty = l.especialQty;
      const normalQty = l.normalQty;
      const dispatched = Math.max(0, Number(item.quantity_dispatched ?? 0));
      const remaining = Math.max(0, Number(item.quantity_remaining ?? 0));
      const normalDispatched = Math.min(normalQty, Math.max(0, dispatched - especialQty));
      const unit = Number(item.unit_price ?? 0);
      return {
        ...item,
        quantity: normalQty,
        quantity_ordered: Math.max(normalQty, Number(item.quantity_ordered ?? 0) - especialQty),
        quantity_dispatched: normalDispatched,
        quantity_remaining: Math.min(normalQty, remaining),
        quantity_sent: Math.max(0, Number(item.quantity_sent ?? 0) - especialQty),
        quantity_cancellable: Math.min(
          normalQty,
          Math.max(0, Number(item.quantity_cancellable ?? normalQty)),
        ),
        total: Math.round(normalQty * unit * 100) / 100,
      };
    });
  }, [specialBreakdown]);

  const especialQtyByItemId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of specialBreakdown.especialLines) {
      map[line.item.id] = line.especialQty;
    }
    return map;
  }, [specialBreakdown]);

  const finalButtonTotal = order.is_special
    ? (effectiveSpecialTotalManual ?? draftItemsTotal)
    : draftItemsTotal;
  const hasDraftItems = itemsToUse.some((i) => i.status === "DRAFT");
  const hasTemporaryDraftItems = itemsToUse.some((i) => i.status === "DRAFT" && isTemporaryOrderItemId(i.id));
  const hasSentItems = itemsToUse.some((i) => i.status !== "DRAFT");
  const hasPendingKitchenChanges = useKitchenStaging
    && hasKitchenPendingChanges(kitchenBaselineItems, stagedItems);
  const kitchenSendDelta = useKitchenStaging
    ? computeKitchenSendMoneyDelta(kitchenBaselineItems, stagedItems)
    : finalButtonTotal;
  // En despacho-primero los borradores se persisten al instante: cualquier DRAFT
  // representa trabajo sin enviar, aunque la linea base ya lo incluya (p. ej. al
  // reabrir la orden con un borrador atascado de una sesion anterior).
  const showKitchenSendButton = useKitchenStaging
    ? (hasPendingKitchenChanges || hasDraftItems)
    : hasDraftItems;
  const kitchenSendButtonLabel = isMixedSpecial
    ? `$${draftItemsTotal.toFixed(2)}`
    : order.is_special
    ? `$${finalButtonTotal.toFixed(2)}`
    : useKitchenStaging && hasPendingKitchenChanges
      ? formatKitchenSendMoneyDelta(kitchenSendDelta)
      : `$${finalButtonTotal.toFixed(2)}`;
  const hasPendingCancellationItems = itemsToUse.some((item) =>
    item.status === "PENDING_CANCELLATION" ||
    item.status === "ITEM_PENDING_CANCELLATION" ||
    Math.max(0, Number((item as any).quantity_requested ?? 0)) > 0,
  );
  const isSent = order.status === "SENT_TO_KITCHEN";
  const tableOrders = tableOrdersQuery.data?.length
    ? tableOrdersQuery.data
    : currentTableOrder
      ? [currentTableOrder]
      : [];
  const visibleTableOrders = isBranchSiblingOrder
    ? tableOrders.filter((tableOrder) => tableOrder.id === currentTableOrder?.id || tableOrder.item_count > 0)
    : tableOrders;
  const mergedTableOrders = isBranchSiblingOrder
    ? [...visibleTableOrders].sort(compareSiblingOrderTabs)
    : currentTableOrder
      ? visibleTableOrders
        .map((tableOrder) => (tableOrder.id === currentTableOrder.id ? currentTableOrder : tableOrder))
        .sort(compareSiblingOrderTabs)
      : visibleTableOrders;
  const hasSiblings = mergedTableOrders.length > 1;
  const isMesasChromeUi =
    mesasChromeActive && order.order_type === "DINE_IN" && Boolean(order.table_id);
  const mesaCardsMode = isMesasChromeUi && searchParams.get(MESAS_V2_CARDS_PARAM) === "1";
  const showMesasV2CardPicker =
    isMesasChromeUi && mesaCardsMode && Boolean(order.table_id) && mergedTableOrders.length >= 1;

  /** Mismo criterio que las pestañas de orden; va tras "Orden #" en la barra de mesa. */
  const getOrdenNumeroParaCabeceraMesa = (o: {
    order_code?: string | null;
    order_number: number | null;
    table_order_position: number | null;
  }) =>
    getOrderMesaHeaderNumber({
      orderCode: o.order_code,
      orderNumber: o.order_number,
      tableOrderPosition: o.table_order_position,
    });

  /** "Orden #…" solo al ver la orden (no en la rejilla de selección de órdenes de la mesa). */
  const renderMesaChromeHeaderTitle = (o: typeof order, withOrdenLabel: boolean) => (
    <span className="inline-flex min-w-0 max-w-full items-center gap-3 tabular-nums sm:gap-4">
      <span
        className="inline-flex min-h-[2rem] min-w-[2rem] shrink-0 items-center justify-center rounded-full border border-orange-300 bg-amber-100 px-2 text-base font-black leading-none text-primary shadow-sm dark:border-primary/40 dark:bg-orange-950/80 dark:text-orange-300 sm:min-h-[2.35rem] sm:min-w-[2.35rem] sm:text-lg"
        aria-label={`Mesa ${formatTableBadge((o?.table_name ?? "").trim() || "Mesa")}`}
      >
        {formatTableBadge((o?.table_name ?? "").trim() || "Mesa")}
      </span>
      {withOrdenLabel ? (
        <span className="shrink-0 font-black tracking-tight">
          Orden #{getOrdenNumeroParaCabeceraMesa(o)}
        </span>
      ) : null}
    </span>
  );

  const hasOrderItems = itemsToUse.length > 0;
  const shiftOpen = Boolean(shiftGateQuery.data?.shiftOpen);
  /** Para llevar siempre exige turno en RPC; en mesa los admins pueden pasar sin turno según create_additional_dine_in_order. */
  const shiftOkForSiblingOrder =
    shiftOpen ||
    ((!isTakeoutOrder && !isExtraOrder) && (canManageOrders || isGlobalAdmin));
  const orderGroupLabel = isExpressOrder ? "Express" : isExtraOrder ? "Extra" : isTakeoutOrder ? "Para Llevar" : "mesa";

  const isEditableInCaja =
    order.status === "SENT_TO_KITCHEN" ||
    (activeWorkflowMode === "DISPATCH_THEN_CASH" &&
      (order.order_type === "DINE_IN" || order.order_type === "EXTRA" || order.is_special) &&
      order.status !== "PAID" &&
      order.status !== "CANCELLED");
  const isEditableInEditar =
    order.status === "SENT_TO_KITCHEN" ||
    order.status === "READY" ||
    order.status === "KITCHEN_DISPATCHED";
  const isLockedFromEditar = fromEditar && !isEditableInEditar;

  const hasDispatchedItems = itemsToUse.some((item) => Number(item.quantity_dispatched ?? 0) > 0 || item.status === "DISPATCHED");
  const editableItemIdsForEditar = useMemo(
    () =>
      fromEditar && isDispatchFirstFlow
        ? stagedItems.filter(isOrderItemEditableInDispatchFirstEditMode).map((item) => item.id)
        : [],
    [fromEditar, isDispatchFirstFlow, stagedItems],
  );
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
    ((order.order_type === "DINE_IN" && !!order.table_id) || isBranchSiblingOrder) &&
    order.status !== "CANCELLED" &&
    !isLockedFromEditar &&
    orderItems.length > 0 &&
    shiftOkForSiblingOrder;
  const canDeleteSplit =
    canOperateOrders &&
    hasSiblings &&
    order.order_type === "DINE_IN" &&
    !!order.table_id &&
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
    !order.paid_at &&
    !isLockedFromEditar &&
    hasSentItems;
  const sentItems = itemsToUse.filter((item) => item.status !== "DRAFT");
  const hasPaidItems = sentItems.some(isPaidItem);
  const isCajaItem = (item: typeof itemsToUse[number]) =>
    item.status !== "DRAFT" &&
    Number(item.quantity_dispatched ?? 0) <= 0 &&
    item.status !== "DISPATCHED" &&
    !hasPendingCancellationItems &&
    !isPaidItem(item);
  const canDeleteByItemState = hasOrderItems && itemsToUse.every((item) => item.status === "DRAFT" || isCajaItem(item));
  const canCancelOrderFromCaja =
    canCancelOrders &&
    canDeleteByItemState &&
    !hasPendingCancellationItems &&
    !hasTemporaryDraftItems &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !fromEditar;

  const allSentItemsDispatched = itemsToUse
    .filter((item) => item.status !== "DRAFT")
    .every((item) => Number(item.quantity_remaining ?? 0) <= 0);
  const canCloseOrder = canShowCloseOrder && !hasDraftItems && !hasPendingCancellationItems && allSentItemsDispatched;
  const isClosedForPayment =
    order.order_type === "DINE_IN" &&
    !order.is_special &&
    !!order.table_id &&
    order.status === "KITCHEN_DISPATCHED";

  const hasEditableOrderSurface =
    isBranchSiblingOrder ||
    Boolean(order.is_special) ||
    (order.order_type === "DINE_IN" && Boolean(order.table_id));
  const canEditDraftOrder =
    !fromEditar &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    hasEditableOrderSurface &&
    (
      order.status === "DRAFT" ||
      hasDraftItems ||
      !hasSentItems ||
      /**
       * Mesa: permite nuevas líneas (borrador) también en "En caja" y estados posteriores hasta pagar.
       * Para llevar en caja sin borradores y con líneas enviadas, no aplica esta rama y queda deshabilitado
       * (no `hasDraftItems` ni `!hasSentItems`).
       */
      (order.order_type === "DINE_IN" && Boolean(order.table_id))
    );
  const canEnterEditMode =
    !fromEditar &&
    canUseEditarOrden &&
    (isDispatchFirstFlow
      ? (hasDispatchedItems && isEditableInEditar)
      : isEditableInCaja) &&
    !hasPendingCancellationItems &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED";
  const showDispatchEditOrderAction =
    !fromEditar &&
    isDispatchFirstFlow &&
    hasDispatchedItems &&
    canUseEditarOrden &&
    isEditableInEditar &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED";
  const canEditItems =
    (fromEditar && isEditableInEditar) ||
    (
      (canOperateOrders || canUseEditarOrden) &&
      (canEditDraftOrder || isEditableInCaja) &&
      !hasPendingCancellationItems &&
      !isLockedFromEditar
    );
  const handleSelectMenuProduct = async (node: MenuNode) => {
    if (!canEditItems) {
      toast.error("Esta orden no admite agregar productos.");
      return;
    }
    if (!activeBranchId) {
      toast.error("No hay sucursal activa. Selecciona una sucursal e intenta de nuevo.");
      return;
    }
    if (hasPendingCancellationItems && !fromEditar) {
      toast.error("No puedes agregar items mientras exista al menos un item con anulacion pendiente.");
      return;
    }

    const selectSeq = ++productSelectSeqRef.current;
    setSelectingProductId(node.id);
    try {
      const catalog = await qc.fetchQuery({
        queryKey: ["branch-modifiers-catalog", activeBranchId],
        queryFn: () => fetchBranchModifiersCatalog(activeBranchId!),
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
      });
      const initialModifiers = buildModifiersForProductNode(node, catalog);

      if (selectSeq !== productSelectSeqRef.current) return;

      setSelectedProduct(null);
      setSelectedProductModifiers(initialModifiers);
      setSelectedProductRootName(resolveRootCategoryName(node, scopeCompositeMenuQuery.data ?? null));
      setProductLoadingShell(buildProductLoadingShell(node, isTrayOrder, effectiveTrayType));

      const lookup = await fetchMenuProductLookup({
        branchId: activeBranchId,
        node,
        isTrayOrder,
        trayType: effectiveTrayType,
        catalog,
      });

      if (selectSeq !== productSelectSeqRef.current) return;

      setSelectedProduct(lookup.product);
      setSelectedProductModifiers(lookup.modifiers);
      setProductLoadingShell(null);
    } catch (error: any) {
      if (selectSeq !== productSelectSeqRef.current) return;
      toast.error(error?.message || "No se pudo cargar el producto seleccionado.");
      setSelectedProduct(null);
      setSelectedProductRootName(null);
      setProductLoadingShell(null);
    } finally {
      if (selectSeq === productSelectSeqRef.current) {
        setSelectingProductId(null);
      }
    }
  };
  const canShowConvertToSpecial =
    canOperateOrders &&
    order.order_type === "DINE_IN" &&
    (!order.is_special || isMixedSpecial) &&
    !!order.table_id &&
    order.status !== "PAID" &&
    order.status !== "CANCELLED" &&
    !fromEditar;
  const canConvertToSpecial = canShowConvertToSpecial && hasDispatchedItems;
  /** Mixta ya convertida: la accion pasa a ser "Editar orden especial". */
  const convertSpecialActionLabel = isMixedSpecial ? "Editar orden especial" : "Convertir orden especial";
  const tableWatermark =
    order.is_tray_order
      ? "ORDEN BANDEJA"
      : order.is_special
      ? "ORDEN ESPECIAL"
      : order.order_type === "DINE_IN"
        ? (order.table_name ?? "").trim()
        : isExpressOrder
          ? "EXPRESS"
          : isExtraOrder
            ? "EXTRA"
            : "PARA LLEVAR";
  const statusLabel: Record<string, string> = {
    DRAFT: getOrderStatusLabel("DRAFT", order.order_type, null, order.paid_at),
    SENT_TO_KITCHEN: getOrderStatusLabel("SENT_TO_KITCHEN", order.order_type, null, order.paid_at),
    READY: getOrderStatusLabel("READY", order.order_type, null, order.paid_at),
    KITCHEN_DISPATCHED: getOrderStatusLabel("KITCHEN_DISPATCHED", order.order_type, null, order.paid_at),
    PAID: getOrderStatusLabel("PAID", order.order_type, null, order.paid_at),
    CANCELLED: getOrderStatusLabel("CANCELLED", order.order_type, null, order.paid_at),
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
    if (!user || !canOperateOrders) return;
    if (!((order.order_type === "DINE_IN" && order.table_id) || isBranchSiblingOrder)) return;
    if (order.status === "CANCELLED") return;
    if (orderItems.length <= 0) {
      toast.error("La orden actual debe tener al menos un item");
      return;
    }
    if (!shiftOkForSiblingOrder) {
      toast.error("Abre turno en caja para crear otra orden.");
      return;
    }
    setSplitting(true);
    try {
      let newOrderId: string;
      const nowIso = new Date().toISOString();
      if (isExpressOrder) {
        const { data, error } = await supabase.rpc("create_express_order" as any, {
          p_branch_id: order.branch_id,
          p_created_by: user.id,
        } as any);
        if (error) throw error;
        newOrderId = String(data);
      } else if (isExtraOrder) {
        const { data, error } = await supabase.rpc("create_extra_order" as any, {
          p_branch_id: order.branch_id,
          p_created_by: user.id,
        } as any);
        if (error) throw error;
        newOrderId = String(data);
      } else if (isTakeoutOrder) {
        const { data, error } = await supabase.rpc("create_takeout_order" as any, {
          p_branch_id: order.branch_id,
          p_created_by: user.id,
        } as any);
        if (error) throw error;
        newOrderId = String(data);
      } else {
        newOrderId = await createTableOrder.mutateAsync();
      }

      if (!newOrderId || newOrderId === "null") {
        throw new Error("No se pudo crear la nueva orden");
      }

      if (isExpressOrder) {
        qc.setQueryData(
          ["express-orders", order.branch_id],
          [
            ...tableOrders,
            {
              id: newOrderId,
              order_number: null,
              order_code: null,
              status: "DRAFT",
              split_code: null,
              table_order_position: tableOrders.length + 1,
              item_count: 0,
              created_at: nowIso,
            },
          ].sort(compareSiblingOrderTabs),
        );
      } else if (isExtraOrder) {
        qc.setQueryData(
          ["extra-orders", order.branch_id],
          [
            ...tableOrders,
            {
              id: newOrderId,
              order_number: null,
              order_code: null,
              status: "DRAFT",
              split_code: null,
              table_order_position: tableOrders.length + 1,
              item_count: 0,
              created_at: nowIso,
            },
          ].sort(compareSiblingOrderTabs),
        );
      } else if (isTakeoutOrder) {
        qc.setQueryData(
          ["takeout-orders", order.branch_id],
          [
            ...tableOrders,
            {
              id: newOrderId,
              order_number: null,
              order_code: null,
              status: "DRAFT",
              split_code: null,
              table_order_position: tableOrders.length + 1,
              item_count: 0,
              created_at: nowIso,
            },
          ].sort(compareSiblingOrderTabs),
        );
      } else if (order.table_id) {
        qc.setQueryData(
          ["table-orders", order.table_id],
          [
            ...tableOrders,
            {
              id: newOrderId,
              order_number: null,
              order_code: null,
              status: "DRAFT",
              split_code: null,
              table_order_position: tableOrders.length + 1,
              item_count: 0,
              created_at: nowIso,
            },
          ].sort(compareSiblingOrderTabs),
        );
      }
      if (!isTakeoutOrder && !isExtraOrder) {
        const newSibling: SiblingOrder = {
          id: newOrderId,
          order_number: null,
          order_code: null,
          status: "DRAFT",
          split_code: null,
          table_order_position: mergedTableOrders.length + 1,
          item_count: 0,
          created_at: nowIso,
        };
        seedDineInDraftOrderCache(qc, newOrderId, {
          branchId: order.branch_id,
          tableId: order.table_id!,
          tableName: order.table_name,
          createdAt: nowIso,
          tableOrderPosition: mergedTableOrders.length + 1,
          siblings: [...mergedTableOrders, newSibling].sort(compareSiblingOrderTabs),
        });
      }
      void qc.prefetchQuery({
        queryKey: getOrderQueryKey(newOrderId),
        queryFn: () => fetchOrderDetail(newOrderId),
        staleTime: 15_000,
        gcTime: 10 * 60_000,
      });
      navigate(`/ordenes?order=${newOrderId}${sourceParamsNoMesaCards}`, { replace: true });

      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      if (isExpressOrder) {
        qc.invalidateQueries({ queryKey: ["express-orders", order.branch_id] });
      } else if (isExtraOrder) {
        qc.invalidateQueries({ queryKey: ["extra-orders", order.branch_id] });
      } else if (isTakeoutOrder) {
        qc.invalidateQueries({ queryKey: ["takeout-orders", order.branch_id] });
      }
    } catch (err: any) {
      const rawMessage = String(err?.message ?? "");

      if (rawMessage.includes("Todas las ordenes activas de la mesa deben tener al menos un item")) {
        toast.error(
          "Hay una cuenta en borrador sin productos en esta mesa. Agrega ítems o elimina esa cuenta antes de abrir otra.",
        );
        if (order.table_id) {
          void fetchSiblingOrders(order.table_id, order.branch_id, order.id).then((rows) => {
            qc.setQueryData(["table-orders", order.table_id], rows);
          });
        }
        return;
      }

      if (rawMessage.includes("No hay turno abierto")) {
        toast.error("No hay turno abierto en esta sucursal.");
        return;
      }

      if (rawMessage.includes("No se encontro la orden origen")) {
        try {
          const refreshedTableOrders = await fetchSiblingOrders(order.table_id, order.branch_id, order.id);
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
          navigate(mesasListPathForOrigin(origin), { replace: true });
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
        navigate(mesasListPathForOrigin(origin), { replace: true });
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
        navigate(mesasListPathForOrigin(origin), { replace: true });
      },
    });
  };

  /** Navega tras cerrar el dropdown; navegar dentro del item deja body con pointer-events:none. */
  const navigateToEditarOrdenAfterMenuClose = () => {
    setTimeout(() => {
      navigate(`/ordenes?order=${order!.id}&from=editar${originParam}`);
    }, 0);
  };

  /** Evita cuelgues silenciosos: si un paso supera el tiempo, falla indicando cuál fue. */
  const runEditStep = async <T,>(stepName: string, action: () => Promise<T>): Promise<T> => {
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error(`Se agoto el tiempo en el paso: ${stepName}.`)),
        20000,
      );
    });
    try {
      return await Promise.race([action(), timeout]);
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const handleAcceptEditedOrderChanges = async () => {
    if (acceptingEditChanges) return;
    setAcceptingEditChanges(true);
    const progressToastId = toast.loading("Aplicando cambios de la orden...");
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

      // Snapshot orderItems BEFORE any mutations to prevent temp IDs injected
      // by optimistic updates from leaking into DB calls later.
      const originalOrderItems = [...orderItems];
      const originalIds = new Set(originalOrderItems.map((item) => item.id));
      const stagedIds = new Set(stagedItems.map((item) => item.id));

      // Create new items and capture the generated ids so we can dispatch them immediately.
      const toAdd = stagedItems.filter((item) => !originalIds.has(item.id));
      const newAddedIds: { order_item_id: string; quantity_dispatched: number }[] = [];

      for (const item of toAdd) {
        const resolvedMenuNodeId = await runEditStep("buscar producto en menu", () =>
          resolveMissingMenuNodeId(item as {
            product_id?: string;
            menu_node_id?: string | null;
            tray_item_type?: "A" | "B" | "C" | null;
          }),
        );

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

        const preAddItems = await runEditStep("leer items actuales", async () =>
          supabase.from("order_items").select("id").eq("order_id", orderId),
        );
        await runEditStep("agregar producto nuevo", () => addItem.mutateAsync(reqData));

        const postAddItems = await runEditStep("leer items actualizados", async () =>
          supabase.from("order_items").select("id").eq("order_id", orderId),
        );
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
        await runEditStep("quitar borrador descartado", () => removeItem.mutateAsync(item.id));
      }

      // Persist quantity updates for existing items.
      for (const staged of stagedItems) {
        if (!originalIds.has(staged.id)) continue;

        const original = originalOrderItems.find((item) => item.id === staged.id);
        if (!original) continue;

        const originalQuantity = Number(original.quantity ?? 0);
        const stagedQuantity = Number(staged.quantity ?? 0);
        const priceChanged = Number(staged.unit_price) !== Number(original.unit_price);

        if (original.status === "DRAFT") {
          if (originalQuantity !== stagedQuantity || priceChanged) {
            await runEditStep("actualizar cantidad de borrador", () =>
              updateQuantity.mutateAsync({
                itemId: staged.id,
                quantity: stagedQuantity,
                unit_price: staged.unit_price,
              }),
            );
          }
        } else {
          if (stagedQuantity > originalQuantity) {
            const diffQty = stagedQuantity - originalQuantity;
            const resolvedMenuNodeId = await runEditStep("buscar producto en menu", () =>
              resolveMissingMenuNodeId(staged as any),
            );
            await runEditStep("agregar aumento de cantidad", () => addItem.mutateAsync({
              product_id: staged.product_id,
              menu_node_id: resolvedMenuNodeId,
              description_snapshot: staged.description_snapshot,
              item_note: staged.item_note ?? null,
              unit_price: staged.unit_price,
              quantity: diffQty,
              modifier_ids: staged.modifiers.map((modifier) => modifier.modifier_id).filter(Boolean) as string[],
              tray_item_type: staged.tray_item_type as "A" | "B" | "C" | undefined,
              tray_container_cost: staged.tray_container_cost ?? 0,
            }));
          }
          if (priceChanged) {
            await runEditStep("actualizar precio", () =>
              updateQuantity.mutateAsync({
                itemId: staged.id,
                quantity: originalQuantity,
                unit_price: staged.unit_price,
              }),
            );
          }
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

      let cancellationBecameRequest = false;
      if (cancellationSelections.length > 0 && user) {
        // Always use "partial" cancellation when accepting edit changes.
        // Even if all items are removed, we do NOT auto-cancel the order so
        // the user stays on the order page and can add new products.
        const cancellationResult = await runEditStep("registrar anulacion de despachados", () =>
          cancelOrderMutation.mutateAsync({
            orderId,
            items: cancellationSelections,
            userId: user.id,
            cancellationType: "partial",
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
          }),
        );
        cancellationBecameRequest = Boolean((cancellationResult as { isRequest?: boolean })?.isRequest);
      }

      await runEditStep("desbloquear la orden", () => unlockOrder.mutateAsync());
      setStagedDirty(false);
      if (cancellationBecameRequest) {
        toast.warning(
          "Tu usuario no puede anular despachados directamente: la reduccion quedo como solicitud pendiente de autorizacion.",
          { duration: 8000 },
        );
      } else {
        toast.success("Cambios aceptados.");
      }
      if (orderId) {
        void qc.invalidateQueries({ queryKey: getOrderQueryKey(orderId) });
      }
      // Always navigate back to the order page after accepting changes.
      // This keeps the user on the order (with menu enabled) even when all
      // items were removed, so they can add new products without leaving.
      const originValue = searchParams.get("origin") || "consulta";
      navigate(`/ordenes?order=${orderId}&from=${originValue}${originParam}`, { replace: true });
    } catch (error: any) {
      toast.error(error?.message || "No se pudieron aplicar los cambios.");
    } finally {
      toast.dismiss(progressToastId);
      setAcceptingEditChanges(false);
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

  const saveSpecialTotalSilently = (value: string) => {
    const rawValue = value.trim().replace(",", ".");
    if (!rawValue) {
      updateSpecialTotal.mutate(null);
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }

    updateSpecialTotal.mutate(Math.round(parsed * 100) / 100);
  };

  const flushPendingSpecialTotalSave = async () => {
    if (!order?.is_special) return;

    if (specialTotalDebounceTimeoutRef.current) {
      clearTimeout(specialTotalDebounceTimeoutRef.current);
      specialTotalDebounceTimeoutRef.current = null;
    }

    const rawValue = specialTotalInput.trim().replace(",", ".");
    if (!rawValue) {
      await updateSpecialTotal.mutateAsync(null);
      return;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) return;

    await updateSpecialTotal.mutateAsync(Math.round(parsed * 100) / 100);
  };

  const handleSpecialTotalInputChange = (val: string) => {
    setSpecialTotalInput(val);

    if (specialTotalDebounceTimeoutRef.current) {
      clearTimeout(specialTotalDebounceTimeoutRef.current);
    }

    specialTotalDebounceTimeoutRef.current = setTimeout(() => {
      saveSpecialTotalSilently(val);
    }, 400);
  };

  const handleSaveSpecialTotal = () => {
    if (specialTotalDebounceTimeoutRef.current) {
      clearTimeout(specialTotalDebounceTimeoutRef.current);
    }

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

  const saveSpecialGroupValue = async (value: number) => {
    if (!orderId) return;
    try {
      const { error } = await (supabase as any).rpc("actualizar_valor_grupo_especial", {
        p_order_id: orderId,
        p_group_total: value,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["order"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      await qc.invalidateQueries({ queryKey: ["payable-orders"] });
      await qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      await qc.invalidateQueries({ queryKey: ["table-orders"] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar el valor especial");
    }
  };

  const handleSpecialGroupInputChange = (val: string) => {
    setSpecialGroupInput(val);
    if (specialGroupDebounceTimeoutRef.current) {
      clearTimeout(specialGroupDebounceTimeoutRef.current);
    }
    const raw = val.trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0) return;
    specialGroupDebounceTimeoutRef.current = setTimeout(() => {
      void saveSpecialGroupValue(Math.round(n * 100) / 100);
    }, 600);
  };

  const handleSaveSpecialGroup = () => {
    if (specialGroupDebounceTimeoutRef.current) {
      clearTimeout(specialGroupDebounceTimeoutRef.current);
    }
    const raw = specialGroupInput.trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0) {
      toast.error("Ingresa un valor especial valido");
      return;
    }
    void saveSpecialGroupValue(Math.round(n * 100) / 100).then(() =>
      toast.success("Valor del grupo especial actualizado"),
    );
  };

  const handleConvertToSpecial = async (params: {
    qtyByItemId: Record<string, number>;
    specialTotal: number;
    specialReason: string;
  }) => {
    if (!orderId || !order) {
      const msg = "No se encontro la orden a convertir";
      toast.error(msg);
      throw new Error(msg);
    }
    if (convertingToSpecial) {
      throw new Error("Ya hay una conversion en curso");
    }

    const itemsPayload = Object.entries(params.qtyByItemId)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([order_item_id, cantidad]) => ({
        order_item_id,
        cantidad: Math.floor(Number(cantidad)),
      }));

    const revertingToNormal = isMixedSpecial && itemsPayload.length === 0;
    if (itemsPayload.length === 0 && !revertingToNormal) {
      const msg = "Selecciona al menos una unidad despachada";
      toast.error(msg);
      throw new Error(msg);
    }

    setConvertingToSpecial(true);
    try {
      const { data, error } = await (supabase as any).rpc("convertir_orden_especial_parcial", {
        p_order_id: orderId,
        p_items: itemsPayload,
        p_group_total: params.specialTotal,
        p_reason: params.specialReason.trim() || null,
      });
      if (error) {
        const msg = [error.message, error.details, error.hint].filter(Boolean).join(" — ");
        throw new Error(msg || "No se pudo convertir la orden a especial");
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error("No se pudo convertir la orden a especial");

      setConvertSpecialDialogOpen(false);
      if (revertingToNormal) {
        toast.success("La orden volvió a ser una orden normal.");
      } else if (isMixedSpecial) {
        toast.success("Orden especial actualizada.");
      } else {
        toast.success("Orden convertida en especial. El grupo especial usa el valor manual y el resto conserva su precio real.");
      }

      await qc.invalidateQueries({ queryKey: ["order"] });
      await qc.invalidateQueries({ queryKey: ["orders"] });
      await qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      await qc.invalidateQueries({ queryKey: ["table-orders"] });
      await qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
      await qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      await qc.invalidateQueries({ queryKey: ["payable-orders"] });
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo convertir a especial");
      throw err;
    } finally {
      setConvertingToSpecial(false);
    }
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

  const frequentProductCardsPanel =
    frequentProductContext != null ? (
      <FrequentProductCards
        context={frequentProductContext}
        onSelectProduct={handleSelectMenuProduct}
        disabled={!canEditItems}
      />
    ) : null;

  const menuPanel = (
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
                    if (!canEditItems) return;
                    setPendingTrayType(option.value);
                    setSelectedProduct(null);
                    setSelectedProductRootName(null);
                    setProductLoadingShell(null);
                  }}
                  disabled={!canEditItems}
                  aria-pressed={checked}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold transition sm:gap-2 sm:text-sm",
                    !canEditItems && "cursor-not-allowed opacity-60",
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

      {frequentProductContext === "MESA" ? frequentProductCardsPanel : null}

      {showMenuScopeTabs ? (
        <div className="scrollbar-none -mx-1 overflow-x-auto px-1 pb-0.5">
          <Tabs
            value={interactiveMenuScope}
            onValueChange={(value) => {
              if (!canEditItems) return;
              const nextScope = value as MenuScope;
              if (interactiveMenuScope === nextScope) return;

              if (nextScope === "BULK") {
                setPendingMenuScopeSelection("BULK");
                return;
              }

              if (isTakeoutMenuOrder) {
                setPendingMenuScopeSelection("TAKEOUT");
                return;
              }

              setPendingMenuScopeSelection(nextScope);
              updateMenuScope.mutate(nextScope, {
                onError: () => setPendingMenuScopeSelection(null),
              });
            }}
          >
            <TabsList className="h-auto min-w-max justify-start gap-1 rounded-[24px] border-amber-200 bg-gradient-to-r from-amber-50 via-white to-yellow-50 p-1.5">
              {menuScopeOptions.map((option) => (
                <TabsTrigger
                  key={option.value}
                  value={option.value}
                  disabled={!canEditItems || updateMenuScope.isPending}
                  className={option.className}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      ) : null}
      {frequentProductContext != null && frequentProductContext !== "MESA" ? frequentProductCardsPanel : null}
      <MenuNavigator
        menuScope={currentMenuScope}
        nodesOverride={currentMenuScope === "TAKEOUT" || currentMenuScope === "BULK" ? scopeCompositeMenuQuery.data ?? null : null}
        forceLoading={(currentMenuScope === "TAKEOUT" || currentMenuScope === "BULK") && scopeCompositeMenuQuery.isLoading}
        excludedRootCategoryNames={isExtraOrder ? ["PLATOS"] : undefined}
        trayMode={isTrayOrder && effectiveTrayType === "C"}
        disabled={!canEditItems}
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
  );

  const orderPanel = (mobile: boolean) => (
    <div className={cn("flex w-full min-w-0 flex-col", mobile ? "min-h-0" : "h-auto")}>
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
        {order.is_special && !isMixedSpecial && (
          <div className="mb-4 rounded-[24px] border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 shadow-[0_18px_42px_-30px_rgba(249,115,22,0.35)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-base font-black text-foreground">Orden Especial</p>
              </div>
              <Badge variant="outline" className="border-orange-300 bg-white/90 text-orange-800">
                Cobro manual
              </Badge>
            </div>



            {canEditItems ? (
              <div className="mt-4">
                <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Total Manual</label>
                <Input
                  inputMode="decimal"
                  value={specialTotalInput}
                  onChange={(event) => handleSpecialTotalInputChange(sanitizeDecimalInput(event.target.value))}
                  onBlur={handleSaveSpecialTotal}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSaveSpecialTotal();
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Ingresa el total manual"
                  className="h-11 rounded-xl mt-1"
                />
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-white/70 px-3 py-2 text-xs text-muted-foreground">
                Solo consulta: el total especial se administra desde una sesion con permisos operativos.
              </div>
            )}
          </div>
        )}


        {isMixedSpecial && !fromEditar && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="w-fit rounded-lg bg-orange-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-orange-800">
                  Orden especial
                </h3>
                <span className="text-[11px] font-medium text-muted-foreground">Valor manual</span>
              </div>
              <div className="flex flex-col gap-2">
                {specialBreakdown.especialLines.map((l) => (
                  <div
                    key={`esp-${l.item.id}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-orange-100 bg-white px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-orange-100 px-1.5 text-xs font-bold text-orange-800">
                        {l.especialQty}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">{l.item.description_snapshot}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground line-through">${l.especialRealTotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-dashed border-border pt-1.5">
                <span className="text-sm font-semibold text-foreground">Subtotal especial</span>
                <span className="font-display text-base font-black text-foreground">${specialGroupValueNum.toFixed(2)}</span>
              </div>
            </div>

            {mixedRestoItems.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="w-fit rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-700">
                  Orden normal
                </h3>
                <OrderItemsList
                  items={mixedRestoItems}
                  orderType={order.order_type}
                  isSpecialOrder={false}
                  alwaysShowControls={false}
                  allowSentStageEditing={isDispatchFirstFlow && canEditItems}
                  splitDispatchSections={isDispatchFirstFlow}
                  editDispatchedItemsOnly={false}
                  hideItemControls={false}
                  hideFooterTotals
                  specialOrderChargeTotal={null}
                  specialOrderCatalogTotal={null}
                  onRemove={(id) => {
                    const ids = Array.isArray(id) ? id : [id];
                    if (useKitchenStaging) {
                      const draftIds: string[] = [];
                      const sentIds: string[] = [];
                      for (const itemId of ids) {
                        const item = stagedItems.find((i) => i.id === itemId);
                        if (!item) continue;
                        if (item.status === "DRAFT") draftIds.push(itemId);
                        else sentIds.push(itemId);
                      }

                      if (sentIds.length > 0) {
                        setStagedDirty(true);
                        setStagedItems((prev) => {
                          const next = [...prev];
                          for (const itemId of sentIds) {
                            const idx = next.findIndex((i) => i.id === itemId);
                            if (idx < 0) continue;
                            const especialQty = especialQtyByItemId[itemId] ?? 0;
                            if (especialQty > 0) {
                              const unit = Number(next[idx].unit_price ?? 0);
                              next[idx] = {
                                ...next[idx],
                                quantity: especialQty,
                                total: Math.round(especialQty * unit * 100) / 100,
                              };
                            } else {
                              next[idx] = { ...next[idx], quantity: 0, total: 0 };
                            }
                          }
                          return next;
                        });
                      }

                      if (draftIds.length > 0) {
                        const draftIdSet = new Set(draftIds);
                        const removedSnapshots = stagedItems.filter((i) => draftIdSet.has(i.id));
                        setStagedItems((prev) => prev.filter((i) => !draftIdSet.has(i.id)));
                        setKitchenBaselineItems((prev) => prev.filter((i) => !draftIdSet.has(i.id)));
                        void (async () => {
                          try {
                            for (const itemId of draftIds) {
                              await removeItem.mutateAsync(itemId);
                            }
                          } catch {
                            setStagedItems((prev) => {
                              const present = new Set(prev.map((i) => i.id));
                              const missing = removedSnapshots.filter((i) => !present.has(i.id));
                              return missing.length === 0 ? prev : [...prev, ...missing];
                            });
                            setKitchenBaselineItems((prev) => {
                              const present = new Set(prev.map((i) => i.id));
                              const missing = removedSnapshots.filter((i) => !present.has(i.id));
                              return missing.length === 0 ? prev : [...prev, ...missing];
                            });
                          }
                        })();
                      }
                      return;
                    }

                    void (async () => {
                      for (const itemId of ids) {
                        const especialQty = especialQtyByItemId[itemId] ?? 0;
                        if (especialQty > 0) {
                          const item = itemsToUse.find((i) => i.id === itemId);
                          await updateQuantity.mutateAsync({
                            itemId,
                            quantity: especialQty,
                            unit_price: Number(item?.unit_price ?? 0),
                          });
                        } else {
                          await removeItem.mutateAsync(itemId);
                        }
                      }
                    })();
                  }}
                  onUpdateQty={(id, qty, price) => {
                    const especialQty = especialQtyByItemId[id] ?? 0;
                    const fullQty = especialQty + Math.max(0, qty);

                    if (useKitchenStaging) {
                      const stagedItem = stagedItems.find((i) => i.id === id);
                      const nextTotal =
                        fullQty * price + (fullQty > 0 ? (stagedItem?.tray_container_cost ?? 0) : 0);
                      const patchItem = <T extends { id: string; quantity: number; unit_price: number; total: number; tray_container_cost?: number | null }>(
                        list: T[],
                      ) =>
                        list.map((i) =>
                          i.id === id
                            ? {
                                ...i,
                                quantity: fullQty,
                                unit_price: price,
                                total: nextTotal,
                              }
                            : i,
                        );

                      if (stagedItem?.status === "DRAFT") {
                        setStagedItems(patchItem);
                        setKitchenBaselineItems(patchItem);
                        updateQuantity.mutate({ itemId: id, quantity: fullQty, unit_price: price });
                        return;
                      }

                      setStagedDirty(true);
                      setStagedItems(patchItem);
                      return;
                    }

                    updateQuantity.mutate({ itemId: id, quantity: fullQty, unit_price: price });
                  }}
                  onRequestCancel={handleRequestInlineCancel}
                  disableDraftEditing={!canEditItems}
                  disableOperationalCancel={order.status === "PAID"}
                />
                <div className="flex items-center justify-between border-t border-dashed border-border pt-1.5">
                  <span className="text-sm font-semibold text-foreground">Subtotal orden normal</span>
                  <span className="font-display text-base font-black text-foreground">
                    ${specialBreakdown.restRealTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1 border-t border-border pt-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">Total a cobrar</span>
                <span className="font-display text-xl font-black text-orange-700">${mixedGeneralTotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Total real de referencia</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {!(isMixedSpecial && !fromEditar) && (
        <OrderItemsList
          items={(fromEditar || useKitchenStaging) ? stagedItems : orderItems}
          orderType={order.order_type}
          isSpecialOrder={Boolean(order?.is_special)}
          alwaysShowControls={fromEditar && !isDispatchFirstFlow}
          allowSentStageEditing={isDispatchFirstFlow && !fromEditar && canEditItems}
          splitDispatchSections={isDispatchFirstFlow}
          editDispatchedItemsOnly={fromEditar && isDispatchFirstFlow}
          hideItemControls={false}
          editableItemIds={editableItemIdsForEditar}
          specialOrderChargeTotal={order.is_special && effectiveSpecialTotalManual != null ? effectiveSpecialTotalManual : null}
          specialOrderCatalogTotal={order.is_special && effectiveSpecialTotalManual != null ? total : null}
          onRemove={(id) => {
            const ids = Array.isArray(id) ? id : [id];

            // Modo editar (Caja primero): cambios locales hasta aceptar.
            if (fromEditar) {
              setStagedDirty(true);
              setStagedItems((prev) => {
                const next = [...prev];
                for (const itemId of ids) {
                  const item = next.find((i) => i.id === itemId);
                  if (!item) continue;
                  if (item.status !== "DRAFT") {
                    const idx = next.findIndex((i) => i.id === itemId);
                    if (idx >= 0) {
                      next[idx] = { ...next[idx], quantity: 0, total: 0 };
                    }
                  } else {
                    const idx = next.findIndex((i) => i.id === itemId);
                    if (idx >= 0) next.splice(idx, 1);
                  }
                }
                return next;
              });
              return;
            }

            // Mesa / despacho primero: borradores se persisten al instante (como para llevar);
            // lineas ya enviadas quedan pendientes hasta "Enviar a cocina".
            if (useKitchenStaging) {
              const draftIds: string[] = [];
              const sentIds: string[] = [];
              for (const itemId of ids) {
                const item = stagedItems.find((i) => i.id === itemId);
                if (!item) continue;
                if (item.status === "DRAFT") draftIds.push(itemId);
                else sentIds.push(itemId);
              }

              if (sentIds.length > 0) {
                setStagedDirty(true);
                setStagedItems((prev) => {
                  const next = [...prev];
                  for (const itemId of sentIds) {
                    const idx = next.findIndex((i) => i.id === itemId);
                    if (idx >= 0) {
                      next[idx] = { ...next[idx], quantity: 0, total: 0 };
                    }
                  }
                  return next;
                });
              }

              if (draftIds.length > 0) {
                const draftIdSet = new Set(draftIds);
                const removedSnapshots = stagedItems.filter((i) => draftIdSet.has(i.id));
                setStagedItems((prev) => prev.filter((i) => !draftIdSet.has(i.id)));
                setKitchenBaselineItems((prev) => prev.filter((i) => !draftIdSet.has(i.id)));
                void (async () => {
                  try {
                    for (const itemId of draftIds) {
                      await removeItem.mutateAsync(itemId);
                    }
                  } catch {
                    // removeItem ya restaura el cache de la orden; reponer staging/baseline.
                    setStagedItems((prev) => {
                      const ids = new Set(prev.map((i) => i.id));
                      const missing = removedSnapshots.filter((i) => !ids.has(i.id));
                      return missing.length === 0 ? prev : [...prev, ...missing];
                    });
                    setKitchenBaselineItems((prev) => {
                      const ids = new Set(prev.map((i) => i.id));
                      const missing = removedSnapshots.filter((i) => !ids.has(i.id));
                      return missing.length === 0 ? prev : [...prev, ...missing];
                    });
                  }
                })();
              }
              return;
            }

            void (async () => {
              for (const itemId of ids) {
                await removeItem.mutateAsync(itemId);
              }
            })();
          }}
          onUpdateQty={(id, qty, price) => {
            if (fromEditar) {
              setStagedDirty(true);
              setStagedItems((prev) =>
                prev.map((i) =>
                  i.id === id
                    ? {
                      ...i,
                      quantity: qty,
                      unit_price: price,
                      total: qty * price + (qty > 0 ? (i.tray_container_cost ?? 0) : 0),
                    }
                    : i
                )
              );
              return;
            }

            if (useKitchenStaging) {
              const stagedItem = stagedItems.find((i) => i.id === id);
              const nextTotal = qty * price + (qty > 0 ? (stagedItem?.tray_container_cost ?? 0) : 0);
              const patchItem = <T extends { id: string; quantity: number; unit_price: number; total: number; tray_container_cost?: number | null }>(
                items: T[],
              ) =>
                items.map((i) =>
                  i.id === id
                    ? {
                      ...i,
                      quantity: qty,
                      unit_price: price,
                      total: nextTotal,
                    }
                    : i
                );

              // Borradores: persistir ya (misma regla que para llevar / agregar producto).
              if (stagedItem?.status === "DRAFT") {
                setStagedItems(patchItem);
                setKitchenBaselineItems(patchItem);
                updateQuantity.mutate({ itemId: id, quantity: qty, unit_price: price });
                return;
              }

              setStagedDirty(true);
              setStagedItems(patchItem);
              return;
            }

            updateQuantity.mutate({ itemId: id, quantity: qty, unit_price: price });
          }}
          onRequestCancel={fromEditar ? undefined : handleRequestInlineCancel}
          disableDraftEditing={!canEditItems}
          disableOperationalCancel={order.status === "PAID"}
        />
        )}
      </div>

      {!fromEditar && canOperateOrders && showKitchenSendButton && order.status !== "PAID" && order.status !== "CANCELLED" && (
        <div className={cn("mt-4 shrink-0", mobile && "footer-safe-bottom sticky bottom-0 z-10 -mx-1 bg-background/95 px-1 pt-2 backdrop-blur-sm")}>
        <Button
          onClick={async () => {
            try {
              setSendingKitchenChanges(true);
              if (order.is_special) {
                await flushPendingSpecialTotalSave();
              }

              const hadKitchenPending = useKitchenStaging && hasPendingKitchenChanges;
              if (hadKitchenPending) {
                // Si este paso falla, los borradores quedarian sin enviarse: avisar siempre.
                try {
                  await applyKitchenPendingItemChanges(orderId!, orderItems, stagedItems);
                } catch (error: any) {
                  toast.error(
                    `No se pudieron aplicar los cambios antes de enviar: ${error?.message || "error desconocido"}. Intenta de nuevo.`,
                  );
                  return;
                }
              }

              let freshOrder: Awaited<ReturnType<typeof fetchOrderDetail>> | null = null;
              try {
                freshOrder = orderId ? await fetchOrderDetail(orderId) : null;
              } catch {
                toast.error("No se pudo verificar la orden antes de enviar. Revisa tu conexion e intenta de nuevo.");
                return;
              }
              if (freshOrder && orderId) {
                qc.setQueryData(getOrderQueryKey(orderId), freshOrder);
              }

              const draftsToSend = (freshOrder?.items ?? []).some(
                (item) => item.status === "DRAFT" && Number(item.quantity ?? 0) > 0,
              );

              if (draftsToSend) {
                if (isExpressOrder) {
                  await sendToDispatch.mutateAsync();
                } else {
                  await sendToKitchen.mutateAsync();
                }
                if (orderId) {
                  freshOrder = await fetchOrderDetail(orderId);
                  if (freshOrder) {
                    qc.setQueryData(getOrderQueryKey(orderId), freshOrder);
                  }
                }
              } else if (!hadKitchenPending) {
                if (isExpressOrder) {
                  await sendToDispatch.mutateAsync();
                } else {
                  await sendToKitchen.mutateAsync();
                }
                if (orderId) {
                  freshOrder = await fetchOrderDetail(orderId);
                  if (freshOrder) {
                    qc.setQueryData(getOrderQueryKey(orderId), freshOrder);
                  }
                }
              } else {
                // Solo ajustes de cantidad en lineas ya enviadas (sin borradores nuevos).
                qc.invalidateQueries({ queryKey: ["dispatch-orders"] });
                qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
                qc.invalidateQueries({ queryKey: ["tables-with-status"] });
                qc.invalidateQueries({ queryKey: ["order", orderId] });
                qc.invalidateQueries({ queryKey: ["payable-orders"] });
              }

              if (useKitchenStaging && orderId) {
                setStagedDirty(false);
                const itemsForBaseline =
                  freshOrder?.items ??
                  (qc.getQueryData(getOrderQueryKey(orderId)) as Order | undefined)?.items;
                if (itemsForBaseline) {
                  setKitchenBaselineItems(itemsForBaseline);
                  setStagedItems(itemsForBaseline);
                } else {
                  setKitchenBaselineItems(stagedItems);
                }
              }

              const skipPaymentForSpecialZero = isSpecialOrderExplicitZeroTotal(freshOrder ?? order)
                || freshOrder?.status === "PAID";

              if (
                !isDispatchFirstFlow
                && canUseCaja
                && (order?.id || orderId)
                && !skipPaymentForSpecialZero
              ) {
                if (
                  !shiftGateQuery.data?.shiftOpen
                  || shiftGateQuery.data?.cajaStatus === "CLOSED"
                ) {
                  setShowCajaUnopenedAlert(true);
                  return;
                }

                if (canOpenPaymentUiOnDevice(shiftGateQuery.data, isTablet10)) {
                  setPaymentDialogOpenForOrderId(orderId);
                } else {
                  toast.error("El dispositivo es demasiado pequeño para operar caja.");
                }
              } else if (isDispatchFirstFlow && mobile) {
                setShowCart(false);
              }
            } catch {
              // error handled by hook
            } finally {
              setSendingKitchenChanges(false);
            }
          }}
          disabled={
            sendingKitchenChanges
            || (isExpressOrder ? sendToDispatch.isPending : sendToKitchen.isPending)
            || addItem.isPending
            || hasTemporaryDraftItems
          }
          title={addItem.isPending ? "Espera a que el item termine de guardarse" : hasTemporaryDraftItems ? "Sincronizando producto agregado..." : undefined}
          className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
        >
          {sendingKitchenChanges || (isExpressOrder ? sendToDispatch.isPending : sendToKitchen.isPending) || addItem.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isExpressOrder ? (
            <>
              <Truck className="h-5 w-5" />
              Enviar a despacho - {kitchenSendButtonLabel}
            </>
          ) : isDispatchFirstFlow ? (
            <>
              <ChefHat className="h-5 w-5" />
              Enviar a cocina - {kitchenSendButtonLabel}
            </>
          ) : (
            <>
              <CircleDollarSign className="h-5 w-5" />
              Enviar a caja - {kitchenSendButtonLabel}
            </>
          )}
        </Button>
        </div>
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
                onClick={() => {
                  const originValue = searchParams.get("origin") || "consulta";
                  navigate(`/ordenes?order=${orderId}&from=${originValue}${originParam}`, { replace: true });
                }}
              >
                <X className="h-5 w-5" />
                Cancelar edición
              </Button>
              {canEditItems && (
                <Button
                  className="h-12 w-full gap-2 rounded-xl font-display text-base font-semibold"
                  variant="info"
                  disabled={acceptingEditChanges}
                  onClick={handleAcceptEditedOrderChanges}
                >
                  {acceptingEditChanges ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                  Aceptar cambios
                </Button>
              )}
            </>
          ) : (
            <>


              {!fromEditar
                && !isDispatchFirstFlow
                && hasSentItems
                && canUseEditarOrden
                && isEditableInCaja
                && !order.paid_at && (
                <Button
                  variant="outline"
                  className="h-12 w-full gap-2 rounded-xl border-amber-300 bg-amber-50 font-display text-base font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  disabled={!canEnterEditMode}
                  title="Editar orden"
                  onClick={() => navigate(`/ordenes?order=${order.id}&from=editar${originParam}`)}
                >
                  <Pencil className="h-5 w-5" />
                  Editar orden
                </Button>
              )}



              {canCancelOrderFromCaja && (
                <Button
                  variant="outline"
                  className="col-span-2 h-12 w-full gap-2 rounded-xl border-red-300 bg-red-50 font-display text-base font-semibold text-red-700 hover:bg-red-100 hover:text-red-800"
                  onClick={() => setConfirmDeleteCajaOrderOpen(true)}
                  disabled={deletingCajaOrder}
                >
                  {deletingCajaOrder ? <Loader2 className="h-5 w-5 animate-spin" /> : <Ban className="h-5 w-5" />}
                  Eliminar orden
                </Button>
              )}

            </>
          )}
        </div>
      )}

    </div>
  );

  const renderMobileMenuOrderToggle = () => (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "relative h-9 min-w-[46px] shrink-0 overflow-visible rounded-xl border-orange-400 bg-white/95 px-2 text-orange-950 shadow-sm hover:bg-orange-50 md:hidden",
        showCart && "border-orange-500 bg-orange-100/90 text-orange-900",
      )}
      onClick={() => setShowCart((current) => !current)}
      aria-label={showCart ? "Volver al menu" : "Ver orden"}
    >
      {showCart ? <BookOpenText className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
      {!showCart && mobileOrderBadgeCount > 0 && (
        <span className="absolute right-0.5 top-0.5 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground shadow-sm">
          {mobileOrderBadgeCount}
        </span>
      )}
    </Button>
  );

  const renderNonMesaOrderTypeLabel = () => {
    if (order.is_tray_order) {
      return (
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-amber-800 dark:text-amber-400">
          <ShoppingBag className="h-4 w-4" />
          Para Llevar
        </div>
      );
    }
    if (order.is_special) {
      return (
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-orange-800 dark:text-orange-400">
          <Sparkles className="h-4 w-4" />
          Orden Especial
        </div>
      );
    }
    if (isExpressOrder) {
      return (
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-violet-800 dark:text-violet-400">
          <Zap className="h-4 w-4" />
          Express
        </div>
      );
    }
    if (order.table_name) {
      return (
        <div className="shrink-0 whitespace-nowrap text-sm font-extrabold text-sky-800 dark:text-sky-400">
          {(order.table_name ?? "").trim() || "Mesa"}
        </div>
      );
    }
    if (isTakeout) {
      return (
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-emerald-800 dark:text-emerald-400">
          <ShoppingBag className="h-4 w-4" />
          Para llevar
        </div>
      );
    }
    return null;
  };

  return (
    <div className="ordenes-mobile-touch flex min-h-0 flex-1 flex-col">
      {!isMesasChromeUi && !isExtraOrder && (
        <>
          <div className={ORDER_STICKY_CHROME_BAR_CLASS}>
            <div className="flex w-full min-w-0 items-center justify-between gap-2">
              <div className="scrollbar-none min-w-0 flex flex-1 items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={handleMobileBackToMesas}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-orange-200/35 hover:text-foreground"
                  aria-label="Volver"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {renderNonMesaOrderTypeLabel()}
                {!canOperateOrders && (
                  <span className="hidden rounded-full border border-orange-300/60 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                    Solo consulta
                  </span>
                )}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                {renderMobileMenuOrderToggle()}

                {order.table_id && (
                  <>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 rounded-xl border-orange-400 bg-white/95 p-0 text-orange-950 shadow-sm hover:bg-orange-50 md:hidden"
                          aria-label="Abrir menu de acciones"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 md:hidden">
                        {showDispatchEditOrderAction && (
                          <DropdownMenuItem
                            onClick={() => navigateToEditarOrdenAfterMenuClose()}
                            disabled={!canEnterEditMode}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Editar orden
                          </DropdownMenuItem>
                        )}
                        {canShowConvertToSpecial && (
                          <DropdownMenuItem
                            onClick={() => {
                              // Evita pointer-events:none residual del DropdownMenu de Radix.
                              window.setTimeout(() => setConvertSpecialDialogOpen(true), 0);
                            }}
                            disabled={!canConvertToSpecial}
                          >
                            <Sparkles className="mr-2 h-4 w-4" />
                            {convertSpecialActionLabel}
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
                        {(canCancelOrderFromCaja || hasSiblings) && (
                          <DropdownMenuItem
                            onClick={() => {
                              if (canCancelOrderFromCaja) {
                                setConfirmDeleteCajaOrderOpen(true);
                              } else {
                                setShowDeleteSplitConfirm(true);
                              }
                            }}
                            disabled={deletingCajaOrder || removingSplit || (!canCancelOrderFromCaja && !canDeleteSplit)}
                            className="text-destructive focus:text-destructive"
                          >
                            {deletingCajaOrder || removingSplit ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Ban className="mr-2 h-4 w-4" />
                            )}
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
                          "hidden h-9 w-9 shrink-0 rounded-lg p-0 md:inline-flex md:h-7 md:w-7",
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
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={ORDER_STICKY_CHROME_SPACER_CLASS} aria-hidden="true" />

          {order.table_id && (
            <div className="border-b border-border bg-card/50 px-3 py-2 sm:px-4">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  {tableOrdersTabsOverflow.left && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute left-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full border border-orange-200 bg-white/95 text-orange-700 shadow-[0_12px_26px_-18px_rgba(249,115,22,0.75)] hover:bg-orange-50 hover:text-orange-800"
                      onClick={() => scrollTableOrdersTabs("left")}
                      title="Ver ordenes anteriores"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  )}
                  {tableOrdersTabsOverflow.right && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full border border-orange-200 bg-white/95 text-orange-700 shadow-[0_12px_26px_-18px_rgba(249,115,22,0.75)] hover:bg-orange-50 hover:text-orange-800"
                      onClick={() => scrollTableOrdersTabs("right")}
                      title="Ver mas ordenes"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                  <div
                    ref={tableOrdersTabsRef}
                    data-no-order-swipe
                    onScroll={updateTableOrdersTabsOverflow}
                    className={cn(
                      "scrollbar-none flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto scroll-smooth pr-1",
                      tableOrdersTabsOverflow.left && "pl-9",
                      tableOrdersTabsOverflow.right && "pr-9",
                    )}
                  >
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
                          ? `No tienes permiso para crear nuevas ordenes en ${orderGroupLabel}`
                          : orderItems.length <= 0
                            ? "La orden actual debe tener al menos un item"
                            : !shiftOkForSiblingOrder
                              ? "Abre turno en caja para crear otra orden"
                              : !canSplit
                                ? isTakeoutOrder ? "Para Llevar debe seguir activo para crear otra orden" : "La mesa debe seguir activa para crear otra orden"
                                : "Nueva orden"
                      }
                    >
                      {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquarePlus className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(canShowConvertToSpecial || canShowChangeTable) && (
            <div className="hidden border-b border-border bg-card/50 px-3 py-2 sm:px-4 md:block">
              <div className="scrollbar-none flex items-center gap-2 overflow-x-auto">
                {canShowConvertToSpecial && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 shrink-0 gap-1 rounded-lg px-3 text-xs md:h-7"
                    onClick={() => {
                      window.setTimeout(() => setConvertSpecialDialogOpen(true), 0);
                    }}
                    disabled={!canConvertToSpecial}
                    title={
                      !canConvertToSpecial
                        ? "Se requiere al menos un item despachado"
                        : isMixedSpecial
                          ? "Reasignar items entre orden normal y especial"
                          : "Convertir items despachados en orden especial"
                    }
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isMixedSpecial ? "Editar Ord. Espec." : "Convertir Ord. Espec."}
                  </Button>
                )}
                {canShowChangeTable && (
                  <Button
                    variant={canChangeTable ? "outline" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-11 shrink-0 gap-1 rounded-lg px-3 text-xs md:h-7",
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
                )}
              </div>
            </div>
          )}
        </>
      )}

      {isExtraOrder && (
        <>
          <div className={ORDER_STICKY_CHROME_BAR_CLASS}>
            <div className="flex w-full min-w-0 items-center justify-between gap-2">
              <div className="scrollbar-none min-w-0 flex flex-1 items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={handleMobileBackToMesas}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-orange-200/35 hover:text-foreground"
                  aria-label="Volver"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-extrabold text-sky-800 dark:text-sky-400">
                  <Truck className="h-4 w-4" />
                  Extra
                </div>
              </div>
              {renderMobileMenuOrderToggle()}
            </div>
          </div>
          <div className={ORDER_STICKY_CHROME_SPACER_CLASS} aria-hidden="true" />
        </>
      )}

      {isMesasChromeUi && (
        <>
        <div className={ORDER_STICKY_CHROME_BAR_CLASS}>
          <div className="flex w-full min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {hasSiblings ? (
                <button
                  type="button"
                  className="min-w-0 max-w-full rounded-lg px-1 py-0.5 text-left font-display text-base font-black tracking-tight text-foreground transition hover:bg-orange-200/35"
                  onClick={() =>
                    navigate(
                      `/ordenes?order=${order.id}${sourceParamsNoMesaCards}&${MESAS_V2_CARDS_PARAM}=1`,
                      { replace: true },
                    )
                  }
                >
                  {renderMesaChromeHeaderTitle(order, !showMesasV2CardPicker)}
                </button>
              ) : (
                <span className="min-w-0 max-w-full rounded-lg px-1 py-0.5 text-left font-display text-base font-black tracking-tight text-foreground">
                  {renderMesaChromeHeaderTitle(order, !showMesasV2CardPicker)}
                </span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {!canOperateOrders && (
                <span className="hidden rounded-full border border-orange-300/60 bg-white/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                  Solo consulta
                </span>
              )}
              {renderMobileMenuOrderToggle()}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 shrink-0 gap-1.5 whitespace-nowrap rounded-xl border-orange-400 bg-white/95 px-3 text-xs font-bold text-orange-950 shadow-sm hover:bg-orange-50"
                onClick={() => void handleSplit()}
                disabled={!canSplit || splitting}
                title={
                  !canOperateOrders
                    ? "No tienes permiso para crear nuevas ordenes en mesa"
                    : orderItems.length <= 0
                      ? "La orden actual debe tener al menos un item"
                      : !shiftOkForSiblingOrder
                        ? "Abre turno en caja para crear otra orden"
                        : !canSplit
                          ? "La mesa debe seguir activa para crear otra orden"
                          : "Nueva orden"
                }
              >
                {splitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquarePlus className="h-4 w-4" />}
                Añadir orden
              </Button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-xl border-orange-400 bg-white/95 text-orange-950 shadow-sm hover:bg-orange-50"
                    aria-label="Mas opciones de la mesa"
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={handleMobileBackToMesas}>
                    Volver a mesas
                  </DropdownMenuItem>
                  {showDispatchEditOrderAction && (
                    <DropdownMenuItem
                      onClick={() => navigateToEditarOrdenAfterMenuClose()}
                      disabled={!canEnterEditMode}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar orden
                    </DropdownMenuItem>
                  )}
                  {canShowConvertToSpecial && (
                    <DropdownMenuItem
                      onClick={() => {
                        window.setTimeout(() => setConvertSpecialDialogOpen(true), 0);
                      }}
                      disabled={!canConvertToSpecial}
                    >
                      <Sparkles className="mr-2 h-4 w-4" />
                      {convertSpecialActionLabel}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setMergeSplitOpen(true)} disabled={!canOperateOrders}>
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
                  {(canCancelOrderFromCaja || hasSiblings) && (
                    <DropdownMenuItem
                      onClick={() => {
                        if (canCancelOrderFromCaja) {
                          setConfirmDeleteCajaOrderOpen(true);
                        } else {
                          setShowDeleteSplitConfirm(true);
                        }
                      }}
                      disabled={deletingCajaOrder || removingSplit || (!canCancelOrderFromCaja && !canDeleteSplit)}
                      className="text-destructive focus:text-destructive"
                    >
                      {deletingCajaOrder || removingSplit ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <X className="mr-2 h-4 w-4" />
                      )}
                      Eliminar orden
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
        <div className={ORDER_STICKY_CHROME_SPACER_CLASS} aria-hidden="true" />
        </>
      )}

      {showMesasV2CardPicker ? (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="scrollbar-none flex-1 overflow-y-auto px-2.5 pb-24 pt-3 sm:px-4 sm:pb-24 md:px-6 md:pb-24 md:pt-4">
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 md:[grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
              {mergedTableOrders.map((tableOrder) => {
                const previewLines = tableOrder.item_preview_lines ?? [];
                const isSel = tableOrder.id === order.id;
                const isDraftOrder = String(tableOrder.status ?? "DRAFT") === "DRAFT";
                const cardDraft = previewLines.length === 0 && isDraftOrder;
                return (
                  <button
                    key={tableOrder.id}
                    type="button"
                    onClick={() =>
                      navigate(`/ordenes?order=${tableOrder.id}${sourceParamsNoMesaCards}`, { replace: true })
                    }
                    className={cn(
                      "relative flex min-h-[132px] flex-col overflow-hidden rounded-[22px] border-2 p-0 text-left shadow-sm transition-shadow hover:shadow-md sm:min-h-[148px] sm:rounded-[26px]",
                      cardDraft
                        ? "border-sky-300/90 bg-gradient-to-br from-sky-50 via-white to-cyan-50 dark:border-sky-800 dark:from-sky-950/25 dark:via-card dark:to-cyan-950/20"
                        : "border-orange-300/90 bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:border-primary/35 dark:from-orange-950/25 dark:via-card dark:to-amber-950/20",
                      isSel && "ring-2 ring-orange-500 ring-offset-2 ring-offset-background shadow-[0_12px_36px_-20px_rgba(249,115,22,0.35)]",
                    )}
                  >
                    <div
                      className={cn(
                        "shrink-0 border-b px-3 pb-2.5 pt-3 shadow-[0_3px_10px_-4px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.75)] sm:px-3.5 sm:pb-3 sm:pt-3.5 dark:shadow-[0_3px_12px_-4px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)]",
                        cardDraft
                          ? "border-sky-300/80 bg-gradient-to-b from-white to-sky-100/90 dark:border-sky-700/70 dark:from-sky-900/55 dark:to-sky-950/40"
                          : "border-orange-300/80 bg-gradient-to-b from-white to-orange-100/85 dark:border-orange-800/60 dark:from-orange-950/45 dark:to-orange-950/25",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={cn(
                            "min-w-0 shrink text-left text-[11px] font-black tabular-nums sm:text-xs",
                            cardDraft ? "text-sky-950 dark:text-sky-100" : "text-orange-950 dark:text-orange-50",
                          )}
                        >
                          Orden #{getOrdenNumeroParaCabeceraMesa(tableOrder)}
                        </span>
                        <span
                          className={cn(
                            "max-w-[58%] shrink-0 truncate text-right text-[10px] font-bold leading-tight sm:text-[11px]",
                            cardDraft ? "text-sky-800 dark:text-sky-300" : "text-orange-900 dark:text-orange-200/95",
                          )}
                          title={MESA_PICKER_CARD_STATUS_LABEL[String(tableOrder.status ?? "DRAFT")] ?? String(tableOrder.status ?? "")}
                        >
                          {MESA_PICKER_CARD_STATUS_LABEL[String(tableOrder.status ?? "DRAFT")] ?? String(tableOrder.status ?? "")}
                        </span>
                      </div>
                    </div>
                    <div
                      className={cn(
                        "flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-2.5 sm:px-3.5 sm:py-3",
                        cardDraft
                          ? "bg-sky-50/80 shadow-[inset_0_2px_8px_rgba(14,116,144,0.08)] dark:bg-sky-950/30 dark:shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)]"
                          : "bg-white/60 shadow-[inset_0_2px_10px_rgba(234,88,12,0.07)] dark:bg-black/25 dark:shadow-[inset_0_2px_12px_rgba(0,0,0,0.4)]",
                      )}
                    >
                      {previewLines.length > 0 ? (
                        previewLines.map((line, lineIdx) => (
                          <p
                            key={`${tableOrder.id}-${lineIdx}`}
                            className={cn(
                              "break-words text-[11px] font-semibold leading-snug sm:text-xs",
                              cardDraft ? "text-sky-900 dark:text-sky-200" : "text-foreground",
                            )}
                          >
                            <span className="font-black tabular-nums">{line.quantity}</span>
                            <span className="select-none"> </span>
                            <span>{line.description}</span>
                          </p>
                        ))
                      ) : (
                        <p
                          className={cn(
                            "text-[11px] font-semibold sm:text-xs",
                            cardDraft ? "text-sky-700 dark:text-sky-400" : "text-muted-foreground",
                          )}
                        >
                          {isDraftOrder ? "Borrador" : "Sin líneas"}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="relative z-10 flex min-h-0 flex-1 flex-row overflow-hidden md:grid md:grid-cols-2 md:gap-4 md:p-4">
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 pb-24 md:p-0 md:pb-4",
            showCart && "hidden md:block",
          )}
        >
          {menuPanel}
        </div>

        <div
          className={cn(
            "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto border-border p-3 pb-24 md:border-0 md:p-0",
            !showCart && "hidden md:flex",
          )}
        >
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto md:rounded-[28px] md:border md:border-orange-200/80 md:bg-white/88 md:p-5 md:shadow-[0_24px_60px_-40px_rgba(249,115,22,0.25)] md:backdrop-blur-sm">
            <div className="w-full min-h-0 flex-1 overflow-y-auto">
              {orderPanel(!isDesktop)}
            </div>
          </div>
        </div>
      </div>
        </>
      )}



      <AddItemDialog
        product={selectedProduct}
        resolvingShell={productLoadingShell}
        modifiers={
          (selectedProduct || productLoadingShell) && (!isTrayOrder || effectiveTrayType !== "A")
            ? selectedProductModifiers
            : []
        }
        open={Boolean(selectedProduct || productLoadingShell)}
        onClose={() => {
          setSelectedProduct(null);
          setSelectedProductRootName(null);
          setSelectedProductModifiers([]);
          setProductLoadingShell(null);
        }}
        priceModeOverride={order.is_special ? "MANUAL" : isTrayOrder ? (effectiveTrayType === "C" ? "MANUAL" : "FIXED") : undefined}
        manualPriceLabel={order.is_special ? "Precio unitario" : isTrayOrder && effectiveTrayType === "C" ? "Precio manual" : "Precio"}
        isSpecial={order.is_special}
        confirmLabel="Agregar"
        hideQuantity={shouldCalculateBulkIncludedByAmount}
        extraContent={({ unitPrice, quantity }) => {
          if (!shouldCalculateBulkIncludedByAmount) return null;

          const previewRows = resolveBulkIncludedPreview(unitPrice, quantity);
          if (previewRows.length === 0) {
            return null;
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
          shouldCalculateBulkIncludedByAmount ? buildBulkIncludedItemNote(unitPrice, quantity) : null
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
                tray_item_type: isTrayOrder ? effectiveTrayType : shouldCalculateBulkIncludedByAmount ? "C" : null,
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
            setSelectedProductRootName(null);
            return;
          }

          // Cierre optimista para que la interfaz móvil responda instantáneamente
          setSelectedProduct(null);
          setSelectedProductRootName(null);
          setSelectedProductModifiers([]);
          setProductLoadingShell(null);

          addItem.mutate({
            ...data,
            menu_node_id: selectedProduct?.menu_node_id ?? null,
            modifier_ids: selectedModifierIds,
            modifier_snapshots: selectedModifierSnapshots,
            tray_item_type: isTrayOrder ? effectiveTrayType : shouldCalculateBulkIncludedByAmount ? "C" : undefined,
            tray_container_cost: 0,
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

          <DialogFooter className="footer-safe-bottom border-t border-slate-100 px-5 pt-4">
            <Button
              className="w-full rounded-xl"
              onClick={() => {
                setTakeoutCajaPreview(null);
                navigate(mesasListPathForOrigin(origin));
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
          items={orderItems}
          total={total}
          createdAt={order.created_at}
        />
      )}

      <AlertDialog open={showDeleteSplitConfirm} onOpenChange={setShowDeleteSplitConfirm}>
            <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar orden</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara la orden seleccionada dentro de la mesa. Esta accion solo debe hacerse si la orden aun no ha sido enviada.
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

      <AlertDialog
        open={confirmDeleteCajaOrderOpen}
        onOpenChange={(open) => {
          if (!deletingCajaOrder) {
            setConfirmDeleteCajaOrderOpen(open);
            if (!open) setDeleteCajaOrderError("");
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar orden</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará esta orden completa con todos sus items. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteCajaOrderError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              {deleteCajaOrderError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingCajaOrder}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteCajaOrder();
              }}
              disabled={deletingCajaOrder}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletingCajaOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
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

      <ConvertirOrdenEspecialDialog
        open={convertSpecialDialogOpen}
        onOpenChange={setConvertSpecialDialogOpen}
        submitting={convertingToSpecial}
        mode={isMixedSpecial ? "edit" : "convert"}
        initialQtyByItemId={isMixedSpecial ? especialQtyByItemId : undefined}
        initialSpecialTotal={isMixedSpecial ? order.special_group_total : undefined}
        initialSpecialReason={isMixedSpecial ? order.special_reason : undefined}
        items={itemsToUse
          .filter((item) => item.status !== "DRAFT")
          .map((item) => ({
            id: item.id,
            description_snapshot: item.description_snapshot,
            unit_price: Number(item.unit_price ?? 0),
            quantity: Number(item.quantity ?? 0),
            quantity_dispatched:
              Number(item.quantity_dispatched ?? 0) > 0
                ? Number(item.quantity_dispatched)
                : item.status === "DISPATCHED"
                  ? Number(item.quantity ?? 0)
                  : 0,
            image_url: null,
            total: Number(item.total ?? 0),
          }))}
        onConfirm={(params) => handleConvertToSpecial(params)}
      />

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
          hasOperationalItems: orderItems.some((item) => item.status !== "DRAFT"),
        }}
      />

      {USE_PAYMENT_DIALOG_V2 ? (
        <PaymentDialogV2
          order={payableOrder}
          denominations={denominations}
          shiftDenoms={shift?.denoms ?? []}
          paymentMethods={paymentMethods}
          paying={payOrder.isPending}
          onPay={(params) => payOrder.mutateAsync(params)}
          open={showPaymentDialog}
          onClose={() => setPaymentDialogOpenForOrderId(null)}
        />
      ) : (
        <PaymentDialog
          order={payableOrder}
          paymentMethods={paymentMethods}
          shiftDenoms={shift?.denoms ?? []}
          paying={payOrder.isPending}
          onPay={(params) => payOrder.mutateAsync(params)}
          onPrepareTransferProof={prepareTransferProof}
          onDiscardPreparedTransferProof={discardPreparedTransferProof}
          getTransferProofReadiness={getTransferProofReadiness}
          onClose={() => setPaymentDialogOpenForOrderId(null)}
          open={showPaymentDialog}
        />
      )}

      <AlertDialog open={showCajaUnopenedAlert} onOpenChange={setShowCajaUnopenedAlert}>
        <AlertDialogContent className="max-w-md rounded-[24px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-xl font-bold text-slate-900">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              Caja cerrada
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base text-slate-600">
              La caja fue cerrada en este turno. Por favor, reabre la caja en el módulo de Caja antes de continuar cobrando.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => navigate("/caja")}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl"
            >
              Ir a Caja
            </AlertDialogAction>
            <AlertDialogAction 
              onClick={() => setShowCajaUnopenedAlert(false)}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-xl border-none"
            >
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

const Ordenes = () => {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("order");

  return (
    <OrdenesErrorBoundary orderId={orderId}>
      {orderId ? <OrdenesContent /> : <OrdenesListShell />}
    </OrdenesErrorBoundary>
  );
};

export default Ordenes;
