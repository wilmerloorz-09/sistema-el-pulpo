import { useEffect, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { X, Bell } from 'lucide-react';

export interface OrderReadyNotification {
  id?: string;
  order_id: string;
  order_number: number;
  order_type: 'DINE_IN' | 'TAKEOUT';
  table_name?: string | null;
  created_at: string;
}

type NotificationCallback = (notification: OrderReadyNotification) => void;

/**
 * Play a notification sound - try Web Audio API first, then fallback to audio file
 */
export function playNotificationSound(): Promise<void> {
  return new Promise((resolve) => {
    // Try Web Audio API
    try {
      if (typeof window !== 'undefined' && window.AudioContext) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const now = audioContext.currentTime;
        
        // Create a simple beep pattern (2 short beeps)
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        osc.frequency.value = 800; // Hz
        osc.type = 'sine';
        
        // First beep
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
        
        // Second beep
        osc.start(now + 0.15);
        osc.stop(now + 0.25);
        
        setTimeout(() => resolve(), 300);
        return;
      }
    } catch (e) {
      console.warn('Web Audio API not available:', e);
    }
    
    // Fallback: try to play audio file
    const audio = new Audio('/notification.mp3');
    audio.volume = 0.7;
    
    audio.play()
      .then(() => setTimeout(() => resolve(), 500))
      .catch(() => {
        // If all fails, just resolve immediately
        console.warn('Could not play notification sound');
        resolve();
      });
  });
}

/**
 * Vibrate device if possible
 */
export function vibrateDevice(): void {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    // 3 short vibrations: 500ms, pause 200ms, repeat
    try {
      navigator.vibrate([500, 200, 500, 200, 500]);
    } catch (e) {
      // Silently ignore if vibration API fails
      console.debug('Vibration not available');
    }
  }
}

/**
 * Hook to listen for "order ready" notifications in real-time
 */
export function useMeseroOrderReadyNotification(onNotification: NotificationCallback) {
  const channel = useCallback(() => {
    return supabase.channel('order-ready-notifications');
  }, []);

  useEffect(() => {
    const orderReadyChannel = channel();

    orderReadyChannel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'order_ready_notifications',
        },
        (payload: any) => {
          const notification: OrderReadyNotification = {
            id: payload.new.id,
            order_id: payload.new.order_id,
            order_number: payload.new.order_number,
            order_type: payload.new.order_type,
            table_name: payload.new.table_name,
            created_at: payload.new.created_at,
          };

          // Trigger sound and vibration
          playNotificationSound().catch(console.error);
          vibrateDevice();

          onNotification(notification);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[OrderReadyNotifications] Conectado a notificaciones de orden lista');
        } else if (status === 'CLOSED') {
          console.log('[OrderReadyNotifications] Desconectado');
        }
      });

    return () => {
      orderReadyChannel.unsubscribe();
    };
  }, [channel, onNotification]);
}

/**
 * Component to display "order ready" notifications
 */
interface OrderReadyNotificationBannerProps {
  notification: OrderReadyNotification | null;
  duration?: number; // ms - 0 for manual dismiss only
}

export function OrderReadyNotificationBanner({
  notification,
  duration = 0, // Default to manual dismiss
}: OrderReadyNotificationBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (notification) {
      setVisible(true);
    }
  }, [notification]);

  if (!visible || !notification) return null;

  const label = notification.table_name 
    ? `Mesa ${notification.table_name}`
    : 'Para llevar';

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 px-4 animate-in slide-in-from-bottom">
      <Alert className="bg-green-600 border-green-700 text-white shadow-lg" >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 mt-0.5 animate-bounce flex-shrink-0" />
            <div>
              <AlertDescription className="font-semibold text-base">
                🔔 Orden #{notification.order_number} lista para despachar
              </AlertDescription>
              <AlertDescription className="text-sm opacity-90 mt-1">
                {label}
              </AlertDescription>
            </div>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="mt-1 hover:opacity-80 transition-opacity flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </Alert>
    </div>
  );
}
