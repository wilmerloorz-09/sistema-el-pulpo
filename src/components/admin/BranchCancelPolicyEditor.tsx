import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface BranchCancelPolicyDraftRow {
  menu_node_id: string;
  menu_node_name: string;
  parent_id: string | null;
  depth: number;
  descendant_product_count: number;
  is_primary_root_category: boolean;
  is_kitchen_plate: boolean;
  allow_direct_cancel: boolean;
}

interface BranchCancelPolicyEditorProps {
  rows: BranchCancelPolicyDraftRow[];
  isGlobalAdmin: boolean;
  onChange: (
    menuNodeId: string,
    patch: Partial<Pick<BranchCancelPolicyDraftRow, "allow_direct_cancel">>,
  ) => void;
  disabled?: boolean;
  className?: string;
}

export default function BranchCancelPolicyEditor({
  rows,
  isGlobalAdmin,
  onChange,
  disabled = false,
  className,
}: BranchCancelPolicyEditorProps) {
  return (
    <section
      className={cn(
        "rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-black text-foreground sm:text-base">
              Cancelacion/Anulacion directa de orden por categoria
            </h4>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Marca que categorias nivel 0 permiten anulacion directa por mesero.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="w-fit border-rose-200 bg-rose-50 text-rose-700"
        >
          {rows.length} categorias nivel 0
        </Badge>
      </div>

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 px-4 py-8 text-center text-sm text-muted-foreground">
            No hay categorias nivel 0 activas en esta sucursal.
          </div>
        ) : (
          <div className="divide-y divide-rose-100 overflow-hidden rounded-2xl bg-white/70">
            {rows.map((row) => {
              const isLocked = disabled || (!isGlobalAdmin && row.is_primary_root_category);

              return (
                <label
                  key={row.menu_node_id}
                  className={cn(
                    "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                    isLocked ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3 sm:items-center">
                    <Checkbox
                      checked={row.allow_direct_cancel}
                      disabled={isLocked}
                      onCheckedChange={(checked) =>
                        onChange(row.menu_node_id, { allow_direct_cancel: checked === true })
                      }
                      className="mt-0.5 sm:mt-0"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {row.menu_node_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.descendant_product_count} producto
                        {row.descendant_product_count === 1 ? "" : "s"} en su rama
                      </p>
                    </div>
                  </div>

                  {row.is_primary_root_category && (
                    <Badge
                      variant="outline"
                      className="w-fit self-start border-sky-200 bg-sky-50 text-[10px] text-sky-800 sm:self-center sm:text-xs"
                    >
                      Solo admin general
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
