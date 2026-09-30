import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MenuNavigator from "@/components/order/MenuNavigator";
import type { MenuNode } from "@/hooks/useMenuTree";
import {
  filtrarArbolPorProducto,
  resolveProductoGlobalId,
  useArbolProductosComprados,
} from "@/components/admin/BodegaGeneralArbolPanel";

type CompraProductoArbolDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Productos que se pueden comprar (los mismos del combo). */
  allowedIds: Set<string>;
  /** Productos ya usados en otras líneas de la compra. */
  usedIds: Set<string>;
  currentId: string;
  onSelect: (productoGlobalId: string) => void;
};

const CompraProductoArbolDialog = ({
  open,
  onOpenChange,
  allowedIds,
  usedIds,
  currentId,
  onSelect,
}: CompraProductoArbolDialogProps) => {
  const { nodosComprados } = useArbolProductosComprados();

  const nodos = useMemo(() => {
    if (!nodosComprados) return null;
    // is_active del menú de la sucursal no aplica a compras; todos se pueden elegir.
    return filtrarArbolPorProducto(nodosComprados, (id) => allowedIds.has(id)).map((node) => ({
      ...node,
      is_active: true,
    }));
  }, [nodosComprados, allowedIds]);

  const usadoEnOtraLinea = (node: MenuNode) => {
    const id = resolveProductoGlobalId(node);
    return Boolean(id && id !== currentId && usedIds.has(id));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col gap-3 rounded-2xl">
        <DialogHeader>
          <DialogTitle>Seleccionar producto</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {open ? (
            <MenuNavigator
              menuScope="TABLE"
              hidePrices
              includeInactive
              nodesOverride={nodos ?? []}
              forceLoading={!nodos}
              isProductBlocked={usadoEnOtraLinea}
              renderNodeAction={(node) =>
                usadoEnOtraLinea(node) ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    Ya está en la compra
                  </span>
                ) : null
              }
              onSelectProduct={(node) => {
                const id = resolveProductoGlobalId(node);
                if (!id || usadoEnOtraLinea(node)) return;
                onSelect(id);
                onOpenChange(false);
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CompraProductoArbolDialog;
