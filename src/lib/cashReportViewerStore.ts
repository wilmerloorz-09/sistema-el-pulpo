type CashReportState = {
  html: string;
  autoPrint: boolean;
} | null;

type CashReportListener = (state: CashReportState) => void;

let currentState: CashReportState = null;
const listeners = new Set<CashReportListener>();

export const getCashReportState = () => currentState;

export const showCashReport = (html: string, options?: { autoPrint?: boolean }) => {
  currentState = {
    html,
    autoPrint: Boolean(options?.autoPrint),
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
