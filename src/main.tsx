import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
 
createRoot(document.getElementById("root")!).render(<App />);

const isLocalAppHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const LOCAL_SW_RESET_FLAG = "elpulpo-local-sw-reset";

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
