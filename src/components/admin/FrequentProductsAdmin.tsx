import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GripVertical, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import MenuNavigator from "@/components/order/MenuNavigator";
import { ExtraFrequentAddDialog } from "@/components/admin/ExtraFrequentAddDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/contexts/BranchContext";
import {
  FREQUENT_PRODUCT_CONTEXTS,
  useFrequentProducts,
  type FrequentProductContext,
  type FrequentProductRow,
} from "@/hooks/useFrequentProducts";
import { fetchMenuTreeNodes, type MenuNode } from "@/hooks/useMenuTree";
import { buildCompositeMenuNodes } from "@/lib/compositeMenuTree";
import { cn } from "@/lib/utils";

const CONTEXT_HELP: Record<FrequentProductContext, string> = {
  MESA: "Menú Mesa completo (incluye Platos). Accesos rápidos en órdenes de mesa.",
  TAKEOUT: "Menú Con envase (Para llevar). Accesos rápidos al tomar órdenes para llevar.",
  EXPRESS: "Mismo menú que Express en caja. Accesos rápidos en órdenes Express.",
  EXTRA: "Menú Mesa sin Platos. Accesos rápidos en órdenes Extra.",
};

export default function FrequentProductsAdmin() {
  const { activeBranchId } = useBranch();
  const [context, setContext] = useState<FrequentProductContext>("MESA");
  const { products, isLoading, addProduct, removeProduct, reorderProducts } = useFrequentProducts(
    activeBranchId,
    context,
  );
  const [pickerNode, setPickerNode] = useState<MenuNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [localProducts, setLocalProducts] = useState<FrequentProductRow[]>([]);
  const draggingIdRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const pointerListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    end: (event: PointerEvent) => void;
  } | null>(null);

  useEffect(() => {
    setLocalProducts(products);
  }, [products]);

  useEffect(() => {
    return () => {
      if (pointerListenersRef.current) {
        window.removeEventListener("pointermove", pointerListenersRef.current.move);
        window.removeEventListener("pointerup", pointerListenersRef.current.end);
        window.removeEventListener("pointercancel", pointerListenersRef.current.end);
      }
    };
  }, []);

  const listProducts = localProducts.length > 0 || !isLoading ? localProducts : products;

  const usesCompositeTakeoutMenu = context === "TAKEOUT" || context === "EXPRESS";

  const compositeMenuQuery = useQuery({
    queryKey: ["frequent-admin-composite-menu", activeBranchId, context],
    queryFn: async () => {
      const [takeoutNodes, tableNodes] = await Promise.all([
        fetchMenuTreeNodes({ branchId: activeBranchId!, menuScope: "TAKEOUT" }),
        fetchMenuTreeNodes({ branchId: activeBranchId!, menuScope: "TABLE" }),
      ]);
      return buildCompositeMenuNodes(takeoutNodes, tableNodes);
    },
    enabled: !!activeBranchId && usesCompositeTakeoutMenu,
    staleTime: 60_000,
  });

  const selectedNodeIds = useMemo(() => new Set(listProducts.map((row) => row.menu_node_id)), [listProducts]);

  const handleSelectProduct = (node: MenuNode) => {
    if (node.node_type !== "product") return;
    if (!node.is_active) {
      toast.error("Este producto está agotado.");
      return;
    }
    if (selectedNodeIds.has(node.id)) return;
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

  const reorderLocalList = (fromId: string, toId: string) => {
    const currentIds = listProducts.map((row) => row.id);
    const fromIndex = currentIds.indexOf(fromId);
    const toIndex = currentIds.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;

    const nextRows = [...listProducts];
    const [moved] = nextRows.splice(fromIndex, 1);
    nextRows.splice(toIndex, 0, moved);
    return nextRows;
  };

  const applyReorder = async (fromId: string, toId: string) => {
    if (fromId === toId) return;

    const nextRows = reorderLocalList(fromId, toId);
    if (!nextRows) return;

    const nextIds = nextRows.map((row) => row.id);
    setLocalProducts(nextRows);

    try {
      await reorderProducts.mutateAsync(nextIds);
    } catch (error: any) {
      setLocalProducts(products);
      toast.error(error?.message || "No se pudo reordenar la lista.");
    }
  };

  const clearDragState = () => {
    draggingIdRef.current = null;
    dragOverIdRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
  };

  const stopPointerDragListeners = () => {
    if (!pointerListenersRef.current) return;
    window.removeEventListener("pointermove", pointerListenersRef.current.move);
    window.removeEventListener("pointerup", pointerListenersRef.current.end);
    window.removeEventListener("pointercancel", pointerListenersRef.current.end);
    pointerListenersRef.current = null;
  };

  const startPointerDrag = (rowId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const gripEl = event.currentTarget;
    draggingIdRef.current = rowId;
    dragOverIdRef.current = rowId;
    setDraggingId(rowId);
    setDragOverId(rowId);
    gripEl.setPointerCapture(event.pointerId);
    event.preventDefault();

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const hovered = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const rowEl = hovered?.closest("[data-frequent-row-id]");
      const hoveredId = rowEl?.getAttribute("data-frequent-row-id");
      if (!hoveredId || hoveredId === dragOverIdRef.current) return;
      dragOverIdRef.current = hoveredId;
      setDragOverId(hoveredId);
    };

    const handlePointerEnd = (endEvent: PointerEvent) => {
      if (gripEl.hasPointerCapture(endEvent.pointerId)) {
        gripEl.releasePointerCapture(endEvent.pointerId);
      }
      stopPointerDragListeners();

      const fromId = draggingIdRef.current;
      const toId = dragOverIdRef.current;
      clearDragState();

      if (fromId && toId) {
        void applyReorder(fromId, toId);
      }
    };

    pointerListenersRef.current = { move: handlePointerMove, end: handlePointerEnd };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground">
        Selecciona una sucursal activa para configurar productos frecuentes.
      </div>
    );
  }

  const contextLabel = FREQUENT_PRODUCT_CONTEXTS.find((item) => item.value === context)?.label ?? context;

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-orange-200 bg-white/85 p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">Más frecuentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">{CONTEXT_HELP[context]}</p>
          </div>
          <div className="w-full sm:w-56">
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Configurar para</label>
            <Select value={context} onValueChange={(value) => setContext(value as FrequentProductContext)}>
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="Seleccionar opción" />
              </SelectTrigger>
              <SelectContent>
                {FREQUENT_PRODUCT_CONTEXTS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid min-h-[560px] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="min-h-[480px] rounded-[24px] border border-orange-200 bg-white/90 p-3 shadow-sm sm:p-4">
          {context === "MESA" ? (
            <MenuNavigator menuScope="TABLE" hidePrices onSelectProduct={handleSelectProduct} />
          ) : context === "EXTRA" ? (
            <MenuNavigator
              menuScope="TABLE"
              hidePrices
              excludedRootCategoryNames={["PLATOS"]}
              onSelectProduct={handleSelectProduct}
            />
          ) : (
            <MenuNavigator
              menuScope="TAKEOUT"
              hidePrices
              nodesOverride={compositeMenuQuery.data ?? null}
              forceLoading={compositeMenuQuery.isLoading}
              onSelectProduct={handleSelectProduct}
            />
          )}
        </div>

        <div className="flex min-h-[480px] flex-col rounded-[24px] border border-teal-200 bg-gradient-to-br from-teal-50/80 via-white to-cyan-50/60 p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="font-display text-base font-bold text-foreground">Lista de frecuentes — {contextLabel}</h3>
            <p className="text-xs text-muted-foreground">{listProducts.length} productos</p>
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : listProducts.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-teal-200 bg-white/70 p-6 text-center text-sm text-muted-foreground">
              Aún no hay productos frecuentes. Selecciona productos del menú de la izquierda.
            </div>
          ) : (
            <div className={cn("min-h-0 flex-1 space-y-2 overflow-y-auto pr-1", draggingId && "select-none")}>
              {listProducts.map((row, index) => {
                const node = row.menu_node;
                const label = node?.name ?? "Producto";
                const isDragOver = dragOverId === row.id && draggingId !== row.id;

                return (
                  <div
                    key={row.id}
                    data-frequent-row-id={row.id}
                    className={cn(
                      "flex items-center gap-2 rounded-2xl border bg-white p-2 shadow-sm transition",
                      draggingId === row.id && "opacity-60",
                      isDragOver ? "border-teal-400 ring-2 ring-teal-200" : "border-teal-100",
                    )}
                  >
                    <div
                      onPointerDown={(event) => startPointerDrag(row.id, event)}
                      className="flex h-9 w-9 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-xl text-muted-foreground active:cursor-grabbing"
                      aria-label={`Reordenar ${label}`}
                      title="Arrastrar para reordenar"
                    >
                      <GripVertical className="h-4 w-4 pointer-events-none" />
                    </div>

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
