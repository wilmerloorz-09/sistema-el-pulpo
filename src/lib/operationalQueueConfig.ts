/** Activa RPC `get_dispatch_operational_queue` (quantity_dispatchable en servidor). Rollback: false o quitar env. */
export function isServerOperationalQueueEnabled(): boolean {
  return String(import.meta.env.VITE_USE_SERVER_OPERATIONAL_QUEUE ?? "")
    .trim()
    .toLowerCase() === "true";
}

export type OperationalQueueModule = "dispatch" | "servir" | "packing";
