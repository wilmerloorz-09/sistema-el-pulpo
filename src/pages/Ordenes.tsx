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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Loader2, ChefHat, ArrowLeft, ShoppingBag, Split, CircleDollarSign } from "lucide-react";
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
      <div className="ordenes-mobile-touch flex h-[calc(100vh-7rem)] flex-col">
        <div className="mb-4 flex items-center gap-2 border-b border-border bg-card/50 px-4 py-3">
          <h1 className="font-display text-lg font-bold text-foreground">Ordenes</h1>
          {!canOperateOrders && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Solo consulta
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
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
  const isDraft = order.status === "DRAFT";
  const isSent = order.status === "SENT_TO_KITCHEN";
  const hasSiblings = order.siblings.length > 0;
  const canSplit = canOperateOrders && !!order.table_id && isDraft && order.items.length > 0;
  const canEditItems = canOperateOrders && order.status !== "PAID" && order.status !== "CANCELLED";

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
    READY: "bg-green-500/15 text-green-600",
    KITCHEN_DISPATCHED: "bg-warning/15 text-foreground",
    PAID: "bg-accent/15 text-accent",
    CANCELLED: "bg-destructive/15 text-destructive",
  };

  const handleSplit = async () => {
    if (!user || !order.table_id || !canOperateOrders) return;
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

        await supabase.from("orders").update({ split_id: splitA.id }).eq("id", order.id);

        await supabase.from("orders").insert({
          table_id: order.table_id,
          split_id: splitB.id,
          order_type: "DINE_IN" as const,
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
        });

        toast.success("Mesa dividida en A y B");
      } else {
        const nextIndex = order.siblings.length;
        const nextLetter = letters[nextIndex] ?? `${nextIndex + 1}`;

        const { data: newSplit, error: splitErr } = await supabase
          .from("table_splits")
          .insert({ table_id: order.table_id, split_code: `${tableName} ${nextLetter}` })
          .select("id")
          .single();
        if (splitErr) throw splitErr;

        await supabase.from("orders").insert({
          table_id: order.table_id,
          split_id: newSplit.id,
          order_type: "DINE_IN" as const,
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
        });

        toast.success(`Sub-mesa ${tableName} ${nextLetter} creada`);
      }

      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSplitting(false);
    }
  };

  const menuPanel = canEditItems ? (
    <MenuNavigator onSelectProduct={handleSelectMenuProduct} />
  ) : (
    <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
      Modo consulta: puedes ver la orden, pero no agregar ni editar items.
    </div>
  );

  const orderPanel = (mobile: boolean) => (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-bold">Orden</h2>
        {mobile ? (
          <Button variant="ghost" size="sm" className="h-11 px-3 text-sm md:hidden" onClick={() => setShowCart(false)}>
            Ver menu
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
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
    </>
  );

  return (
    <div className="ordenes-mobile-touch flex h-[calc(100vh-7rem)] flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-card/50 px-4 py-3">
        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" onClick={() => navigate("/mesas")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-bold">{order.order_code ?? `#${order.order_number}`}</span>
            {order.table_name && <span className="text-xs text-muted-foreground">- {order.table_name}</span>}
            <Badge className={cn("text-[10px]", statusColor[order.status])}>{statusLabel[order.status]}</Badge>
            {!canOperateOrders && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                Solo consulta
              </span>
            )}
            {order.table_id && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 gap-1 rounded-lg px-3 text-xs md:h-7"
                onClick={handleSplit}
                disabled={!canSplit || splitting}
                title={!canSplit && canOperateOrders && !hasSiblings ? "Agrega items antes de dividir" : undefined}
              >
                {splitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Split className="h-3.5 w-3.5" />}
                Dividir
              </Button>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" className="relative h-11 rounded-xl gap-1.5 md:hidden" onClick={() => setShowCart(!showCart)}>
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
            <Button key={sib.id} variant={sib.id === order.id ? "default" : "outline"} size="sm" className="h-11 shrink-0 gap-1.5 rounded-lg px-3 text-xs md:h-8" onClick={() => navigate(`/ordenes?order=${sib.id}`, { replace: true })}>
              {sib.split_code}
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{sib.item_count}</Badge>
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden md:hidden">
        <div className={cn("flex-1 overflow-y-auto p-3", showCart && "hidden")}>
          {menuPanel}
        </div>

        <div className={cn("flex w-full flex-col overflow-y-auto border-border p-3", !showCart && "hidden")}>
          {orderPanel(true)}
        </div>
      </div>

      <div className="hidden flex-1 overflow-hidden md:block">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId={`ordenes-layout-${activeBranchId ?? "default"}`}
          className="h-full overflow-hidden"
        >
          <ResizablePanel defaultSize={68} minSize={35} className="min-w-0">
            <div className="h-full overflow-y-auto p-4">
              {menuPanel}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="bg-border/70 transition-colors hover:bg-primary/30" />

          <ResizablePanel defaultSize={32} minSize={22} maxSize={55} className="min-w-0">
            <div className="flex h-full min-h-0 flex-col overflow-y-auto border-l border-border p-4">
              {orderPanel(false)}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {!showCart && itemCount > 0 && (
        <button onClick={() => setShowCart(true)} className="fixed bottom-20 right-4 z-30 flex min-h-[52px] items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-lg transition-transform active:scale-95 md:hidden">
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


