import { ImageIcon, Loader2 } from "lucide-react";
import { useBranch } from "@/contexts/BranchContext";
import { useExtraFrequentProducts } from "@/hooks/useExtraFrequentProducts";
import type { MenuNode } from "@/hooks/useMenuTree";
import { cn } from "@/lib/utils";

interface Props {
  onSelectProduct: (node: MenuNode) => void;
  disabled?: boolean;
}

export default function ExtraFrequentProductCards({ onSelectProduct, disabled = false }: Props) {
  const { activeBranchId } = useBranch();
  const { products, isLoading } = useExtraFrequentProducts(activeBranchId);

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
      <div className="grid grid-cols-4 gap-1.5 min-[360px]:grid-cols-5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 xl:grid-cols-6">
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
                "flex min-h-[4.35rem] w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-teal-300/80 bg-white px-1 py-1.5 text-center shadow-sm transition sm:min-h-[4.75rem] sm:gap-1.5 sm:rounded-[1rem] sm:px-1.5 sm:py-2",
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
  );
}
