import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface SplitTableDialogProps {
  open: boolean;
  onClose: () => void;
  tableId: string;
  tableName: string;
  orderId: string;
}

interface SplitOrder {
  id: string;
  split_code: string;
  order_id?: string;
  order_number?: number;
  item_count: number;
}

export default function SplitTableDialog({ open, onClose, tableId, tableName, orderId }: SplitTableDialogProps) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [splits, setSplits] = useState<SplitOrder[]>([]);
  const [fetched, setFetched] = useState(false);

  const fetchSplits = async () => {
    setLoading(true);
    try {
      // Get active splits for this table
      const { data: tableSplits, error } = await supabase
        .from("table_splits")
        .select("id, split_code")
        .eq("table_id", tableId)
        .eq("is_active", true)
        .order("created_at");

      if (error) throw error;

      // Get orders linked to these splits
      const splitIds = tableSplits.map(s => s.id);
      let splitOrders: any[] = [];
      if (splitIds.length > 0) {
        const { data } = await supabase
          .from("orders")
          .select("id, order_number, split_id, order_items(id)")
          .in("split_id", splitIds)
          .in("status", ["DRAFT", "SENT_TO_KITCHEN", "KITCHEN_DISPATCHED"]);
        splitOrders = data ?? [];
      }

      const mapped: SplitOrder[] = tableSplits.map(s => {
        const order = splitOrders.find(o => o.split_id === s.id);
        return {
          id: s.id,
          split_code: s.split_code,
          order_id: order?.id,
          order_number: order?.order_number,
          item_count: order?.order_items?.length ?? 0,
        };
      });

      setSplits(mapped);
      setFetched(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      fetchSplits();
    } else {
      setFetched(false);
      setSplits([]);
      onClose();
    }
  };

  const addSplit = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const code = `Cuenta ${splits.length + 1}`;
      const { data: split, error } = await supabase
        .from("table_splits")
        .insert({ table_id: tableId, split_code: code })
        .select("id")
        .single();
      if (error) throw error;

      // Create a new order for this split
      const { data: newOrder, error: orderErr } = await supabase
        .from("orders")
        .insert({
          table_id: tableId,
          split_id: split.id,
          order_type: "DINE_IN" as const,
          created_by: user.id,
          status: "DRAFT" as const,
        })
        .select("id, order_number")
        .single();
      if (orderErr) throw orderErr;

      toast.success(`${code} creada`);
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      await fetchSplits();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeSplit = async (splitId: string) => {
    setLoading(true);
    try {
      // Delete orders linked to this split first
      await supabase.from("orders").delete().eq("split_id", splitId);
      await supabase.from("table_splits").delete().eq("id", splitId);
      toast.success("Cuenta eliminada");
      qc.invalidateQueries({ queryKey: ["tables-with-status"] });
      await fetchSplits();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const navigateToSplit = (splitOrderId: string) => {
    onClose();
    window.location.href = `/ordenes?order=${splitOrderId}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Dividir {tableName}</DialogTitle>
        </DialogHeader>

        {loading && !fetched ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {splits.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay cuentas divididas. Agrega una para comenzar.
              </p>
            )}

            {splits.map((split) => (
              <div
                key={split.id}
                className="flex items-center justify-between rounded-xl border border-border p-3 bg-card"
              >
                <button
                  onClick={() => split.order_id && navigateToSplit(split.order_id)}
                  className="flex-1 text-left"
                  disabled={!split.order_id}
                >
                  <span className="font-display text-sm font-bold">{split.split_code}</span>
                  {split.order_number && (
                    <span className="text-xs text-muted-foreground ml-2">#{split.order_number}</span>
                  )}
                  <p className="text-xs text-muted-foreground">{split.item_count} productos</p>
                </button>
                {split.item_count === 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeSplit(split.id)}
                    disabled={loading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            <Button
              variant="outline"
              className="w-full rounded-xl gap-2"
              onClick={addSplit}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Agregar cuenta
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
