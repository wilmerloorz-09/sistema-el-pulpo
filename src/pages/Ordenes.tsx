import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useOrder } from "@/hooks/useOrder";
import { useMenuData } from "@/hooks/useMenuData";
import ProductPicker from "@/components/order/ProductPicker";
import AddItemDialog from "@/components/order/AddItemDialog";
import OrderItemsList from "@/components/order/OrderItemsList";
import SplitTableDialog from "@/components/order/SplitTableDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChefHat, ArrowLeft, ShoppingBag, Split } from "lucide-react";
import { cn } from "@/lib/utils";

const Ordenes = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get("order");

  const { order, isLoading, addItem, removeItem, updateQuantity, sendToKitchen } = useOrder(orderId);
  const menu = useMenuData();

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showCart, setShowCart] = useState(false);
  const [showSplit, setShowSplit] = useState(false);

  if (!orderId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <ShoppingBag className="h-12 w-12 text-muted-foreground/40 mb-3" />
        <p className="font-display text-lg font-bold text-foreground">Sin orden seleccionada</p>
        <p className="text-sm text-muted-foreground mt-1">Selecciona una mesa o crea una orden para llevar</p>
        <Button className="mt-4 rounded-xl" onClick={() => navigate("/mesas")}>
          Ir a Mesas
        </Button>
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
  const isDraft = order.status === "DRAFT";
  const isSent = order.status === "SENT_TO_KITCHEN";

  const statusLabel: Record<string, string> = {
    DRAFT: "Borrador",
    SENT_TO_KITCHEN: "En cocina",
    KITCHEN_DISPATCHED: "Despachada",
    PAID: "Pagada",
  };

  const statusColor: Record<string, string> = {
    DRAFT: "bg-muted text-muted-foreground",
    SENT_TO_KITCHEN: "bg-primary/15 text-primary",
    KITCHEN_DISPATCHED: "bg-warning/15 text-foreground",
    PAID: "bg-accent/15 text-accent",
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Order header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/50">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/mesas")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold">
              #{order.order_number}
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
                onClick={() => setShowSplit(true)}
              >
                <Split className="h-3.5 w-3.5" />
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
              disabled={!isDraft}
            />
          </div>

          {/* Actions */}
          {isDraft && order.items.length > 0 && (
            <Button
              onClick={() => sendToKitchen.mutate()}
              disabled={sendToKitchen.isPending}
              className="mt-4 h-12 w-full rounded-xl font-display text-base font-semibold gap-2"
            >
              {sendToKitchen.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
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

      {/* Split table dialog */}
      {order.table_id && (
        <SplitTableDialog
          open={showSplit}
          onClose={() => setShowSplit(false)}
          tableId={order.table_id}
          tableName={order.table_name ?? "Mesa"}
          orderId={order.id}
        />
      )}
    </div>
  );
};

export default Ordenes;
