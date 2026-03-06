import { useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useOrder } from "@/hooks/useOrder";
import { useMenuData } from "@/hooks/useMenuData";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductPicker from "@/components/order/ProductPicker";
import AddItemDialog from "@/components/order/AddItemDialog";
import OrderItemsList from "@/components/order/OrderItemsList";
import ThermalReceipt from "@/components/order/ThermalReceipt";
import OrdersList from "@/components/order/OrdersList";
import CancelOrderDialog from "@/components/order/CancelOrderDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChefHat, ArrowLeft, ShoppingBag, Split, CircleDollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { OrderSummary } from "@/hooks/useOrdersByStatus";

const Ordenes = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeBranchId } = useBranch();
  const qc = useQueryClient();
  const orderId = searchParams.get("order");

  const { order, isLoading, addItem, removeItem, updateQuantity, sendToKitchen } = useOrder(orderId);
  const menu = useMenuData();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showCart, setShowCart] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<OrderSummary | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  const isTakeout = order?.order_type === "TAKEOUT";

  const printReceipt = useCallback(() => {
    window.print();
  }, []);

  if (!orderId) {
    return (
      <div className="flex flex-col h-[calc(100vh-7rem)]">
        <div className="flex items-center gap-2 mb-4 px-4 py-3 border-b border-border bg-card/50">
          <h1 className="font-display text-lg font-bold text-foreground">Órdenes</h1>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <OrdersList onCancelOrder={setCancelOrder} />
        </div>
        {cancelOrder && user && (
          <CancelOrderDialog
            orderId={cancelOrder.id}
            orderNumber={cancelOrder.order_number}
            items={cancelOrder.items.map((item) => ({
              id: item.id,
              description: item.description_snapshot,
              quantity: item.quantity,
              total: item.total,
              status: item.status as any,
            }))}
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
  const canSplit = order.table_id && isDraft && order.items.length > 0;
  const canEditItems = order.status !== "PAID" && order.status !== "CANCELLED";

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
    if (!user || !order.table_id) return;
    setSplitting(true);
    try {
      const tableName = order.table_name ?? "Mesa";
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

      if (!hasSiblings) {
        // First split: create A and B
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
        // Subsequent split: find next letter
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

  const switchToSibling = (siblingOrderId: string) => {
    navigate(`/ordenes?order=${siblingOrderId}`, { replace: true });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Order header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/50">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/mesas")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-sm font-bold">
              {order.order_code ?? `#${order.order_number}`}
            </span>
            {order.table_name && (
              <span className="text-xs text-muted-foreground">· {order.table_name}</span>
            )}
            <Badge className={cn("text-[10px]", statusColor[order.status])}>
              {statusLabel[order.status]}
            </Badge>
            {order.table_id && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs rounded-lg"
                onClick={handleSplit}
                disabled={!canSplit || splitting}
                title={!canSplit && !hasSiblings ? "Agrega items antes de dividir" : undefined}
              >
                {splitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Split className="h-3.5 w-3.5" />
                )}
                Dividir
              </Button>
            )}
          </div>
        </div>

        {/* Cart toggle (mobile) */}
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl gap-1.5 sm:hidden relative"
          onClick={() => setShowCart(!showCart)}
        >
          <ShoppingBag className="h-4 w-4" />
          {itemCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {itemCount}
            </span>
          )}
        </Button>
      </div>

      {/* Sub-table switcher */}
      {hasSiblings && (
        <div className="flex gap-1 px-4 py-2 border-b border-border bg-muted/30 overflow-x-auto">
          {order.siblings.map((sib) => (
            <Button
              key={sib.id}
              variant={sib.id === order.id ? "default" : "outline"}
              size="sm"
              className="rounded-lg text-xs h-8 gap-1.5 shrink-0"
              onClick={() => switchToSibling(sib.id)}
            >
              {sib.split_code}
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {sib.item_count}
              </Badge>
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Menu side */}
        <div className={cn(
          "flex-1 overflow-y-auto p-4",
          showCart && "hidden sm:block"
        )}>
          <ProductPicker
            categories={menu.categories}
            subcategories={menu.subcategories}
            products={menu.products}
            onSelectProduct={(p) => setSelectedProduct(p)}
          />
        </div>

        {/* Cart side */}
        <div className={cn(
          "w-full sm:w-80 sm:border-l border-border overflow-y-auto p-4 flex flex-col",
          !showCart && "hidden sm:flex"
        )}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-sm font-bold">Orden</h2>
            <Button
              variant="ghost"
              size="sm"
              className="sm:hidden text-xs"
              onClick={() => setShowCart(false)}
            >
              Ver menú
            </Button>
          </div>

          <div className="flex-1">
            <OrderItemsList
              items={order.items}
              onRemove={(id) => removeItem.mutate(id)}
              onUpdateQty={(id, qty, price) => updateQuantity.mutate({ itemId: id, quantity: qty, unit_price: price })}
              disabled={!canEditItems}
            />
          </div>

          {/* Actions */}
          {hasDraftItems && order.status !== "PAID" && order.status !== "CANCELLED" && (
            <Button
              onClick={() => {
                sendToKitchen.mutate(undefined, {
                  onSuccess: () => {
                    if (isTakeout) {
                      printReceipt();
                      // Navigate to mesas after a brief delay for print dialog
                      setTimeout(() => navigate("/mesas"), 500);
                    }
                  },
                });
              }}
              disabled={sendToKitchen.isPending}
              className="mt-4 h-12 w-full rounded-xl font-display text-base font-semibold gap-2"
            >
              {sendToKitchen.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : hasSentItems ? (
                <>
                  <ChefHat className="h-5 w-5" />
                  Enviar nuevos ítems · ${total.toFixed(2)}
                </>
              ) : isTakeout ? (
                <>
                  <CircleDollarSign className="h-5 w-5" />
                  Enviar a caja · ${total.toFixed(2)}
                </>
              ) : (
                <>
                  <ChefHat className="h-5 w-5" />
                  Enviar a cocina · ${total.toFixed(2)}
                </>
              )}
            </Button>
          )}

          {isSent && (
            <div className="mt-4 rounded-xl bg-primary/10 p-3 text-center">
              <p className="text-sm font-medium text-primary">Orden en cocina</p>
              <p className="text-xs text-muted-foreground mt-0.5">Esperando despacho</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating cart button (mobile) */}
      {!showCart && itemCount > 0 && (
        <button
          onClick={() => setShowCart(true)}
          className="sm:hidden fixed bottom-20 right-4 flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-primary-foreground shadow-lg active:scale-95 transition-transform z-30"
        >
          <ShoppingBag className="h-5 w-5" />
          <span className="font-display text-sm font-bold">{itemCount} items · ${total.toFixed(2)}</span>
        </button>
      )}

      {/* Add item dialog */}
      <AddItemDialog
        product={selectedProduct}
        modifiers={menu.modifiers}
        open={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        onConfirm={(data) => {
          addItem.mutate(data, {
            onSuccess: () => setSelectedProduct(null),
          });
        }}
        adding={addItem.isPending}
      />

      {/* Thermal receipt for printing */}
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

      {/* Print styles */}
      <style>{`
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
