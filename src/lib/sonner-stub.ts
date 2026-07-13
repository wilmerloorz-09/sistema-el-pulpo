type ToastHandler = (...args: unknown[]) => void;

const noop: ToastHandler = () => {};

/** Sonner deshabilitado: sin popups flotantes en el sistema. */
export const toast = Object.assign(noop, {
  success: noop,
  error: noop,
  info: noop,
  warning: noop,
  message: noop,
  loading: noop,
  dismiss: noop,
  custom: noop,
  promise: <T,>(promise: Promise<T>) => promise,
});

export function Toaster(_props?: Record<string, unknown>) {
  return null;
}
