import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { setAppOnline } from "@/lib/networkStatus";

interface NetworkContextType {
  isOnline: boolean;
  /** Milliseconds since last confirmed online. Null if never confirmed. */
  lastOnlineAt: number | null;
}

const NetworkContext = createContext<NetworkContextType>({
  isOnline: navigator.onLine,
  lastOnlineAt: null,
});

/** En móvil el evento `offline` suele fallar; un ping corto detecta la caída a tiempo. */
const PING_INTERVAL_ONLINE_MS = 20_000;
const PING_INTERVAL_OFFLINE_MS = 8_000;
const PING_TIMEOUT_MS = 4_000;

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(() => {
    const initial = navigator.onLine;
    setAppOnline(initial);
    return initial;
  });
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(
    navigator.onLine ? Date.now() : null
  );
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const checkingRef = useRef(false);
  const isOnlineRef = useRef(isOnline);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  const updateOnline = useCallback((online: boolean) => {
    setAppOnline(online);
    setIsOnline((prev) => {
      if (prev === online) return prev;
      return online;
    });
    if (online) setLastOnlineAt(Date.now());
  }, []);

  const checkConnectivity = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

      if (!url) {
        updateOnline(navigator.onLine);
        return;
      }

      // Incluir apikey para evitar que un fallo CORS se confunda con "sin red".
      await fetch(`${url}/rest/v1/`, {
        method: "HEAD",
        signal: controller.signal,
        cache: "no-store",
        headers: anonKey
          ? {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
            }
          : undefined,
      });

      // Cualquier respuesta HTTP implica conectividad (401/404 incluidos).
      updateOnline(true);
    } catch {
      // Timeout, DNS, red cortada, etc.
      // Si el navegador ya marcó offline, confiar; si no, el ping falló = sin red usable.
      updateOnline(false);
    } finally {
      clearTimeout(timeout);
      checkingRef.current = false;
    }
  }, [updateOnline]);

  const schedulePing = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const delay = isOnlineRef.current ? PING_INTERVAL_ONLINE_MS : PING_INTERVAL_OFFLINE_MS;
    intervalRef.current = setInterval(() => {
      void checkConnectivity();
    }, delay);
  }, [checkConnectivity]);

  useEffect(() => {
    const handleOffline = () => {
      updateOnline(false);
      schedulePing();
    };
    const handleOnline = () => {
      // No marcar online a ciegas: en móvil el evento a veces es engañoso.
      void checkConnectivity().then(() => schedulePing());
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void checkConnectivity();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);

    // Chequeo inmediato al montar (no esperar al primer intervalo).
    void checkConnectivity().then(() => schedulePing());

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [updateOnline, checkConnectivity, schedulePing]);

  // Reajustar intervalo cuando cambia el estado (más frecuente si está offline).
  useEffect(() => {
    schedulePing();
  }, [isOnline, schedulePing]);

  const value = useMemo(
    () => ({ isOnline, lastOnlineAt }),
    [isOnline, lastOnlineAt],
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => useContext(NetworkContext);
