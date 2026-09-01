import type { CashClosureReportParams } from "@/lib/cashReportUtils";

type CashReportState = {
  html: string;
  autoPrint: boolean;
  printParams: CashClosureReportParams | null;
} | null;

type CashReportListener = (state: CashReportState) => void;

let currentState: CashReportState = null;
const listeners = new Set<CashReportListener>();

export const getCashReportState = () => currentState;

export const showCashReport = (
  html: string,
  options?: {
    autoPrint?: boolean;
    printParams?: CashClosureReportParams | null;
  },
) => {
  currentState = {
    html,
    autoPrint: Boolean(options?.autoPrint),
    printParams: options?.printParams ?? null,
  };
  listeners.forEach((listener) => listener(currentState));
};

export const hideCashReport = () => {
  currentState = null;
  listeners.forEach((listener) => listener(null));
};

export const subscribeCashReport = (listener: CashReportListener) => {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
};
