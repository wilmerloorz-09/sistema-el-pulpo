import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeChannel } from "@supabase/supabase-js";
import { Bell, Smartphone, Volume2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { canManage } from "@/lib/permissions";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";

export interface OrderReadyNotification {
  id?: string;
  order_id: string;
  order_number: number;
  order_type: "DINE_IN" | "TAKEOUT";
  branch_id: string;
  created_by: string;
  table_name?: string | null;
  split_code?: string | null;
  created_at: string;
}

type NotificationCallback = (notification: OrderReadyNotification) => void;

interface NotificationHookOptions {
  activeBranchId?: string | null;
  currentUserId?: string | null;
  enabled?: boolean;
}

type ReadyOrderRow = {
  id: string;
  branch_id: string;
  order_number: number;
  order_type: "DINE_IN" | "TAKEOUT";
  created_by: string;
  split_id: string | null;
  table_id: string | null;
  ready_at: string | null;
  status?: string | null;
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

async function playBeepAt(
  context: AudioContext,
  startAt: number,
  durationMs: number,
  frequency: number,
  peakGain = 0.52,
  waveType: OscillatorType = "square",
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const durationSeconds = durationMs / 1000;
  const releaseAt = startAt + durationSeconds;

  oscillator.type = waveType;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.01);
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
  await playBeepAt(context, startAt, 220, 1040, 0.58, "square");
  await playBeepAt(context, startAt + 0.28, 220, 1320, 0.62, "square");
  await playBeepAt(context, startAt + 0.56, 280, 1480, 0.68, "sawtooth");
}

export async function activateNotificationAudio(): Promise<boolean> {
  const context = await ensureNotificationAudioContext();
  if (!context) return false;

  const startAt = context.currentTime + 0.02;
  await playBeepAt(context, startAt, 180, 820, 0.46, "square");
  await playBeepAt(context, startAt + 0.24, 180, 1100, 0.52, "square");
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
    .select("branch_id, order_number, order_type, created_by, table_id, split_id")
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
    created_by: typedOrder.created_by,
    table_name: tableResult.data?.name ?? null,
    split_code: splitResult.data?.split_code ?? null,
    created_at: createdAt,
  };
}

async function shouldKeepOrderReadyAlarm(orderId: string, readyNotificationAt: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (error || !data) return false;
  if (data.status !== "READY") return false;

  const { data: dispatchEvents, error: dispatchEventsError } = await supabase
    .from("order_dispatch_events")
    .select("id")
    .eq("order_id", orderId)
    .gt("created_at", readyNotificationAt)
    .limit(1);

  if (dispatchEventsError) return true;
  return (dispatchEvents ?? []).length === 0;
}

export function useMeseroOrderReadyNotification(
  onNotification: NotificationCallback,
  options?: NotificationHookOptions,
) {
  const activeBranchId = options?.activeBranchId ?? null;
  const currentUserId = options?.currentUserId ?? null;
  const enabled = options?.enabled ?? true;
  const handledNotificationsRef = useRef<Set<string>>(new Set());
  const onNotificationRef = useRef(onNotification);
  const lastPolledNotificationAtRef = useRef<string | null>(null);

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
          if (currentUserId && notification.created_by !== currentUserId) return;

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
  }, [activeBranchId, channelFactory, currentUserId, enabled]);

  useEffect(() => {
    if (!enabled || !activeBranchId) return;

    lastPolledNotificationAtRef.current = new Date().toISOString();

    return () => {
      lastPolledNotificationAtRef.current = null;
    };
  }, [activeBranchId, enabled]);

  useEffect(() => {
    if (!enabled || !activeBranchId) return;

    let cancelled = false;

    const pollNotificationTable = async () => {
      const cursor = lastPolledNotificationAtRef.current;
      if (!cursor) return;

      const { data, error } = await (supabase as any)
        .from("order_ready_notifications")
        .select("id, order_id, created_at")
        .gt("created_at", cursor)
        .order("created_at", { ascending: true })
        .limit(20);

      if (cancelled || error || !data || data.length === 0) return;

      for (const rawNotification of data as Array<{ id?: string; order_id?: string; created_at?: string }>) {
        const notificationId = String(rawNotification.id ?? `${rawNotification.order_id ?? "unknown"}:${rawNotification.created_at ?? ""}`);
        if (handledNotificationsRef.current.has(notificationId)) continue;

        const orderId = String(rawNotification.order_id ?? "").trim();
        if (!orderId) continue;

        const notification = await fetchOrderReadyNotification(orderId, rawNotification.created_at ?? new Date().toISOString());
        if (!notification || cancelled) continue;
        if (notification.branch_id !== activeBranchId) continue;
        if (currentUserId && notification.created_by !== currentUserId) continue;

        handledNotificationsRef.current.add(notificationId);
        if (handledNotificationsRef.current.size > 100) {
          const firstKey = handledNotificationsRef.current.values().next().value;
          if (firstKey) handledNotificationsRef.current.delete(firstKey);
        }

        void playNotificationSound();
        vibrateDevice();
        onNotificationRef.current(notification);
      }

      const newestCreatedAt = data[data.length - 1]?.created_at;
      if (newestCreatedAt) {
        lastPolledNotificationAtRef.current = newestCreatedAt;
      }
    };

    const interval = window.setInterval(() => {
      void pollNotificationTable();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeBranchId, currentUserId, enabled]);
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
    <div className="pointer-events-none fixed inset-x-0 bottom-[5.75rem] z-50 px-3 sm:bottom-6 sm:right-4 sm:left-auto sm:max-w-md">
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
  const { user } = useAuth();
  const { activeBranchId, permissions, isGlobalAdmin } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const [notification, setNotification] = useState<OrderReadyNotification | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(readAudioPreference);
  const [armingAudio, setArmingAudio] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<{ orderId: string; createdAt: string } | null>(null);

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
    setActiveAlarm({
      orderId: nextNotification.order_id,
      createdAt: nextNotification.created_at,
    });
  }, {
    activeBranchId,
    currentUserId: user?.id ?? null,
    enabled,
  });

  useEffect(() => {
    if (!enabled || !audioEnabled || !activeAlarm) return;

    let cancelled = false;

    const tickAlarm = async () => {
      const stillReady = await shouldKeepOrderReadyAlarm(activeAlarm.orderId, activeAlarm.createdAt);
      if (cancelled) return;

      if (!stillReady) {
        setActiveAlarm((current) => (current?.orderId === activeAlarm.orderId ? null : current));
        setNotification((current) => (current?.order_id === activeAlarm.orderId ? null : current));
        return;
      }

      void playNotificationSound();
      vibrateDevice();
    };

    void tickAlarm();
    const interval = window.setInterval(() => {
      void tickAlarm();
    }, 3500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeAlarm, audioEnabled, enabled]);

  return (
    <>
      {enabled && !audioEnabled && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[9rem] z-50 px-3 sm:bottom-24 sm:right-4 sm:left-auto sm:max-w-md">
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
