import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ImageIcon, ShoppingBag } from "lucide-react";
import type { MenuNode } from "@/hooks/useMenuTree";

interface Props {
  node: MenuNode | null;
  open: boolean;
  adding?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ExtraFrequentAddDialog({ node, open, adding = false, onClose, onConfirm }: Props) {
  return (
    <Dialog open={open && Boolean(node)} onOpenChange={(value) => !value && onClose()}>
      {node ? (
        <DialogContent className="max-w-sm rounded-[24px] border-orange-200/40 bg-background p-5 shadow-xl sm:rounded-[28px]">
          <DialogHeader className="mb-1 text-left">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-100 text-primary shadow-sm">
                {node.image_url ? (
                  <img src={node.image_url} alt={node.name} className="h-full w-full object-cover" />
                ) : node.icon ? (
                  <span className="text-[1.5rem] leading-none">{node.icon}</span>
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground/60" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="font-display text-xl font-bold leading-tight text-foreground">{node.name}</DialogTitle>
              </div>
            </div>
          </DialogHeader>

          <div className="flex justify-end pt-2">
            <Button type="button" className="h-11 gap-2 rounded-xl px-6" disabled={adding} onClick={onConfirm}>
              <ShoppingBag className="h-4 w-4" />
              {adding ? "Agregando..." : "Agregar"}
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
