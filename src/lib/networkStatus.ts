/** Estado de red compartido (sin React) para mutaciones, supabase y toasts. */

let appOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

export function setAppOnline(online: boolean) {
  appOnline = online;
}

export function isAppOnline() {
  return appOnline;
}
