import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { CircleDollarSign, LayoutGrid, Loader2, Plus, ShoppingBag, Sparkles, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { cn } from "@/lib/utils";
import { canOperate } from "@/lib/permissions";
import { roundMoney } from "@/lib/paymentQuantity";
import { formatSplitCodeLabel } from "@/lib/splitCode";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

const STATUS_CONFIG = {
  free: {
    bg: "bg-gradient-to-br from-sky-50 via-white to-cyan-50 dark:from-sky-950/30 dark:via-card dark:to-cyan-950/30",
    border: "border-sky-200/80 dark:border-sky-800/60",
    text: "text-sky-600 dark:text-sky-400",
    label: "Libre",
    icon: null,
    artWrap:
      "border-sky-200 bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-300 text-white shadow-lg dark:border-sky-800 dark:from-sky-600 dark:via-cyan-600 dark:to-teal-500",
    artIcon: <LayoutGrid className="h-6 w-6" />,
    artIconLg: <LayoutGrid className="h-8 w-8" />,
  },
  occupied: {
    bg: "bg-gradient-to-br from-orange-50 via-white to-amber-50 dark:from-orange-950/30 dark:via-card dark:to-amber-950/30",
    border: "border-orange-200/80 dark:border-orange-800/60",
    text: "text-primary dark:text-orange-400",
    label: "Ocupada",
    icon: <Users className="h-3.5 w-3.5" />,
    artWrap:
      "border-orange-200 bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300 text-white shadow-lg dark:border-orange-800 dark:from-orange-600 dark:via-amber-500 dark:to-yellow-500",
    artIcon: <Users className="h-6 w-6" />,
    artIconLg: <Users className="h-8 w-8" />,
  },
  to_pay: {
    bg: "bg-gradient-to-br from-amber-50 via-white to-lime-50 dark:from-amber-950/30 dark:via-card dark:to-lime-950/30",
    border: "border-lime-300/80 dark:border-lime-800/60",
    text: "text-amber-700 dark:text-amber-400",
    label: "Por pagar",
    icon: <CircleDollarSign className="h-3.5 w-3.5" />,
    artWrap:
      "border-lime-200 bg-gradient-to-br from-emerald-500 via-lime-400 to-yellow-300 text-white shadow-lg dark:border-lime-800 dark:from-emerald-600 dark:via-lime-600 dark:to-yellow-500",
    artIcon: <CircleDollarSign className="h-6 w-6" />,
    artIconLg: <CircleDollarSign className="h-8 w-8" />,
  },
} as const;

const formatCurrency = (value: number) => `$${roundMoney(value).toFixed(2)}`;

const Mesas = () => {
  const { data: tables, isLoading } = useTablesWithStatus();
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);
  const [creatingTakeout, setCreatingTakeout] = useState(false);
  const [creatingSpecial, setCreatingSpecial] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const canOperateMesas = canOperate(permissions, "mesas");

  useEffect(() => {
    if (!tables || tables.length === 0) {
      setSelectedTableId(null);
      return;
    }

    setSelectedTableId((current) => {
      if (current && tables.some((table) => table.id === current)) {
        return current;
      }
      return null;
    });
  }, [tables]);

  const handleTakeout = async () => {
    if (!user || !activeBranchId || !canOperateMesas) return;
    setCreatingTakeout(true);
    try {
      const { data: draftCandidates, error: existingDraftError } = await supabase
        .from("orders")
        .select("id")
        .eq("branch_id", activeBranchId)
        .eq("created_by", user.id)
        .eq("order_type", "TAKEOUT")
        .eq("status", "DRAFT")
        .order("updated_at", { ascending: false })
        .limit(10);

      if (existingDraftError) throw existingDraftError;

      const candidateIds = (draftCandidates ?? []).map((candidate) => candidate.id);
      let reusableDraftId: string | null = null;

      if (candidateIds.length > 0) {
        const { data: candidateItems, error: candidateItemsError } = await supabase
          .from("order_items")
          .select("order_id, status")
          .in("order_id", candidateIds);

        if (candidateItemsError) throw candidateItemsError;

        const itemsByOrder = new Map<string, string[]>();
        for (const orderId of candidateIds) {
          itemsByOrder.set(orderId, []);
        }

        for (const item of candidateItems ?? []) {
          const bucket = itemsByOrder.get(item.order_id) ?? [];
          bucket.push(String(item.status ?? "DRAFT"));
          itemsByOrder.set(item.order_id, bucket);
        }

        reusableDraftId = candidateIds.find((orderId) => {
          const statuses = itemsByOrder.get(orderId) ?? [];
          return statuses.every((status) => status === "DRAFT");
        }) ?? null;
      }

      if (reusableDraftId) {
        navigate(`/ordenes?order=${reusableDraftId}`);
        return;
      }

      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_type: "TAKEOUT" as const,
          menu_scope: "TAKEOUT",
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId,
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Orden para llevar creada");
      navigate(`/ordenes?order=${data.id}`);
    } catch (err: any) {
      toast.error(err.message || "Error al abrir orden para llevar");
    } finally {
      setCreatingTakeout(false);
    }
  };

  const handleSpecialOrder = async () => {
    if (!user || !activeBranchId || !canOperateMesas) return;
    setCreatingSpecial(true);
    try {
      const { data: draftCandidates, error: existingDraftError } = await supabase
        .from("orders")
        .select("id")
        .eq("branch_id", activeBranchId)
        .eq("created_by", user.id)
        .eq("order_type", "DINE_IN")
        .eq("is_special", true)
        .eq("status", "DRAFT")
        .order("updated_at", { ascending: false })
        .limit(10);

      if (existingDraftError) throw existingDraftError;

      const candidateIds = (draftCandidates ?? []).map((candidate) => candidate.id);
      let reusableDraftId: string | null = null;

      if (candidateIds.length > 0) {
        const { data: candidateItems, error: candidateItemsError } = await supabase
          .from("order_items")
          .select("order_id, status")
          .in("order_id", candidateIds);

        if (candidateItemsError) throw candidateItemsError;

        const itemsByOrder = new Map<string, string[]>();
        for (const orderId of candidateIds) {
          itemsByOrder.set(orderId, []);
        }

        for (const item of candidateItems ?? []) {
          const bucket = itemsByOrder.get(item.order_id) ?? [];
          bucket.push(String(item.status ?? "DRAFT"));
          itemsByOrder.set(item.order_id, bucket);
        }

        reusableDraftId = candidateIds.find((orderId) => {
          const statuses = itemsByOrder.get(orderId) ?? [];
          return statuses.every((status) => status === "DRAFT");
        }) ?? null;
      }

      if (reusableDraftId) {
        navigate(`/ordenes?order=${reusableDraftId}`);
        return;
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_type: "DINE_IN" as const,
          menu_scope: "TABLE",
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId,
          is_special: true,
          special_marked_at: now,
          special_marked_by: user.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Orden especial creada");
      navigate(`/ordenes?order=${data.id}`);
    } catch (err: any) {
      toast.error(err.message || "Error al abrir orden especial");
    } finally {
      setCreatingSpecial(false);
    }
  };

  const handleTableTap = (table: NonNullable<typeof tables>[number]) => {
    setSelectedTableId(table.id);
    setDrawerOpen(true);
  };

  const handleTableAction = async (table: NonNullable<typeof tables>[number]) => {
    setDrawerOpen(false);
    
    if (table.status === "free") {
      if (!canOperateMesas) return;
      if (table.activeOrderId) {
        navigate(`/ordenes?order=${table.activeOrderId}`);
        return;
      }
      if (!user) return;
      setCreating(table.id);
      try {
        const { data, error } = await supabase
          .from("orders")
          .insert({
            table_id: table.id,
            order_type: "DINE_IN" as const,
            menu_scope: "TABLE",
            created_by: user.id,
            status: "DRAFT" as const,
            branch_id: activeBranchId!,
          })
          .select("id")
          .single();

        if (error) throw error;
        toast.success(`Orden creada para ${table.name}`);
        navigate(`/ordenes?order=${data.id}`);
      } catch (err: any) {
        toast.error(err.message || "Error al crear orden");
      } finally {
        setCreating(null);
      }
    } else if (table.activeOrderId) {
      navigate(`/ordenes?order=${table.activeOrderId}`);
    }
  };

  const selectedTable = tables?.find((table) => table.id === selectedTableId) ?? null;
  const selectedConfig = selectedTable ? STATUS_CONFIG[selectedTable.status] : null;

  const getPrimaryActionLabel = (table: NonNullable<typeof tables>[number]) => {
    if (table.status === "free") {
      return canOperateMesas ? "Abrir mesa" : "Sin acciones";
    }
    return table.status === "to_pay" ? "Ver orden por cobrar" : "Ver orden activa";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const freeCount = tables?.filter((table) => table.status === "free").length ?? 0;
  const occupiedCount = tables?.filter((table) => table.status === "occupied").length ?? 0;
  const toPayCount = tables?.filter((table) => table.status === "to_pay").length ?? 0;

  return (
    <div className="flex min-h-full flex-col pb-4">
      {/* Compact Header with Pill Buttons */}
      <div className="sticky top-0 z-20 bg-background/95 px-3 pb-2 pt-3 backdrop-blur-md">
        {/* Quick Action Pills */}
        <div className="flex gap-2">
          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={handleTakeout}
            disabled={creatingTakeout || !canOperateMesas}
            className={cn(
              "flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border-2 px-3 text-sm font-bold shadow-md transition-all active:scale-[0.97]",
              "border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 dark:border-emerald-800 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-300",
              canOperateMesas ? "hover:shadow-lg" : "cursor-not-allowed opacity-50",
            )}
          >
            {creatingTakeout ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ShoppingBag className="h-4 w-4" />
                <span>Para Llevar</span>
                {canOperateMesas && <Plus className="h-3.5 w-3.5 opacity-60" />}
              </>
            )}
          </motion.button>

          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            onClick={handleSpecialOrder}
            disabled={creatingSpecial || !canOperateMesas}
            className={cn(
              "flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl border-2 px-3 text-sm font-bold shadow-md transition-all active:scale-[0.97]",
              "border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 text-primary dark:border-orange-800 dark:from-orange-950/40 dark:to-amber-950/40 dark:text-orange-300",
              canOperateMesas ? "hover:shadow-lg" : "cursor-not-allowed opacity-50",
            )}
          >
            {creatingSpecial ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Especial</span>
                {canOperateMesas && <Plus className="h-3.5 w-3.5 opacity-60" />}
              </>
            )}
          </motion.button>
        </div>

        {/* Status Summary */}
        <div className="mt-3 flex items-center justify-between">
          <h1 className="font-display text-lg font-bold text-foreground">Mesas</h1>
          <div className="flex gap-1.5 text-[10px] font-semibold">
            <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              {freeCount}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-primary dark:bg-orange-950/50 dark:text-orange-400">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {occupiedCount}
            </span>
            {toPayCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-lime-100 px-2 py-0.5 text-lime-700 dark:bg-lime-950/50 dark:text-lime-400">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-500" />
                {toPayCount}
              </span>
            )}
          </div>
        </div>

        {!canOperateMesas && (
          <div className="mt-2">
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] text-muted-foreground">
              Solo consulta
            </span>
          </div>
        )}
      </div>

      {/* Tables Grid - 2 columns on mobile, 3 on tablet */}
      <div className="flex-1 px-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
          {tables?.map((table, index) => {
            const config = STATUS_CONFIG[table.status];
            const isCreating = creating === table.id;
            const isFreeAndReadonly = table.status === "free" && !canOperateMesas;

            return (
              <motion.button
                key={table.id}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.025 }}
                onClick={() => handleTableTap(table)}
                disabled={isCreating}
                className={cn(
                  "relative flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 p-3 shadow-md transition-all active:scale-[0.96]",
                  config.bg,
                  config.border,
                  table.status === "free" && canOperateMesas && "hover:shadow-lg",
                  isFreeAndReadonly && "cursor-default opacity-60",
                  selectedTableId === table.id && drawerOpen && "ring-2 ring-primary/40 ring-offset-2",
                )}
              >
                {isCreating ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                ) : (
                  <>
                    {/* Table Icon */}
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border-2", config.artWrap)}>
                      {config.artIcon}
                    </div>

                    {/* Table Number - Large and Clear */}
                    <span className={cn("font-display text-xl font-black leading-none", config.text)}>
                      {table.name}
                    </span>

                    {/* Status Badge */}
                    <div className={cn("flex items-center gap-1 text-[10px] font-semibold", config.text)}>
                      {config.icon}
                      <span>{config.label}</span>
                    </div>

                    {/* Amount Badge - Only for occupied/to_pay tables */}
                    {table.totalDue > 0 && (
                      <div className="absolute bottom-2 right-2 rounded-full border border-amber-300 bg-white/95 px-2 py-0.5 text-[10px] font-black text-amber-700 shadow-sm dark:border-amber-700 dark:bg-card/95 dark:text-amber-400">
                        {formatCurrency(table.totalDue)}
                      </div>
                    )}

                    {/* Plus indicator for free tables */}
                    {table.status === "free" && canOperateMesas && (
                      <div className="absolute right-2 top-2 rounded-full bg-sky-500/15 p-1">
                        <Plus className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                      </div>
                    )}

                    {/* Splits indicator */}
                    {table.splitCount > 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold text-secondary-foreground">
                        {table.splitCount}
                      </span>
                    )}
                  </>
                )}
              </motion.button>
            );
          })}
        </div>

        {(tables?.length ?? 0) === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-muted/50 p-4 text-center text-sm text-muted-foreground">
            No hay mesas habilitadas para el turno actual.
          </div>
        )}
      </div>

      {/* Bottom Sheet for Table Details */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[85vh] rounded-t-3xl">
          {selectedTable && selectedConfig && (
            <>
              <DrawerHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-14 w-14 items-center justify-center rounded-2xl border-2", selectedConfig.artWrap)}>
                      {selectedConfig.artIconLg}
                    </div>
                    <div>
                      <DrawerTitle className="font-display text-2xl font-black text-foreground">
                        {selectedTable.name}
                      </DrawerTitle>
                      <div className={cn("mt-1 flex items-center gap-1 text-sm font-semibold", selectedConfig.text)}>
                        {selectedConfig.icon}
                        <span>{selectedConfig.label}</span>
                      </div>
                    </div>
                  </div>
                  <DrawerClose asChild>
                    <button className="rounded-full bg-muted p-2 text-muted-foreground transition-colors hover:bg-muted/80">
                      <X className="h-5 w-5" />
                    </button>
                  </DrawerClose>
                </div>
              </DrawerHeader>

              <div className="px-4 py-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Saldo Pendiente
                    </div>
                    <div className="mt-1 font-display text-2xl font-black text-foreground">
                      {formatCurrency(selectedTable.totalDue)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Divisiones
                    </div>
                    <div className="mt-1 font-display text-2xl font-black text-foreground">
                      {selectedTable.splitCount}
                    </div>
                  </div>
                </div>

                {/* Split Details */}
                {selectedTable.splitTotals.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-border bg-card/50 p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Detalle de Divisiones
                    </div>
                    <div className="space-y-2">
                      {selectedTable.splitTotals.slice(0, 4).map((split) => (
                        <div
                          key={split.splitId ?? "base"}
                          className="flex items-center justify-between rounded-xl bg-background px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-foreground">
                            {formatSplitCodeLabel(split.splitCode) || "Mesa base"}
                          </span>
                          <span className="text-sm font-black text-amber-700 dark:text-amber-400">
                            {formatCurrency(split.totalDue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty State Message */}
                {selectedTable.status === "free" && selectedTable.splitTotals.length === 0 && (
                  <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                    Esta mesa esta libre y lista para abrirse.
                  </div>
                )}
              </div>

              <DrawerFooter className="pt-0">
                <button
                  type="button"
                  onClick={() => void handleTableAction(selectedTable)}
                  disabled={creating === selectedTable.id || (selectedTable.status === "free" && !canOperateMesas)}
                  className={cn(
                    "flex h-14 w-full items-center justify-center rounded-2xl text-base font-bold transition-all active:scale-[0.98]",
                    selectedTable.status === "free"
                      ? "bg-gradient-to-r from-primary via-orange-500 to-amber-400 text-white shadow-lg"
                      : "border-2 border-border bg-card text-foreground hover:bg-muted",
                    (creating === selectedTable.id || (selectedTable.status === "free" && !canOperateMesas)) &&
                      "cursor-not-allowed opacity-50",
                  )}
                >
                  {creating === selectedTable.id ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    getPrimaryActionLabel(selectedTable)
                  )}
                </button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default Mesas;
