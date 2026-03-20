import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { Bell, Smartphone, Volume2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBranch } from "@/contexts/BranchContext";
import { supabase } from "@/integrations/supabase/client";
import { canManage } from "@/lib/permissions";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

export interface OrderReadyNotification {
  id?: string;
  order_id: string;
  order_number: number;
  order_type: "DINE_IN" | "TAKEOUT";
  branch_id: string;
  table_name?: string | null;
  split_code?: string | null;
  created_at: string;
}

type NotificationCallback = (notification: OrderReadyNotification) => void;

interface NotificationHookOptions {
  activeBranchId?: string | null;
  enabled?: boolean;
}

type ReadyOrderRow = {
  id: string;
  branch_id: string;
  order_number: number;
  order_type: "DINE_IN" | "TAKEOUT";
  split_id: string | null;
  table_id: string | null;
  ready_at: string | null;
};

let notificationAudioContext: AudioContext | null = null;
let audioUnlockBound = false;
const AUDIO_PREF_KEY = "order-ready-audio-enabled";

function readAudioPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUDIO_PREF_KEY) === "true";
}

function writeAudioPreference(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUDIO_PREF_KEY, enabled ? "true" : "false");
}

function getAudioContextClass():
  | (new () => AudioContext)
  | undefined {
  if (typeof window === "undefined") return undefined;
  return (window.AudioContext || (window as typeof window & { webkitAudioContext?: new () => AudioContext }).webkitAudioContext);
}

async function ensureNotificationAudioContext(): Promise<AudioContext | null> {
  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) return null;

  if (!notificationAudioContext) {
    notificationAudioContext = new AudioContextClass();
  }

  if (notificationAudioContext.state === "suspended") {
    try {
      await notificationAudioContext.resume();
    } catch {
      return notificationAudioContext;
    }
  }

  return notificationAudioContext;
}

async function playBeepAt(context: AudioContext, startAt: number, durationMs: number, frequency: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const durationSeconds = durationMs / 1000;
  const releaseAt = startAt + durationSeconds;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, releaseAt);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(releaseAt);
}

function bindAudioUnlockListeners() {
  if (typeof window === "undefined" || audioUnlockBound) return;
  audioUnlockBound = true;

  const unlock = () => {
    void ensureNotificationAudioContext();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("keydown", unlock);
    audioUnlockBound = false;
  };

  window.addEventListener("pointerdown", unlock, { passive: true, once: true });
  window.addEventListener("touchstart", unlock, { passive: true, once: true });
  window.addEventListener("keydown", unlock, { passive: true, once: true });
}

export async function playNotificationSound(): Promise<void> {
  bindAudioUnlockListeners();

  const context = await ensureNotificationAudioContext();
  if (!context) return;

  const startAt = context.currentTime + 0.02;
  await playBeepAt(context, startAt, 130, 880);
  await playBeepAt(context, startAt + 0.2, 130, 988);
}

export async function activateNotificationAudio(): Promise<boolean> {
  const context = await ensureNotificationAudioContext();
  if (!context) return false;

  const startAt = context.currentTime + 0.02;
  await playBeepAt(context, startAt, 120, 740);
  await playBeepAt(context, startAt + 0.18, 120, 880);
  writeAudioPreference(true);
  return true;
}

export function vibrateDevice(): void {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;

  try {
    navigator.vibrate([220, 120, 220, 120, 320]);
  } catch {
    // Ignore unsupported vibration failures.
  }
}

async function fetchOrderReadyNotification(
  orderId: string,
  createdAt: string,
): Promise<OrderReadyNotification | null> {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("branch_id, order_number, order_type, table_id, split_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return null;
  }

  const typedOrder = order as ReadyOrderRow;

  const [tableResult, splitResult] = await Promise.all([
    typedOrder.table_id
      ? supabase
          .from("restaurant_tables")
          .select("name")
          .eq("id", typedOrder.table_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    typedOrder.split_id
      ? supabase
          .from("table_splits")
          .select("split_code")
          .eq("id", typedOrder.split_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    order_id: orderId,
    order_number: typedOrder.order_number,
    order_type: typedOrder.order_type,
    branch_id: typedOrder.branch_id,
    table_name: tableResult.data?.name ?? null,
    split_code: splitResult.data?.split_code ?? null,
    created_at: createdAt,
  };
}

async function fetchOrderReadyNotificationFromRow(
  order: ReadyOrderRow,
): Promise<OrderReadyNotification | null> {
  const [tableResult, splitResult] = await Promise.all([
    order.table_id
      ? supabase
          .from("restaurant_tables")
          .select("name")
          .eq("id", order.table_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    order.split_id
      ? supabase
          .from("table_splits")
          .select("split_code")
          .eq("id", order.split_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    order_id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    branch_id: order.branch_id,
    table_name: tableResult.data?.name ?? null,
    split_code: splitResult.data?.split_code ?? null,
    created_at: order.ready_at ?? new Date().toISOString(),
  };
}

export function useMeseroOrderReadyNotification(
  onNotification: NotificationCallback,
  options?: NotificationHookOptions,
) {
  const activeBranchId = options?.activeBranchId ?? null;
  const enabled = options?.enabled ?? true;
  const handledNotificationsRef = useRef<Set<string>>(new Set());
  const onNotificationRef = useRef(onNotification);
  const lastPolledReadyAtRef = useRef<string | null>(null);

  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  const channelFactory = useCallback((): RealtimeChannel => {
    return supabase.channel(`order-ready-notifications:${activeBranchId ?? "all"}`);
  }, [activeBranchId]);

  useEffect(() => {
    if (!enabled) return;

    bindAudioUnlockListeners();
    const orderReadyChannel = channelFactory();

    orderReadyChannel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_ready_notifications",
        },
        async (payload: {
          new: {
            id?: string;
            order_id?: string;
            created_at?: string;
          };
        }) => {
          const notificationId = String(payload.new.id ?? `${payload.new.order_id ?? "unknown"}:${payload.new.created_at ?? ""}`);
          if (handledNotificationsRef.current.has(notificationId)) return;

          const orderId = String(payload.new.order_id ?? "").trim();
          if (!orderId) return;

          const notification = await fetchOrderReadyNotification(orderId, payload.new.created_at ?? new Date().toISOString());
          if (!notification) return;
          if (activeBranchId && notification.branch_id !== activeBranchId) return;

          handledNotificationsRef.current.add(notificationId);
          if (handledNotificationsRef.current.size > 100) {
            const firstKey = handledNotificationsRef.current.values().next().value;
            if (firstKey) handledNotificationsRef.current.delete(firstKey);
          }

          void playNotificationSound();
          vibrateDevice();
          onNotificationRef.current(notification);
        },
      )
      .subscribe();

    return () => {
      void orderReadyChannel.unsubscribe();
    };
  }, [activeBranchId, channelFactory, enabled]);

  useEffect(() => {
    if (!enabled || !activeBranchId) return;

    let cancelled = false;

    const initializeCursor = async () => {
      const { data } = await supabase
        .from("orders")
        .select("ready_at")
        .eq("branch_id", activeBranchId)
        .eq("status", "READY")
        .not("ready_at", "is", null)
        .order("ready_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        lastPolledReadyAtRef.current = data?.ready_at ?? new Date().toISOString();
      }
    };

    void initializeCursor();

    return () => {
      cancelled = true;
      lastPolledReadyAtRef.current = null;
    };
  }, [activeBranchId, enabled]);

  useEffect(() => {
    if (!enabled || !activeBranchId) return;

    let cancelled = false;

    const pollReadyOrders = async () => {
      const cursor = lastPolledReadyAtRef.current;
      if (!cursor) return;

      const { data, error } = await supabase
        .from("orders")
        .select("id, branch_id, order_number, order_type, table_id, split_id, ready_at")
        .eq("branch_id", activeBranchId)
        .eq("status", "READY")
        .gt("ready_at", cursor)
        .order("ready_at", { ascending: true })
        .limit(20);

      if (cancelled || error || !data || data.length === 0) return;

      for (const rawOrder of data as ReadyOrderRow[]) {
        const notificationId = `${rawOrder.id}:${rawOrder.ready_at ?? ""}`;
        if (handledNotificationsRef.current.has(notificationId)) continue;

        const notification = await fetchOrderReadyNotificationFromRow(rawOrder);
        if (!notification || cancelled) continue;

        handledNotificationsRef.current.add(notificationId);
        if (handledNotificationsRef.current.size > 100) {
          const firstKey = handledNotificationsRef.current.values().next().value;
          if (firstKey) handledNotificationsRef.current.delete(firstKey);
        }

        void playNotificationSound();
        vibrateDevice();
        onNotificationRef.current(notification);
      }

      const newestReadyAt = data[data.length - 1]?.ready_at;
      if (newestReadyAt) {
        lastPolledReadyAtRef.current = newestReadyAt;
      }
    };

    const interval = window.setInterval(() => {
      void pollReadyOrders();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeBranchId, enabled]);
}

interface OrderReadyNotificationBannerProps {
  notification: OrderReadyNotification | null;
  duration?: number;
}

export function OrderReadyNotificationBanner({
  notification,
  duration = 0,
}: OrderReadyNotificationBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!notification) return;
    setVisible(true);

    if (!duration || duration <= 0) return;
    const timeout = window.setTimeout(() => setVisible(false), duration);
    return () => window.clearTimeout(timeout);
  }, [duration, notification]);

  if (!visible || !notification) return null;

  const label = notification.order_type === "TAKEOUT"
    ? "Para llevar"
    : notification.split_code?.trim() || notification.table_name?.trim() || "Mesa";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 px-3 sm:bottom-6 sm:right-4 sm:left-auto sm:max-w-md">
      <Alert className="pointer-events-auto border-green-700 bg-green-600 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 shrink-0 animate-bounce" />
            <div>
              <AlertDescription className="font-semibold text-base">
                Orden #{notification.order_number} lista para despachar
              </AlertDescription>
              <AlertDescription className="mt-1 text-sm opacity-90">
                {label}
              </AlertDescription>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="mt-1 shrink-0 transition-opacity hover:opacity-80"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </Alert>
    </div>
  );
}

export function OrderReadyAlertCenter() {
  const { activeBranchId, permissions, isGlobalAdmin } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const [notification, setNotification] = useState<OrderReadyNotification | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(readAudioPreference);
  const [armingAudio, setArmingAudio] = useState(false);

  const enabled = Boolean(activeBranchId) && (
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global")
    || Boolean(shiftGateQuery.data?.isSupervisor)
    || Boolean(shiftGateQuery.data?.canServeTables)
    || Boolean(shiftGateQuery.data?.canDispatchOrders)
  );

  useMeseroOrderReadyNotification((nextNotification) => {
    setNotification(nextNotification);
  }, {
    activeBranchId,
    enabled,
  });

  return (
    <>
      {enabled && !audioEnabled && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-50 px-3 sm:bottom-24 sm:right-4 sm:left-auto sm:max-w-md">
          <Alert className="pointer-events-auto border-orange-300 bg-white text-foreground shadow-lg">
            <div className="flex items-start gap-3">
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <AlertDescription className="font-semibold text-sm">
                  Activa el sonido de alertas en este movil
                </AlertDescription>
                <AlertDescription className="mt-1 text-xs text-muted-foreground">
                  Toca el boton una vez para habilitar y probar el audio de orden lista.
                </AlertDescription>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={async () => {
                      setArmingAudio(true);
                      const activated = await activateNotificationAudio().catch(() => false);
                      if (activated) {
                        vibrateDevice();
                        setAudioEnabled(true);
                      }
                      setArmingAudio(false);
                    }}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-2xl border border-primary/70 bg-gradient-to-r from-primary via-orange-500 to-amber-400 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_18px_36px_-22px_hsl(var(--primary)/0.95)]"
                    disabled={armingAudio}
                  >
                    <Volume2 className="h-4 w-4" />
                    {armingAudio ? "Activando..." : "Activar sonido"}
                  </button>
                </div>
              </div>
            </div>
          </Alert>
        </div>
      )}
      <OrderReadyNotificationBanner notification={notification} duration={0} />
    </>
  );
}
