/** Activa modo cola servidor (usa bundle probado; RPC SQL queda para fase posterior). */
export function isServerOperationalQueueEnabled(): boolean {
  return String(import.meta.env.VITE_USE_SERVER_OPERATIONAL_QUEUE ?? "")
    .trim()
    .toLowerCase() === "true";
}

export type OperationalQueueModule = "dispatch" | "servir" | "packing";
