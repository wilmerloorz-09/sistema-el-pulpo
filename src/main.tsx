import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
 
createRoot(document.getElementById("root")!).render(<App />);

const isLocalAppHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const LOCAL_SW_RESET_FLAG = "elpulpo-local-sw-reset";
const APP_VERSION_KEY = "elpulpo-app-version";
const APP_RELOAD_FLAG = "elpulpo-version-reload";

async function readRemoteAppVersion() {
  const response = await fetch(`/app-version.json?t=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });

  if (!response.ok) return null;

  const payload = await response.json();
  const version = String(payload?.version ?? "").trim();
  return version || null;
}

async function reloadForNewAppVersion() {
  if (!import.meta.env.PROD || isLocalAppHost) return;

  const remoteVersion = await readRemoteAppVersion();
  if (!remoteVersion) return;

  const currentVersion = window.localStorage.getItem(APP_VERSION_KEY);
  if (!currentVersion) {
    window.localStorage.setItem(APP_VERSION_KEY, remoteVersion);
    return;
  }

  if (currentVersion === remoteVersion) {
    window.sessionStorage.removeItem(APP_RELOAD_FLAG);
    return;
  }

  window.localStorage.setItem(APP_VERSION_KEY, remoteVersion);

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update()));
  }

  if (!window.sessionStorage.getItem(APP_RELOAD_FLAG)) {
    window.sessionStorage.setItem(APP_RELOAD_FLAG, "1");
    window.location.reload();
  }
}

function startAppVersionMonitor() {
  const check = () => {
    void reloadForNewAppVersion().catch((error) => {
      console.error("No se pudo verificar la version de la app", error);
    });
  };

  check();
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.setInterval(check, 5 * 60 * 1000);
}

if ("serviceWorker" in navigator && isLocalAppHost) {
  window.addEventListener("load", () => {
    void (async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length === 0) {
        window.sessionStorage.removeItem(LOCAL_SW_RESET_FLAG);
        return;
      }

      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ("caches" in window) {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
      }

      if (!window.sessionStorage.getItem(LOCAL_SW_RESET_FLAG)) {
        window.sessionStorage.setItem(LOCAL_SW_RESET_FLAG, "1");
        window.location.reload();
        return;
      }

      window.sessionStorage.removeItem(LOCAL_SW_RESET_FLAG);
    })().catch((error) => {
      console.error("No se pudo limpiar el service worker local", error);
    });
  });
} else if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void (async () => {
      let reloading = false;
      const reloadForUpdate = () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);

      const registration = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });

      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            reloadForUpdate();
          }
        });
      });

      await registration.update();
    })().catch((error) => {
      console.error("No se pudo registrar el service worker", error);
    });
  });
}

if (import.meta.env.PROD && !isLocalAppHost) {
  window.addEventListener("load", startAppVersionMonitor);
}
