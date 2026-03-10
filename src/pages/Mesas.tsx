import { useTablesWithStatus } from "@/hooks/useTablesWithStatus";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Loader2, Plus, Users, CircleDollarSign, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { canOperate } from "@/lib/permissions";

const STATUS_CONFIG = {
  free: {
    bg: "bg-card",
    border: "border-border",
    text: "text-muted-foreground",
    label: "Libre",
    icon: null,
  },
  occupied: {
    bg: "bg-primary/10",
    border: "border-primary/40",
    text: "text-primary",
    label: "Ocupada",
    icon: <Users className="h-4 w-4" />,
  },
  to_pay: {
    bg: "bg-warning/15",
    border: "border-warning/40",
    text: "text-foreground",
    label: "Por pagar",
    icon: <CircleDollarSign className="h-4 w-4" />,
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
    if (!user || !canOperateMesas) return;
    setCreatingTakeout(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          order_type: "TAKEOUT" as const,
          created_by: user.id,
          status: "DRAFT" as const,
          branch_id: activeBranchId!,
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Orden para llevar creada");
      navigate(`/ordenes?order=${data.id}`);
    } catch (err: any) {
      toast.error(err.message || "Error al crear orden");
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
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-bold text-foreground">Mesas</h1>
          {!canOperateMesas && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              Solo consulta
            </span>
          )}
        </div>
        <div className="flex gap-3 text-xs font-medium">
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
            {freeCount} libres
          </span>
          <span className="flex items-center gap-1 text-primary">
            <span className="h-2.5 w-2.5 rounded-full bg-primary" />
            {occupiedCount} ocupadas
          </span>
          {toPayCount > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <span className="h-2.5 w-2.5 rounded-full bg-warning" />
              {toPayCount} por pagar
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <motion.button
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0 }}
          onClick={handleTakeout}
          disabled={creatingTakeout || !canOperateMesas}
          className={cn(
            "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-5 transition-all active:scale-95",
            "bg-accent/10 border-accent/40",
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
                "relative flex flex-col items-center justify-center gap-2 rounded-2xl border-2 p-5 transition-all active:scale-95",
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
                  <span className={cn("font-display text-lg font-bold", config.text)}>{table.name}</span>
                  <div className={cn("flex items-center gap-1 text-xs font-medium", config.text)}>
                    {config.icon}
                    <span>{config.label}</span>
                  </div>
                  {table.status === "free" && canOperateMesas && (
                    <div className="absolute right-2 top-2 rounded-full bg-primary/10 p-1">
                      <Plus className="h-3.5 w-3.5 text-primary" />
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
