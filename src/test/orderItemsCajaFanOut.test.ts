import { describe, expect, it } from "vitest";
import { shouldFanOutConsumerKeyOnHubSource } from "@/lib/queryEgress";
import { qk } from "@/lib/queryKeys";

describe("Etapa 1: order_items no hace fan-out a Recaudar", () => {
  it("excluye payable, pagos del turno y turno de caja en order_items", () => {
    const blocked = [
      qk.payableOrders,
      qk.completedPayments,
      qk.currentShift,
      qk.openCashShift,
      qk.cashRegisterMovements,
      ["payable-orders", "branch-a", "DISPATCH_THEN_CASH", "shift-a"],
    ] as const;

    for (const key of blocked) {
      expect(shouldFanOutConsumerKeyOnHubSource("order_items", key)).toBe(false);
    }
  });

  it("sigue permitiendo fan-out de Mesas y colas en order_items", () => {
    const allowed = [
      qk.tablesWithStatus,
      qk.dispatchOrders,
      qk.servirOrders,
      ["takeout-orders"],
      ["kitchen-orders"],
    ] as const;

    for (const key of allowed) {
      expect(shouldFanOutConsumerKeyOnHubSource("order_items", key)).toBe(true);
    }
  });

  it("no afecta otros eventos: dispatch y payments siguen refrescando Recaudar", () => {
    expect(shouldFanOutConsumerKeyOnHubSource("dispatch", qk.payableOrders)).toBe(true);
    expect(shouldFanOutConsumerKeyOnHubSource("orders", qk.payableOrders)).toBe(true);
    expect(shouldFanOutConsumerKeyOnHubSource("payments", qk.payableOrders)).toBe(true);
  });
});
