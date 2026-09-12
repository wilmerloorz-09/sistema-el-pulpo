import { toast as uiToast, dismissToast } from "@/hooks/use-toast";

type ToastHandler = (...args: unknown[]) => string | number | void;

type ToastOptions = {
  description?: unknown;
  duration?: number;
};

const TOAST_DURATION_MS = 4500;

function resolveMessage(args: unknown[]): {
  title: string;
  description?: string;
  duration?: number;
} {
  const [first, second] = args;
  const options =
    second && typeof second === "object" && second !== null
      ? (second as ToastOptions)
      : null;

  if (typeof first === "string") {
    if (options && "description" in options) {
      const description = options.description;
      return {
        title: first,
        description: description == null ? undefined : String(description),
        duration: options.duration,
      };
    }
    if (typeof second === "string") {
      return { title: first, description: second };
    }
    return { title: first, duration: options?.duration };
  }
  if (first instanceof Error) {
    return { title: first.message || "Error", duration: options?.duration };
  }
  if (first && typeof first === "object" && "message" in first) {
    return {
      title: String((first as { message?: unknown }).message ?? "Aviso"),
      duration: options?.duration,
    };
  }
  return {
    title: first == null ? "Aviso" : String(first),
    duration: options?.duration,
  };
}

function showError(...args: unknown[]) {
  const { title, description, duration } = resolveMessage(args);
  uiToast({
    title,
    description,
    variant: "destructive",
    duration: duration ?? TOAST_DURATION_MS,
  });
}

const noop: ToastHandler = () => {};

/**
 * Sonner está aliasado aquí a propósito.
 * - success / info / loading / message: silenciados (no deben aparecer en el sistema).
 * - error: sí se muestra (fallos reales: cobro, stock, etc.).
 */
export const toast = Object.assign(noop, {
  success: noop,
  error: ((...args: unknown[]) => showError(...args)) as ToastHandler,
  info: noop,
  warning: noop,
  message: noop,
  loading: noop,
  dismiss: ((...args: unknown[]) => {
    const id = typeof args[0] === "string" || typeof args[0] === "number" ? String(args[0]) : undefined;
    dismissToast(id);
  }) as ToastHandler,
  custom: noop,
  promise: <T,>(promise: Promise<T>) => promise,
});

export function Toaster(_props?: Record<string, unknown>) {
  return null;
}
