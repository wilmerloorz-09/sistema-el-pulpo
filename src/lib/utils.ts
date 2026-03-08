import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatea segundos transcurridos como HH:MM:SS o MM:SS si hours = 0 */
export function formatElapsedHHMMSS(elapsedSeconds: number): string {
  const hours = Math.floor(elapsedSeconds / 3600);
  const mins = Math.floor((elapsedSeconds % 3600) / 60);
  const secs = elapsedSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function formatEventTimeWithLabel(iso: string | null | undefined, status: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  
  switch (status) {
    case "READY":
      return `Listo a las ${time}`;
    case "KITCHEN_DISPATCHED":
      return `Despachado a las ${time}`;
    case "PAID":
      return `Pagado a las ${time}`;
    case "CANCELLED":
      return `Cancelado a las ${time}`;
    default:
      return time;
  }
}
