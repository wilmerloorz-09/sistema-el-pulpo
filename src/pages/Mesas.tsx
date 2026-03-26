import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { CircleDollarSign, LayoutGrid, Loader2, Plus, ShoppingBag, Sparkles, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { cn } from "@/lib/utils";
import { canOperate } from "@/lib/permissions";
import { roundMoney } from "@/lib/paymentQuantity";
import { formatSplitCodeLabel } from "@/lib/splitCode";

const STATUS_CONFIG = {
  free: {
    bg: "bg-gradient-to-br from-sky-50 via-white to-cyan-100 dark:from-sky-950/20 dark:via-card dark:to-cyan-950/20",
    border: "border-sky-300 dark:border-sky-800",
    text: "text-sky-700 dark:text-sky-400",
    label: "Libre",
    icon: null,
    artWrap:
      "border-sky-200 bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-300 text-white shadow-[0_18px_38px_-24px_rgba(14,165,233,0.8)] dark:border-sky-800 dark:from-sky-600 dark:via-cyan-600 dark:to-teal-500 dark:shadow-[0_18px_38px_-24px_rgba(14,165,233,0.3)]",
    artIcon: <LayoutGrid className="h-8 w-8" />,
  },
  occupied: {
    bg: "bg-gradient-to-br from-orange-50 via-white to-amber-100 dark:from-orange-950/20 dark:via-card dark:to-amber-950/20",
    border: "border-primary/40 dark:border-primary/30",
    text: "text-primary dark:text-orange-400",
    label: "Ocupada",
    icon: <Users className="h-4 w-4" />,
    artWrap:
      "border-orange-200 bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300 text-white shadow-[0_18px_38px_-24px_rgba(249,115,22,0.82)] dark:border-orange-800 dark:from-orange-600 dark:via-amber-500 dark:to-yellow-500 dark:shadow-[0_18px_38px_-24px_rgba(249,115,22,0.3)]",
    artIcon: <Users className="h-8 w-8" />,
  },
  to_pay: {
    bg: "bg-gradient-to-br from-amber-50 via-white to-lime-100 dark:from-amber-950/20 dark:via-card dark:to-lime-950/20",
    border: "border-warning/40 dark:border-warning/30",
    text: "text-amber-800 dark:text-amber-500",
    label: "Por pagar",
    icon: <CircleDollarSign className="h-4 w-4" />,
    artWrap:
      "border-lime-200 bg-gradient-to-br from-emerald-500 via-lime-400 to-yellow-300 text-white shadow-[0_18px_38px_-24px_rgba(132,204,22,0.82)] dark:border-lime-800 dark:from-emerald-600 dark:via-lime-600 dark:to-yellow-500 dark:shadow-[0_18px_38px_-24px_rgba(132,204,22,0.3)]",
    artIcon: <CircleDollarSign className="h-8 w-8" />,
  },
} as const;

const formatCurrency = (value: number) => `$${roundMoney(value).toFixed(2)}`;

const Mesas = () => {
  const { data: tables, isLoading } = useTablesWithStatus();
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const navigate = useNavigate();
  const { showDetailPanel } = useBreakpoint();
  const [creating, setCreating] = useState<string | null>(null);
  const [creatingTakeout, setCreatingTakeout] = useState(false);
  const [creatingSpecial, setCreatingSpecial] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
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

      const preferredTable = tables.find((table) => table.status !== "free") ?? tables[0];
      return preferredTable?.id ?? null;
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

  const handleTableClick = async (table: NonNullable<typeof tables>[number]) => {
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

  const selectedTable = tables?.find((table) => table.id === selectedTableId) ?? tables?.[0] ?? null;

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
  const selectedConfig = selectedTable ? STATUS_CONFIG[selectedTable.status] : null;

  return (
    <div className="pb-8">
      <section className="px-2.5 pb-2 pt-0.5 sm:px-4 sm:pt-1">
        {!canOperateMesas && (
          <div className="mb-2 flex justify-end">
            <span className="rounded-full border border-border bg-white/85 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm">
              Solo consulta
            </span>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0 }}
              onClick={handleTakeout}
              disabled={creatingTakeout || !canOperateMesas}
              className={cn(
                "relative flex min-h-[64px] items-center gap-2 overflow-hidden rounded-[18px] border-2 px-3 py-2 text-left shadow-[0_18px_36px_-28px_rgba(16,185,129,0.55)] transition-all active:scale-[0.99] sm:min-h-[68px] sm:rounded-[20px]",
                "border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-emerald-100 dark:border-emerald-800 dark:from-emerald-950/20 dark:via-card dark:to-emerald-950/30",
                canOperateMesas ? "hover:border-accent/60 hover:bg-accent/15" : "cursor-not-allowed opacity-60",
              )}
            >
              {creatingTakeout ? (
                <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-accent" />
              ) : (
                <ShoppingBag className="h-4.5 w-4.5 shrink-0 text-accent" />
              )}
              <span className="block min-w-0 pr-7 font-display text-sm font-black text-accent sm:text-base">Para Llevar</span>
              {canOperateMesas && !creatingTakeout && (
                <Plus className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent/70" />
              )}
            </motion.button>

            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 }}
              onClick={handleSpecialOrder}
              disabled={creatingSpecial || !canOperateMesas}
              className={cn(
                "relative flex min-h-[64px] items-center gap-2 overflow-hidden rounded-[18px] border-2 px-3 py-2 text-left shadow-[0_18px_36px_-28px_rgba(249,115,22,0.32)] transition-all active:scale-[0.99] sm:min-h-[68px] sm:rounded-[20px]",
                "border-orange-300 bg-gradient-to-br from-orange-50 via-white to-amber-100 dark:border-orange-800 dark:from-orange-950/20 dark:via-card dark:to-amber-950/25",
                canOperateMesas ? "hover:border-primary/45 hover:bg-primary/5" : "cursor-not-allowed opacity-60",
              )}
            >
              {creatingSpecial ? (
                <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-primary" />
              ) : (
                <Sparkles className="h-4.5 w-4.5 shrink-0 text-primary" />
              )}
              <span className="block min-w-0 pr-7 font-display text-sm font-black text-primary sm:text-base">Orden Especial</span>
              {canOperateMesas && !creatingSpecial && (
                <Plus className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary/70" />
              )}
            </motion.button>
        </div>
      </section>

      <div className="sticky top-[57px] z-30 bg-background px-2.5 pb-3 pt-2 sm:top-[65px] sm:px-4 sm:pt-3">
        <div className="surface-glow px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-lg font-bold text-foreground sm:text-xl">Mesas</h1>
            </div>
            <div className="menu-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 text-[11px] font-medium [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
              <span className="flex items-center gap-1 rounded-full border border-white/70 bg-white/85 px-2.5 py-0.5 text-muted-foreground shadow-sm">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                {freeCount} libres
              </span>
              <span className="flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-primary shadow-sm dark:border-primary/30 dark:bg-orange-950/40">
                <span className="h-2 w-2 rounded-full bg-primary" />
                {occupiedCount} ocupadas
              </span>
              {toPayCount > 0 && (
                <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-warning shadow-sm dark:border-warning/30 dark:bg-amber-950/40">
                  <span className="h-2 w-2 rounded-full bg-warning" />
                  {toPayCount} por pagar
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "px-2.5 sm:px-4",
          showDetailPanel && "grid grid-cols-[minmax(0,1fr)_minmax(280px,320px)] items-start gap-4",
        )}
      >
        <div className="min-w-0">
          <div
            className={cn(
              "grid grid-cols-2 gap-2 sm:gap-3 md:[grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]",
            )}
          >
            {tables?.map((table, index) => {
              const config = STATUS_CONFIG[table.status];
              const isCreating = creating === table.id;
              const isFreeAndReadonly = table.status === "free" && !canOperateMesas;
              const visibleSplitTotals =
                table.splitTotals.length > 0 && table.splitTotals.length <= 2 ? table.splitTotals.slice(0, 2) : [];
              const showSingleTotal = table.totalDue > 0 && visibleSplitTotals.length === 0;

              return (
                <motion.button
                  key={table.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (index + 1) * 0.03 }}
                  onClick={() => handleTableClick(table)}
                  onPointerEnter={() => setSelectedTableId(table.id)}
                  onFocus={() => setSelectedTableId(table.id)}
                  disabled={isCreating}
                  className={cn(
                    "relative flex min-h-[130px] flex-col items-center justify-center gap-1.5 rounded-[20px] border-2 p-2.5 text-center shadow-[0_20px_45px_-30px_rgba(15,23,42,0.18)] transition-all active:scale-95 sm:min-h-[180px] sm:gap-3 sm:rounded-[28px] sm:p-5",
                    config.bg,
                    config.border,
                    table.totalDue > 0 && "pb-9 sm:pb-10",
                    visibleSplitTotals.length > 0 && "pb-11 sm:pb-10",
                    table.status === "free" && canOperateMesas && "hover:border-primary/30 hover:bg-primary/5",
                    isFreeAndReadonly && "cursor-default opacity-70",
                    showDetailPanel && selectedTableId === table.id && "ring-2 ring-primary/25 ring-offset-2 ring-offset-background",
                  )}
                >
                  {isCreating ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  ) : (
                    <>
                      <div className={cn("flex h-10 w-10 items-center justify-center rounded-[16px] border-2 sm:h-16 sm:w-16 sm:rounded-[22px]", config.artWrap)}>
                        {config.artIcon}
                      </div>
                      <span className={cn("font-display text-sm font-black leading-tight sm:text-lg", config.text)}>{table.name}</span>
                      <div className={cn("flex items-center gap-1 text-[10px] font-medium sm:text-xs", config.text)}>
                        {config.icon}
                        <span>{config.label}</span>
                      </div>
                      {table.status === "free" && canOperateMesas && (
                        <div className="absolute right-2 top-2 rounded-full bg-primary/10 p-1">
                          <Plus className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      {table.status === "free" && (
                        <div className="flex items-center gap-1 rounded-full border border-sky-200 bg-white/85 px-2 py-1 text-[8px] font-semibold text-sky-700 shadow-sm sm:text-[10px] dark:border-sky-800 dark:bg-card/85 dark:text-sky-400">
                          <Sparkles className="h-3 w-3" />
                          Lista para abrir
                        </div>
                      )}
                      {showSingleTotal && (
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-amber-300 bg-white/95 px-2.5 py-1 text-[10px] font-black text-amber-800 shadow-sm sm:bottom-3 sm:left-auto sm:right-3 sm:translate-x-0 sm:px-3.5 sm:py-2 sm:text-sm">
                          {formatCurrency(table.totalDue)}
                        </div>
                      )}
                      {visibleSplitTotals[0] && (
                        <div className="absolute bottom-2 left-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-amber-300 bg-white/95 px-2 py-1 text-[8px] font-black text-amber-800 shadow-sm sm:bottom-3 sm:left-3 sm:max-w-none sm:px-3 sm:py-2 sm:text-xs">
                          <span className="block truncate">{formatCurrency(visibleSplitTotals[0].totalDue)}</span>
                        </div>
                      )}
                      {visibleSplitTotals[1] && (
                        <div className="absolute bottom-2 right-1.5 max-w-[calc(50%-0.4rem)] rounded-full border border-amber-300 bg-white/95 px-2 py-1 text-[8px] font-black text-amber-800 shadow-sm sm:bottom-3 sm:right-3 sm:max-w-none sm:px-3 sm:py-2 sm:text-xs">
                          <span className="block truncate">{formatCurrency(visibleSplitTotals[1].totalDue)}</span>
                        </div>
                      )}
                      {table.splitCount > 0 && (
                        <span className="absolute left-2 top-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">
                          {table.splitCount} {table.splitCount === 1 ? "division" : "divisiones"}
                        </span>
                      )}
                    </>
                  )}
                </motion.button>
              );
            })}
          </div>

          {(tables?.length ?? 0) === 0 && (
            <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
              No hay mesas habilitadas para el turno actual. La cantidad disponible se define al abrir turno en Caja.
            </div>
          )}
        </div>

        {showDetailPanel && selectedTable && selectedConfig ? (
          <aside className="sticky top-[5.9rem] min-w-0 self-start">
            <div className="surface-glow p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Detalle</p>
                  <h2 className="mt-1 truncate font-display text-2xl font-black text-foreground">{selectedTable.name}</h2>
                  <div className={cn("mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold", selectedConfig.text, "bg-white/70 dark:bg-card/80")}>
                    {selectedConfig.icon}
                    <span>{selectedConfig.label}</span>
                  </div>
                </div>
                <div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-[22px] border-2", selectedConfig.artWrap)}>
                  {selectedConfig.artIcon}
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <div className="glass-panel px-4 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Saldo pendiente</div>
                  <div className="mt-1 font-display text-2xl font-black text-foreground">{formatCurrency(selectedTable.totalDue)}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-panel px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Divisiones</div>
                    <div className="mt-1 text-lg font-black text-foreground">{selectedTable.splitCount}</div>
                  </div>
                  <div className="glass-panel px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Estado</div>
                    <div className="mt-1 text-lg font-black text-foreground">{selectedConfig.label}</div>
                  </div>
                </div>
              </div>

              {selectedTable.splitTotals.length > 0 ? (
                <div className="mt-4 rounded-[24px] border border-orange-200/80 bg-white/80 p-4 shadow-sm dark:border-border dark:bg-card/85">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Montos visibles</div>
                  <div className="mt-3 grid gap-2">
                    {selectedTable.splitTotals.slice(0, 2).map((split) => (
                      <div key={split.splitId ?? "base"} className="flex items-center justify-between rounded-2xl border border-border/80 bg-background/80 px-3 py-2">
                        <span className="text-sm font-bold text-foreground">
                          {formatSplitCodeLabel(split.splitCode) || "Mesa base"}
                        </span>
                        <span className="text-sm font-black text-amber-800 dark:text-amber-400">{formatCurrency(split.totalDue)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-[24px] border border-dashed border-border bg-white/70 px-4 py-3 text-sm text-muted-foreground dark:bg-card/75">
                  {selectedTable.status === "free"
                    ? "Esta mesa esta libre y lista para abrirse."
                    : "No hay divisiones visibles para mostrar en este momento."}
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleTableClick(selectedTable)}
                disabled={creating === selectedTable.id || (selectedTable.status === "free" && !canOperateMesas)}
                className={cn(
                  "mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl border px-4 text-sm font-bold transition-all",
                  selectedTable.status === "free"
                    ? "border-primary/60 bg-gradient-to-r from-primary via-orange-500 to-amber-400 text-primary-foreground shadow-[0_18px_36px_-22px_rgba(249,115,22,0.92)]"
                    : "border-orange-200 bg-white/90 text-foreground shadow-sm hover:border-orange-300 hover:bg-orange-50 dark:border-border dark:bg-card/90",
                  (creating === selectedTable.id || (selectedTable.status === "free" && !canOperateMesas)) && "cursor-not-allowed opacity-60",
                )}
              >
                {creating === selectedTable.id ? <Loader2 className="h-4 w-4 animate-spin" /> : getPrimaryActionLabel(selectedTable)}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
};

export default Mesas;
