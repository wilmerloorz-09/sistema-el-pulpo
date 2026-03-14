import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, Plus, Users, CircleDollarSign, ShoppingBag, LayoutGrid, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { canOperate } from "@/lib/permissions";

const STATUS_CONFIG = {
  free: {
    bg: "bg-gradient-to-br from-sky-50 via-white to-cyan-100",
    border: "border-sky-300",
    text: "text-sky-700",
    label: "Libre",
    icon: null,
    artWrap: "border-sky-200 bg-gradient-to-br from-sky-400 via-cyan-400 to-teal-300 text-white shadow-[0_18px_38px_-24px_rgba(14,165,233,0.8)]",
    artIcon: <LayoutGrid className="h-8 w-8" />,
  },
  occupied: {
    bg: "bg-gradient-to-br from-orange-50 via-white to-amber-100",
    border: "border-primary/40",
    text: "text-primary",
    label: "Ocupada",
    icon: <Users className="h-4 w-4" />,
    artWrap: "border-orange-200 bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300 text-white shadow-[0_18px_38px_-24px_rgba(249,115,22,0.82)]",
    artIcon: <Users className="h-8 w-8" />,
  },
  to_pay: {
    bg: "bg-gradient-to-br from-amber-50 via-white to-lime-100",
    border: "border-warning/40",
    text: "text-amber-800",
    label: "Por pagar",
    icon: <CircleDollarSign className="h-4 w-4" />,
    artWrap: "border-lime-200 bg-gradient-to-br from-emerald-500 via-lime-400 to-yellow-300 text-white shadow-[0_18px_38px_-24px_rgba(132,204,22,0.82)]",
    artIcon: <CircleDollarSign className="h-8 w-8" />,
  },
};

const Mesas = () => {
  const { data: tables, isLoading } = useTablesWithStatus();
  const { user } = useAuth();
  const { activeBranchId, permissions } = useBranch();
  const navigate = useNavigate();
  const [creating, setCreating] = useState<string | null>(null);
  const [creatingTakeout, setCreatingTakeout] = useState(false);
  const canOperateMesas = canOperate(permissions, "mesas");

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const freeCount = tables?.filter((t) => t.status === "free").length ?? 0;
  const occupiedCount = tables?.filter((t) => t.status === "occupied").length ?? 0;
  const toPayCount = tables?.filter((t) => t.status === "to_pay").length ?? 0;

  return (
    <div className="space-y-5 p-3 sm:p-4">
      <div className="surface-glow px-5 py-4">
        <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-xl font-bold text-foreground">Mesas</h1>
          {!canOperateMesas && (
            <span className="rounded-full border border-border bg-white/85 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
              Solo consulta
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium">
          <span className="flex items-center gap-1 rounded-full border border-white/70 bg-white/85 px-3 py-1 text-muted-foreground shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
            {freeCount} libres
          </span>
          <span className="flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-primary shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            {occupiedCount} ocupadas
          </span>
          {toPayCount > 0 && (
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-warning shadow-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-warning" />
              {toPayCount} por pagar
            </span>
          )}
        </div>
      </div>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0 }}
          onClick={handleTakeout}
          disabled={creatingTakeout || !canOperateMesas}
          className={cn(
            "relative overflow-hidden flex flex-col items-center justify-center gap-2 rounded-[28px] border-2 p-5 shadow-[0_22px_45px_-30px_rgba(16,185,129,0.55)] transition-all active:scale-95",
            "bg-gradient-to-br from-emerald-50 via-white to-emerald-100 border-emerald-300",
            canOperateMesas ? "hover:border-accent/60 hover:bg-accent/15" : "cursor-not-allowed opacity-60",
          )}
        >
          {creatingTakeout ? (
            <Loader2 className="h-6 w-6 animate-spin text-accent" />
          ) : (
            <>
              <ShoppingBag className="h-6 w-6 text-accent" />
              <span className="font-display text-lg font-bold text-accent">Para llevar</span>
              {canOperateMesas && (
                <div className="absolute right-2 top-2 rounded-full bg-accent/10 p-1">
                  <Plus className="h-3.5 w-3.5 text-accent" />
                </div>
              )}
            </>
          )}
        </motion.button>

        {tables?.map((table, i) => {
          const config = STATUS_CONFIG[table.status];
          const isCreating = creating === table.id;
          const isFreeAndReadonly = table.status === "free" && !canOperateMesas;

          return (
            <motion.button
              key={table.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: (i + 1) * 0.03 }}
              onClick={() => handleTableClick(table)}
              disabled={isCreating}
              className={cn(
                "relative flex flex-col items-center justify-center gap-3 rounded-[28px] border-2 p-5 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.18)] transition-all active:scale-95",
                config.bg,
                config.border,
                table.status === "free" && canOperateMesas && "hover:border-primary/30 hover:bg-primary/5",
                isFreeAndReadonly && "cursor-default opacity-70",
              )}
            >
              {isCreating ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              ) : (
                <>
                  <div className={cn("flex h-16 w-16 items-center justify-center rounded-[22px] border-2", config.artWrap)}>
                    {config.artIcon}
                  </div>
                  <span className={cn("font-display text-lg font-black", config.text)}>{table.name}</span>
                  <div className={cn("flex items-center gap-1 text-xs font-medium", config.text)}>
                    {config.icon}
                    <span>{config.label}</span>
                  </div>
                  {table.status === "free" && canOperateMesas && (
                    <div className="absolute right-2 top-2 rounded-full bg-primary/10 p-1">
                      <Plus className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  {table.status === "free" && (
                    <div className="flex items-center gap-1 rounded-full border border-sky-200 bg-white/85 px-2 py-1 text-[10px] font-semibold text-sky-700 shadow-sm">
                      <Sparkles className="h-3 w-3" />
                      Lista para abrir
                    </div>
                  )}
                  {table.splitCount > 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">
                      {table.splitCount} splits
                    </span>
                  )}
                </>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default Mesas;
