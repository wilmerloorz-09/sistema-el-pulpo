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
      <div className="flex items-center justify-center rounded-2xl border border-teal-200/70 bg-teal-50/40 px-4 py-3">
        <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
      </div>
    );
  }

  if (visibleProducts.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Más frecuentes</p>
      <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
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
                "flex w-[7.5rem] shrink-0 flex-col items-center gap-2 rounded-[1.15rem] border border-teal-300/80 bg-white px-2 py-2.5 text-center shadow-sm transition",
                !disabled && "hover:border-teal-400 hover:bg-teal-50/50 active:scale-[0.98]",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-teal-50 ring-1 ring-teal-200/70">
                {node.image_url ? (
                  <img src={node.image_url} alt={node.name} className="h-full w-full object-cover" />
                ) : node.icon ? (
                  <span className="text-2xl leading-none">{node.icon}</span>
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
                )}
              </div>
              <span className="line-clamp-2 w-full text-[11px] font-semibold leading-snug text-foreground">{node.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
