import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { X } from "lucide-react";

export interface KitchenNotification {
  id?: string;
  type: "ITEM_CANCELLED" | "ORDER_CANCELLED";
  order_number: number | null;
  message: string;
  item_id?: string;
  order_id: string;
  created_at: string;
}

type NotificationCallback = (notification: KitchenNotification) => void;

export function useKitchenNotifications(onNotification: NotificationCallback) {
  useEffect(() => {
    const kitchenChannel = supabase.channel(`kitchen-notifications:${crypto.randomUUID()}`);

    kitchenChannel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "kitchen_notifications",
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const notification: KitchenNotification = {
            id: typeof row.id === "string" ? row.id : undefined,
            type: row.type === "ORDER_CANCELLED" ? "ORDER_CANCELLED" : "ITEM_CANCELLED",
            order_number: Number(row.order_number ?? 0),
            message: String(row.message ?? ""),
            item_id: typeof row.item_id === "string" ? row.item_id : undefined,
            order_id: String(row.order_id ?? ""),
            created_at: String(row.created_at ?? new Date().toISOString()),
          };

          onNotification(notification);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(kitchenChannel);
    };
  }, [onNotification]);
}

interface KitchenNotificationBannerProps {
  notification: KitchenNotification | null;
  duration?: number;
}

export function KitchenNotificationBanner({
  notification,
  duration = 5000,
}: KitchenNotificationBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (notification) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), duration);
      return () => clearTimeout(timer);
    }
  }, [notification, duration]);

  if (!visible || !notification) return null;

  const isItemCancelled = notification.type === "ITEM_CANCELLED";

  return (
    <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-50 px-4 animate-in slide-in-from-bottom">
      <Alert
        variant="destructive"
        className={`${
          isItemCancelled ? "bg-red-600 border-red-700" : "bg-red-500 border-red-600"
        } text-white shadow-lg`}
      >
        <div className="flex items-start justify-between gap-4">
          <AlertDescription className="font-semibold text-base">{notification.message}</AlertDescription>
          <button onClick={() => setVisible(false)} className="mt-1 hover:opacity-80 transition-opacity">
            <X className="h-4 w-4" />
          </button>
        </div>
      </Alert>
    </div>
  );
}
