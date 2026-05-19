import { ImageIcon, Loader2 } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useFrequentProducts, type FrequentProductContext } from "@/hooks/useFrequentProducts";
import type { MenuNode } from "@/hooks/useMenuTree";
import { cn } from "@/lib/utils";

interface Props {
  context: FrequentProductContext;
  onSelectProduct: (node: MenuNode) => void;
  disabled?: boolean;
}

export default function FrequentProductCards({ context, onSelectProduct, disabled = false }: Props) {
  const { activeBranchId } = useBranch();
  const { products, isLoading } = useFrequentProducts(activeBranchId, context);

  const visibleProducts = products.filter((row) => row.menu_node?.is_active !== false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-teal-200/70 bg-teal-50/40 px-3 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-teal-700" />
      </div>
    );
  }

  if (visibleProducts.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800 sm:text-xs">Más frecuentes</p>
      <div
        data-no-order-swipe
        className="scrollbar-none -mx-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-0.5 touch-pan-x"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="grid w-max grid-flow-col grid-rows-2 gap-1.5 auto-cols-[4.65rem] sm:auto-cols-[5rem]">
          {visibleProducts.map((row) => {
            const node = row.menu_node;
            if (!node) return null;

            return (
              <button
                key={row.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onSelectProduct(node);
                }}
                className={cn(
                  "flex h-[4.35rem] w-[4.65rem] flex-col items-center justify-center gap-1 rounded-xl border border-teal-300/80 bg-white px-1 py-1.5 text-center shadow-sm transition sm:h-[4.75rem] sm:w-[5rem] sm:gap-1.5 sm:rounded-[1rem] sm:px-1.5 sm:py-2",
                  !disabled && "hover:border-teal-400 hover:bg-teal-50/50 active:scale-[0.98]",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-teal-50 ring-1 ring-teal-200/70 sm:h-9 sm:w-9 sm:rounded-xl">
                  {node.image_url ? (
                    <img src={node.image_url} alt={node.name} className="h-full w-full object-cover" />
                  ) : node.icon ? (
                    <span className="text-base leading-none sm:text-lg">{node.icon}</span>
                  ) : (
                    <ImageIcon className="h-4 w-4 text-muted-foreground/60 sm:h-5 sm:w-5" />
                  )}
                </div>
                <span className="line-clamp-2 w-full text-[9px] font-semibold leading-tight text-foreground sm:text-[10px] sm:leading-snug">
                  {node.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
