import { isBenignAuthLockAbort } from "@/lib/benignAsyncErrors";

window.addEventListener("unhandledrejection", (event) => {
  if (isBenignAuthLockAbort(event.reason)) {
    event.preventDefault();
    return;
  }
  if (import.meta.env.DEV) {
    console.error("[unhandledrejection]", event.reason);
  }
});

import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

declare const __APP_BUILD_VERSION__: string;

const isLocalAppHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const APP_VERSION_KEY = "elpulpo-app-version";
const APP_RELOAD_FLAG = "elpulpo-version-reload";
const RUNNING_VERSION = String(__APP_BUILD_VERSION__ ?? "").trim();
const VERSION_QUERY = "_epv";

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

async function clearAppCaches() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }

  if ("caches" in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
  }
}

function hardReloadForVersion(remoteVersion: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(VERSION_QUERY, remoteVersion.slice(0, 12));
  window.location.replace(url.toString());
}

function stripVersionQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(VERSION_QUERY)) return;
  url.searchParams.delete(VERSION_QUERY);
  window.history.replaceState({}, "", url.toString());
}

async function reloadForNewAppVersion() {
  if (!import.meta.env.PROD || isLocalAppHost) return;
  if (!RUNNING_VERSION || RUNNING_VERSION === "dev") return;

  const remoteVersion = await readRemoteAppVersion();
  if (!remoteVersion) return;

  // Persistir la versión del bundle que realmente está corriendo (no la remota).
  window.localStorage.setItem(APP_VERSION_KEY, RUNNING_VERSION);

  if (remoteVersion === RUNNING_VERSION) {
    window.sessionStorage.removeItem(APP_RELOAD_FLAG);
    stripVersionQuery();
    return;
  }

  if (window.sessionStorage.getItem(APP_RELOAD_FLAG) === remoteVersion) {
    return;
  }

  window.sessionStorage.setItem(APP_RELOAD_FLAG, remoteVersion);
  await clearAppCaches();
  hardReloadForVersion(remoteVersion);
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
  window.setInterval(check, 60 * 1000);
}

if ("serviceWorker" in navigator) {
  void (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        await clearAppCaches();
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
