window.addEventListener("error", (event) => {
  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.top = "10px";
  div.style.left = "10px";
  div.style.right = "10px";
  div.style.backgroundColor = "red";
  div.style.color = "white";
  div.style.padding = "15px";
  div.style.zIndex = "99999";
  div.style.borderRadius = "8px";
  div.style.fontFamily = "monospace";
  div.style.fontSize = "12px";
  div.style.whiteSpace = "pre-wrap";
  div.innerText = `ERROR GLOBAL: ${event.message}\nEn: ${event.filename}:${event.lineno}:${event.colno}\nStack: ${event.error?.stack || "No stack"}`;
  document.body.appendChild(div);
});

window.addEventListener("unhandledrejection", (event) => {
  const div = document.createElement("div");
  div.style.position = "fixed";
  div.style.top = "10px";
  div.style.left = "10px";
  div.style.right = "10px";
  div.style.backgroundColor = "darkorange";
  div.style.color = "white";
  div.style.padding = "15px";
  div.style.zIndex = "99999";
  div.style.borderRadius = "8px";
  div.style.fontFamily = "monospace";
  div.style.fontSize = "12px";
  div.style.whiteSpace = "pre-wrap";
  div.innerText = `PROCESO EN RECHAZO (REJECTION): ${event.reason?.message || event.reason}\nStack: ${event.reason?.stack || "No stack"}`;
  document.body.appendChild(div);
});

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

if ("serviceWorker" in navigator) {
  void (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        await Promise.all(registrations.map((registration) => registration.unregister()));
        
        if ("caches" in window) {
          const cacheKeys = await caches.keys();
          await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
        }
        
        console.log("Service worker and caches cleared successfully.");
        window.location.reload();
      }
    } catch (error) {
      console.error("No se pudo limpiar el service worker", error);
    }
  })();
}

if (import.meta.env.PROD && !isLocalAppHost) {
  window.addEventListener("load", startAppVersionMonitor);
}
