import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";

interface NetworkContextType {
  isOnline: boolean;
  /** Milliseconds since last confirmed online. Null if never confirmed. */
  lastOnlineAt: number | null;
}

const NetworkContext = createContext<NetworkContextType>({
  isOnline: navigator.onLine,
  lastOnlineAt: null,
});

const PING_INTERVAL_MS = 30_000; // Check every 30s

export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(
    navigator.onLine ? Date.now() : null
  );
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const updateOnline = useCallback((online: boolean) => {
    setIsOnline(online);
    if (online) setLastOnlineAt(Date.now());
  }, []);

  // Periodic real connectivity check (navigator.onLine can be unreliable)
  const checkConnectivity = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const url = import.meta.env.VITE_SUPABASE_URL;
      if (!url) {
        updateOnline(navigator.onLine);
        return;
      }
      const res = await fetch(`${url}/rest/v1/`, {
        method: "HEAD",
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);
      // Any HTTP response (even 401/403) means we have network connectivity
      updateOnline(true);
    } catch {
      // Network error (timeout, DNS failure, no connection)
      updateOnline(false);
    }
  }, [updateOnline]);

  useEffect(() => {
    const handleOnline = () => {
      updateOnline(true);
      checkConnectivity(); // Verify with real request
    };
    const handleOffline = () => updateOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    intervalRef.current = setInterval(checkConnectivity, PING_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [updateOnline, checkConnectivity]);

  return (
    <NetworkContext.Provider value={{ isOnline, lastOnlineAt }}>
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = () => useContext(NetworkContext);
