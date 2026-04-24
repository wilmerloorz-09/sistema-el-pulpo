import { Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface BranchCancelPolicyDraftRow {
  menu_node_id: string;
  menu_node_name: string;
  menu_scope?: "TABLE" | "TAKEOUT" | "BULK" | null;
  parent_id: string | null;
  depth: number;
  descendant_product_count: number;
  is_primary_root_category: boolean;
  is_kitchen_plate: boolean;
  allow_direct_cancel: boolean;
}

function getMenuScopeLabel(menuScope?: "TABLE" | "TAKEOUT" | "BULK" | null) {
  if (menuScope === "TAKEOUT") return "Menu para llevar";
  if (menuScope === "BULK") return "Menu A Granel";
  return "Menu mesa";
}

function normalizeCategoryName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function getCancelPolicyRowSortOrder(row: BranchCancelPolicyDraftRow) {
  const normalizedName = normalizeCategoryName(row.menu_node_name);

  if (row.menu_scope === "TABLE" && normalizedName === "PLATOS") return 0;
  if (row.menu_scope === "TAKEOUT" && normalizedName.includes("PLATOS")) return 1;
  if (row.menu_scope === "BULK" && normalizedName.includes("PLATOS")) return 2;
  if (normalizedName === "BEBIDAS") return 3;
  if (normalizedName === "VARIOS") return 4;

  return 99;
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
  const sortedRows = [...rows].sort((a, b) => {
    const orderDifference = getCancelPolicyRowSortOrder(a) - getCancelPolicyRowSortOrder(b);
    if (orderDifference !== 0) return orderDifference;

    if (a.menu_scope !== b.menu_scope) {
      return (a.menu_scope ?? "").localeCompare(b.menu_scope ?? "");
    }

    return a.menu_node_name.localeCompare(b.menu_node_name);
  });

  return (
    <section
      className={cn(
        "rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-700">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-black text-foreground sm:text-base">
              Anulacion sin autorizacion
            </h4>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 px-4 py-8 text-center text-sm text-muted-foreground">
            No hay categorias nivel 0 activas en esta sucursal.
          </div>
        ) : (
          <div className="divide-y divide-rose-100 overflow-hidden rounded-2xl bg-white/70">
            {sortedRows.map((row) => {
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
                        <span className="ml-2 text-xs font-medium text-slate-500">
                          · {getMenuScopeLabel(row.menu_scope)}
                        </span>
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
