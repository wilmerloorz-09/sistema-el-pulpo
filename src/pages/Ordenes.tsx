import { useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useOrder } from "@/hooks/useOrder";
import { useMenuData } from "@/hooks/useMenuData";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import MenuNavigator from "@/components/order/MenuNavigator";
import AddItemDialog from "@/components/order/AddItemDialog";
import OrderItemsList from "@/components/order/OrderItemsList";
import ThermalReceipt from "@/components/order/ThermalReceipt";
import OrdersList from "@/components/order/OrdersList";
import CancelOrderDialog from "@/components/order/CancelOrderDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, ChefHat, ArrowLeft, ShoppingBag, Split, CircleDollarSign, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { OrderSummary } from "@/hooks/useOrdersByStatus";
import { canManage, canOperate } from "@/lib/permissions";
import type { MenuNode } from "@/hooks/useMenuTree";

interface SelectedProduct {
  id: string;
  description: string;
  subcategory_id: string;
  unit_price: number | null;
  price_mode: "FIXED" | "MANUAL";
}

const Ordenes = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const qc = useQueryClient();
  const orderId = searchParams.get("order");

  const { order, isLoading, addItem, removeItem, updateQuantity, sendToKitchen } = useOrder(orderId);
  const menu = useMenuData();

  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [removingSplit, setRemovingSplit] = useState(false);
  const [showDeleteSplitConfirm, setShowDeleteSplitConfirm] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<OrderSummary | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const canOperateOrders = canOperate(permissions, "ordenes");
  const canManageOrders = canManage(permissions, "admin_sucursal") || canManage(permissions, "admin_global");
  const canCancelOrders = canOperateOrders || canManageOrders;

  const isTakeout = order?.order_type === "TAKEOUT";

  const printReceipt = useCallback(() => {
    window.print();
  }, []);

  const handleSelectMenuProduct = useCallback((node: MenuNode) => {
    const legacyProduct = menu.products.find((product) => product.id === node.id);

    if (!legacyProduct) {
      toast.error("Este producto aun no esta sincronizado con el catalogo operativo. Abre Admin > Arbol Menu y vuelve a guardarlo.");
      return;
    }

    setSelectedProduct(legacyProduct);
  }, [menu.products]);

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
  const hasDraftItems = order.items.some((i) => i.status === "DRAFT");
  const hasSentItems = order.items.some((i) => i.status !== "DRAFT");
  const isSent = order.status === "SENT_TO_KITCHEN";
  const hasSiblings = order.siblings.length > 0;
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
  const canEditItems = canOperateOrders && order.status !== "PAID" && order.status !== "CANCELLED";
  const tableWatermark =
    order.order_type === "DINE_IN"
      ? (order.split_code ?? order.table_name ?? "").trim()
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
          .insert({ table_id: order.table_id, split_code: `${tableName} A` })
          .select("id")
          .single();
        if (errA) throw errA;

        const { data: splitB, error: errB } = await supabase
          .from("table_splits")
          .insert({ table_id: order.table_id, split_code: `${tableName} B` })
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
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
          })
          .select("id")
          .single();
        if (newOrderError || !newOrder) throw newOrderError ?? new Error("No se pudo crear la nueva division");

        toast.success("Mesa dividida en A y B");
        navigate(`/ordenes?order=${newOrder.id}`, { replace: true });
      } else {
        const nextIndex = order.siblings.length;
        const nextLetter = letters[nextIndex] ?? `${nextIndex + 1}`;

        const { data: newSplit, error: splitErr } = await supabase
          .from("table_splits")
          .insert({ table_id: order.table_id, split_code: `${tableName} ${nextLetter}` })
          .select("id")
          .single();
        if (splitErr) throw splitErr;

        const { data: newOrder, error: newOrderError } = await supabase
          .from("orders")
          .insert({
          table_id: order.table_id,
          split_id: newSplit.id,
          order_type: "DINE_IN" as const,
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
          })
          .select("id")
          .single();
        if (newOrderError || !newOrder) throw newOrderError ?? new Error("No se pudo crear la nueva division");

        toast.success(`Sub-mesa ${tableName} ${nextLetter} creada`);
        navigate(`/ordenes?order=${newOrder.id}`, { replace: true });
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
      await supabase.from("orders").delete().eq("id", order.id);
      await supabase.from("table_splits").update({ is_active: false }).eq("id", order.split_id);

      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["orders"] });

      const remainingSibling = order.siblings.find((sibling) => sibling.id !== order.id);
      toast.success("Division eliminada");

      if (remainingSibling) {
        navigate(`/ordenes?order=${remainingSibling.id}`, { replace: true });
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

  const menuPanel = canEditItems ? (
    <MenuNavigator
      includeInactive={true}
      onSelectProduct={handleSelectMenuProduct}
      renderNodeAction={(node) =>
        !node.is_active && node.node_type === "product" ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-700">
            Producto agotado
          </div>
        ) : null
      }
    />
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
          <Button variant="ghost" size="sm" className="h-11 px-3 text-sm 2xl:hidden" onClick={() => setShowCart(false)}>
            Ver menu
          </Button>
        ) : null}
      </div>

      <div className={cn("min-h-0", mobile && "flex-1")}>
        <OrderItemsList
          items={order.items}
          onRemove={(id) => removeItem.mutate(id)}
          onUpdateQty={(id, qty, price) => updateQuantity.mutate({ itemId: id, quantity: qty, unit_price: price })}
          disabled={!canEditItems}
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
      {tableWatermark && (
        <div className="pointer-events-none fixed inset-x-0 top-[7.5rem] bottom-24 z-0 overflow-hidden md:top-[6.5rem]">
          <div className="absolute left-[34%] bottom-6 h-56 w-56 -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-200/18 via-amber-100/12 to-transparent blur-3xl md:left-[32%] md:bottom-8 md:h-72 md:w-72" />
          <div className="absolute bottom-4 left-[34%] -translate-x-1/2 select-none font-display text-[3rem] font-black uppercase tracking-[0.18em] text-orange-300/10 md:left-[32%] md:bottom-6 md:text-[4.8rem]">
            {tableWatermark}
          </div>
          <div className="absolute bottom-4 left-[34%] -translate-x-1/2 select-none font-display text-[3rem] font-black uppercase tracking-[0.18em] text-transparent [-webkit-text-stroke:1px_rgba(251,146,60,0.14)] md:left-[32%] md:bottom-6 md:text-[4.8rem]">
            {tableWatermark}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/50 px-3 py-3 sm:px-4">
        <Button variant="ghost" size="icon" className="h-11 w-11 2xl:h-8 2xl:w-8" onClick={() => navigate("/mesas")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {order.table_name && (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-extrabold text-sky-800 shadow-sm">
                {order.table_name}
              </span>
            )}
            <Badge variant="outline" className={cn("text-[10px] font-bold shadow-sm", statusColor[order.status])}>
              {statusLabel[order.status]}
            </Badge>
            {!canOperateOrders && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                Solo consulta
              </span>
            )}
            {order.table_id && (
              <>
                <Button
                  variant={canSplit ? "default" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-11 gap-1 rounded-lg px-3 text-xs 2xl:h-7",
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
                  Dividir
                </Button>

                {hasSiblings && (
                  <Button
                    variant={canDeleteSplit ? "destructive" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-11 gap-1 rounded-lg px-3 text-xs 2xl:h-7",
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
                    Eliminar division
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" className="relative ml-auto h-11 rounded-xl gap-1.5 2xl:hidden" onClick={() => setShowCart(!showCart)}>
          <ShoppingBag className="h-4 w-4" />
          {itemCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {itemCount}
            </span>
          )}
        </Button>
      </div>

      {hasSiblings && (
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-muted/30 px-4 py-2">
          {order.siblings.map((sib) => (
            <Button key={sib.id} variant={sib.id === order.id ? "default" : "outline"} size="sm" className="h-11 shrink-0 gap-1.5 rounded-lg px-3 text-xs 2xl:h-8" onClick={() => navigate(`/ordenes?order=${sib.id}`, { replace: true })}>
              {sib.split_code}
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{sib.item_count}</Badge>
            </Button>
          ))}
        </div>
      )}

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
        modifiers={selectedProduct ? menu.modifiers.filter((mod: any) => mod.node_id === selectedProduct.id) : []}
        open={canEditItems && !!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        onConfirm={(data) => {
          addItem.mutate(data, {
            onSuccess: () => setSelectedProduct(null),
          });
        }}
        adding={addItem.isPending}
      />

      {order && (
        <ThermalReceipt
          ref={receiptRef}
          orderNumber={order.order_code ?? `#${order.order_number}`}
          orderType={order.order_type}
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


