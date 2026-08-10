import { useEffect, useRef, useState } from "react";
import { Bell, Smartphone, Volume2, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface OrderReadyNotification {
  id?: string;
  order_id: string;
  order_number: number | null;
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
  notification_id: string;
  order_id: string;
  order_number: number | null;
  order_type: "DINE_IN" | "TAKEOUT";
  branch_id: string;
  created_by: string;
  table_name: string | null;
  split_code: string | null;
  created_at: string;
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

async function fetchMeseroReadyAlerts(
  branchId: string,
  createdBy: string,
): Promise<OrderReadyNotification[]> {
  const { data, error } = await (supabase as any).rpc("get_mesero_ready_alerts", {
    p_branch_id: branchId,
    p_created_by: createdBy,
    p_limit: 20,
  });

  if (error || !Array.isArray(data)) return [];

  return (data as ReadyOrderRow[]).map((row) => ({
    id: row.notification_id,
    order_id: row.order_id,
    order_number: row.order_number,
    order_type: row.order_type,
    branch_id: row.branch_id,
    created_by: row.created_by,
    table_name: row.table_name ?? null,
    split_code: row.split_code ?? null,
    created_at: row.created_at,
  }));
}

async function shouldKeepOrderReadyAlarm(orderId: string, readyNotificationAt: string): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("order_has_dispatch_after", {
    p_order_id: orderId,
    p_after: readyNotificationAt,
  });

  if (error) return true;
  return !data;
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

  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (!enabled || !activeBranchId || !currentUserId) return;

    let cancelled = false;

    const initializeHandledNotifications = async () => {
      const data = await fetchMeseroReadyAlerts(activeBranchId, currentUserId);
      if (cancelled) return;
      if (!data.length) return;

      handledNotificationsRef.current = new Set(
        data.map((row) =>
          String(row.id ?? `${row.order_id}:${row.created_at}`),
        ),
      );
    };

    void initializeHandledNotifications();

    return () => {
      cancelled = true;
      handledNotificationsRef.current = new Set();
    };
  }, [activeBranchId, currentUserId, enabled]);

  useEffect(() => {
    if (!enabled || !activeBranchId || !currentUserId) return;

    let cancelled = false;
    let inFlight = false;

    const pollNotificationTable = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await fetchMeseroReadyAlerts(activeBranchId, currentUserId);
        if (cancelled || data.length === 0) return;

        for (const notification of [...data].reverse()) {
          const notificationId = String(notification.id ?? `${notification.order_id}:${notification.created_at}`);
          if (handledNotificationsRef.current.has(notificationId)) continue;
          handledNotificationsRef.current.add(notificationId);
          if (cancelled) continue;

          if (handledNotificationsRef.current.size > 100) {
            const firstKey = handledNotificationsRef.current.values().next().value;
            if (firstKey) handledNotificationsRef.current.delete(firstKey);
          }

          void playNotificationSound();
          vibrateDevice();
          onNotificationRef.current(notification);
        }
      } finally {
        inFlight = false;
      }
    };

    // Camino rapido: la base avisa al registrarse el evento de "orden lista",
    // en lugar de que cada tablet pregunte cada 2 segundos.
    let realtimeOk = false;
    let backupInterval: number | null = null;

    const startBackupPoll = () => {
      if (backupInterval != null) return;
      backupInterval = window.setInterval(() => {
        if (document.hidden) return;
        void pollNotificationTable();
      }, 60_000);
    };

    const stopBackupPoll = () => {
      if (backupInterval == null) return;
      window.clearInterval(backupInterval);
      backupInterval = null;
    };

    const channel = supabase
      .channel(`mesero-ready-alerts:${activeBranchId}:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "order_ready_events", filter: `branch_id=eq.${activeBranchId}` },
        () => {
          void pollNotificationTable();
        },
      )
      .subscribe((status) => {
        realtimeOk = status === "SUBSCRIBED";
        if (realtimeOk) stopBackupPoll();
        else startBackupPoll();
      });

    // Mientras conecta, arrancar respaldo; se detiene al SUBSCRIBED.
    startBackupPoll();

    const handleVisibilityChange = () => {
      if (!document.hidden) void pollNotificationTable();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      stopBackupPoll();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
      void realtimeOk;
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
    : notification.split_code?.trim() || notification.table_name?.trim() || "Orden Especial";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] z-50 px-3 sm:bottom-6 sm:right-4 sm:left-auto sm:max-w-md">
      <Alert className="pointer-events-auto border-green-700 bg-green-600 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 shrink-0 animate-bounce" />
            <div>
              <AlertDescription className="font-semibold text-base">
                Orden {notification.order_number ? `#${notification.order_number}` : ''} lista para despachar
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
  const { activeBranchId } = useBranch();
  const [notification, setNotification] = useState<OrderReadyNotification | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(readAudioPreference);
  const [armingAudio, setArmingAudio] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState<{ orderId: string; createdAt: string } | null>(null);

  const enabled = Boolean(activeBranchId && user?.id);

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
      const shouldKeep = await shouldKeepOrderReadyAlarm(activeAlarm.orderId, activeAlarm.createdAt);
      if (cancelled) return;

      if (!shouldKeep) {
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
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(9rem+env(safe-area-inset-bottom,0px))] z-50 px-3 sm:bottom-24 sm:right-4 sm:left-auto sm:max-w-md">
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
