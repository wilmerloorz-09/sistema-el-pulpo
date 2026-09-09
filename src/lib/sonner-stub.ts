import { toast as uiToast } from "@/hooks/use-toast";

type ToastHandler = (...args: unknown[]) => string | number | void;

type ToastOptions = {
  description?: unknown;
  duration?: number;
};

function resolveMessage(args: unknown[]): { title: string; description?: string } {
  const [first, second] = args;
  if (typeof first === "string") {
    if (second && typeof second === "object" && second !== null && "description" in second) {
      const description = (second as ToastOptions).description;
      return {
        title: first,
        description: description == null ? undefined : String(description),
      };
    }
    if (typeof second === "string") {
      return { title: first, description: second };
    }
    return { title: first };
  }
  if (first instanceof Error) {
    return { title: first.message || "Error" };
  }
  if (first && typeof first === "object" && "message" in first) {
    return { title: String((first as { message?: unknown }).message ?? "Aviso") };
  }
  return { title: first == null ? "Aviso" : String(first) };
}

function show(variant: "default" | "destructive", ...args: unknown[]) {
  const { title, description } = resolveMessage(args);
  uiToast({
    title,
    description,
    variant,
  });
}

const base: ToastHandler = (...args) => {
  show("default", ...args);
};

/** Reenvía Sonner al Toaster de shadcn (el de Sonner está deshabilitado a propósito). */
export const toast = Object.assign(base, {
  success: ((...args: unknown[]) => show("default", ...args)) as ToastHandler,
  error: ((...args: unknown[]) => show("destructive", ...args)) as ToastHandler,
  info: ((...args: unknown[]) => show("default", ...args)) as ToastHandler,
  warning: ((...args: unknown[]) => show("default", ...args)) as ToastHandler,
  message: ((...args: unknown[]) => show("default", ...args)) as ToastHandler,
  loading: ((...args: unknown[]) => show("default", ...args)) as ToastHandler,
  dismiss: () => {},
  custom: ((...args: unknown[]) => show("default", ...args)) as ToastHandler,
  promise: <T,>(promise: Promise<T>) => promise,
});

export function Toaster(_props?: Record<string, unknown>) {
  return null;
}
