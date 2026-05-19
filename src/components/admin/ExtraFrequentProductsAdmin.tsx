import { useMemo, useState } from "react";
import { GripVertical, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import MenuNavigator from "@/components/order/MenuNavigator";
import { ExtraFrequentAddDialog } from "@/components/admin/ExtraFrequentAddDialog";
import { Button } from "@/components/ui/button";
import { useBranch } from "@/contexts/BranchContext";
import { useExtraFrequentProducts } from "@/hooks/useExtraFrequentProducts";
import type { MenuNode } from "@/hooks/useMenuTree";
import { cn } from "@/lib/utils";

const MAX_ITEMS = 10;

export default function ExtraFrequentProductsAdmin() {
  const { activeBranchId } = useBranch();
  const { products, isLoading, addProduct, removeProduct, reorderProducts } = useExtraFrequentProducts(activeBranchId);
  const [pickerNode, setPickerNode] = useState<MenuNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const selectedNodeIds = useMemo(() => new Set(products.map((row) => row.menu_node_id)), [products]);
  const atLimit = products.length >= MAX_ITEMS;

  const handleSelectProduct = (node: MenuNode) => {
    if (node.node_type !== "product") return;
    if (!node.is_active) {
      toast.error("Este producto está agotado.");
      return;
    }
    if (selectedNodeIds.has(node.id)) return;
    if (atLimit) {
      toast.error("Ya tienes 10 productos. Elimina uno para agregar otro.");
      return;
    }
    setPickerNode(node);
  };

  const handleConfirmAdd = async () => {
    if (!pickerNode) return;
    try {
      await addProduct.mutateAsync(pickerNode.id);
      toast.success("Producto agregado a frecuentes.");
      setPickerNode(null);
    } catch (error: any) {
      if (error?.message === "ALREADY_IN_LIST") return;
      toast.error(error?.message || "No se pudo agregar el producto.");
    }
  };

  const handleDrop = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDragOverId(null);
      return;
    }

    const currentIds = products.map((row) => row.id);
    const fromIndex = currentIds.indexOf(draggingId);
    const toIndex = currentIds.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextIds = [...currentIds];
    const [moved] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, moved);

    setDraggingId(null);
    setDragOverId(null);

    try {
      await reorderProducts.mutateAsync(nextIds);
    } catch (error: any) {
      toast.error(error?.message || "No se pudo reordenar la lista.");
    }
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground">
        Selecciona una sucursal activa para configurar productos frecuentes de Extra.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-orange-200 bg-white/85 p-4 shadow-sm">
        <h2 className="font-display text-lg font-bold text-foreground">Más frecuentes (Extra)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige hasta {MAX_ITEMS} productos del menú Mesa (sin Platos). Aparecerán como accesos rápidos al crear una orden Extra.
        </p>
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="min-h-[480px] rounded-[24px] border border-orange-200 bg-white/90 p-3 shadow-sm sm:p-4">
          <MenuNavigator
            menuScope="TABLE"
            hidePrices
            excludedRootCategoryNames={["PLATOS"]}
            onSelectProduct={handleSelectProduct}
          />
        </div>

        <div className="flex min-h-[480px] flex-col rounded-[24px] border border-teal-200 bg-gradient-to-br from-teal-50/80 via-white to-cyan-50/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-foreground">Lista de frecuentes</h3>
              <p className="text-xs text-muted-foreground">
                {products.length}/{MAX_ITEMS} productos
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-center text-sm text-muted-foreground">
              Aún no hay productos frecuentes. Selecciona productos del menú de la izquierda.
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {products.map((row, index) => {
                const node = row.menu_node;
                const label = node?.name ?? "Producto";
                const isDragOver = dragOverId === row.id && draggingId !== row.id;

                return (
                  <div
                    key={row.id}
                    draggable
                    onDragStart={() => setDraggingId(row.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverId(null);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverId(row.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      void handleDrop(row.id);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border bg-white p-2 shadow-sm transition",
                      draggingId === row.id && "opacity-60",
                      isDragOver ? "border-teal-400 ring-2 ring-teal-200" : "border-teal-100",
                    )}
                  >
                    <button
                      type="button"
                      className="flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-xl text-muted-foreground active:cursor-grabbing"
                      aria-label={`Reordenar ${label}`}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>

                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-800">
                      {index + 1}
                    </span>

                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-teal-50 ring-1 ring-teal-100">
                      {node?.image_url ? (
                        <img src={node.image_url} alt={label} className="h-full w-full object-cover" />
                      ) : node?.icon ? (
                        <span className="text-lg leading-none">{node.icon}</span>
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground/60" />
                      )}
                    </div>

                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</p>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={removeProduct.isPending}
                      onClick={() => {
                        void removeProduct.mutateAsync(row.id).then(
                          () => toast.success("Producto eliminado de frecuentes."),
                          (error: Error) => toast.error(error.message || "No se pudo eliminar."),
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {atLimit ? (
            <p className="mt-3 text-xs font-medium text-amber-800">
              Límite alcanzado. Elimina un producto de la lista para agregar otro.
            </p>
          ) : null}
        </div>
      </div>

      <ExtraFrequentAddDialog
        node={pickerNode}
        open={Boolean(pickerNode)}
        adding={addProduct.isPending}
        onClose={() => setPickerNode(null)}
        onConfirm={() => void handleConfirmAdd()}
      />
    </div>
  );
}
