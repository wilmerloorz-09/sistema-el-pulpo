import { describe, expect, it } from "vitest";
import {
  HUB_MIN_REFETCH_GAP_MS,
  hubShouldInvalidateQuery,
  shouldSkipHubMinRefetchGap,
} from "@/lib/queryEgress";
import { qk } from "@/lib/queryKeys";

const NOW = 1_000_000;
const TWO_SECONDS_AGO = NOW - 2_000;
const AFTER_GAP = NOW - (HUB_MIN_REFETCH_GAP_MS + 1);

describe("Recaudar: gap de 10s no bloquea dispatch en payable-orders", () => {
  it("A. alta de orden (evento orders) no salta el gap: Recaudar puede actualizarse y seguir sin orden cobrable", () => {
    expect(shouldSkipHubMinRefetchGap("orders", qk.payableOrders)).toBe(false);
    expect(hubShouldInvalidateQuery({
      source: "orders",
      queryKey: qk.payableOrders,
      updatedAt: TWO_SECONDS_AGO,
      now: NOW,
    })).toBe(false);
  });

  it("B. despacho <10s después sí invalida payable-orders aunque la query esté caliente", () => {
    expect(shouldSkipHubMinRefetchGap("dispatch", qk.payableOrders)).toBe(true);
    expect(hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: ["payable-orders", "branch-a", "DISPATCH_THEN_CASH", "shift-a"],
      updatedAt: TWO_SECONDS_AGO,
      now: NOW,
    })).toBe(true);
  });

  it("C. el evento dispatch provoca refetch de payable-orders sin esperar el botón Actualizar", () => {
    const afterCreateRefetch = hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: qk.payableOrders,
      updatedAt: TWO_SECONDS_AGO,
      now: NOW,
    });
    const afterManualWait = hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: qk.payableOrders,
      updatedAt: AFTER_GAP,
      now: NOW,
    });

    expect(afterCreateRefetch).toBe(true);
    expect(afterManualWait).toBe(true);
  });

  it("D. Mesas, cocina y colas de despacho conservan el gap de 10s", () => {
    const hot = TWO_SECONDS_AGO;
    const otherKeys = [
      qk.tablesWithStatus,
      qk.tableOrders,
      qk.kitchenOrders,
      qk.dispatchOrders,
      qk.servirOrders,
      qk.dispatchServirQueueBundle,
      qk.orders,
    ] as const;

    for (const key of otherKeys) {
      expect(shouldSkipHubMinRefetchGap("dispatch", key)).toBe(false);
      expect(hubShouldInvalidateQuery({
        source: "dispatch",
        queryKey: key,
        updatedAt: hot,
        now: NOW,
      })).toBe(false);
      expect(hubShouldInvalidateQuery({
        source: "order_items",
        queryKey: key,
        updatedAt: hot,
        now: NOW,
      })).toBe(false);
    }

    expect(shouldSkipHubMinRefetchGap("order_items", qk.payableOrders)).toBe(false);
    expect(shouldSkipHubMinRefetchGap("payments", qk.payableOrders)).toBe(false);
    expect(shouldSkipHubMinRefetchGap("ready", qk.payableOrders)).toBe(false);
    expect(hubShouldInvalidateQuery({
      source: "payments",
      queryKey: qk.payableOrders,
      updatedAt: hot,
      now: NOW,
    })).toBe(false);
  });
});
