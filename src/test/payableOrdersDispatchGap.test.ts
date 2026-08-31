import { describe, expect, it } from "vitest";
import {
  HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS,
  HUB_MIN_REFETCH_GAP_MS,
  hubMinRefetchGapMs,
  hubShouldInvalidateQuery,
  shouldSkipHubMinRefetchGap,
} from "@/lib/queryEgress";
import { qk } from "@/lib/queryKeys";

const NOW = 1_000_000;
const TWO_SECONDS_AGO = NOW - 2_000;
const AFTER_SHORT_GAP = NOW - (HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS + 1);
const AFTER_FULL_GAP = NOW - (HUB_MIN_REFETCH_GAP_MS + 1);

describe("Recaudar: gap corto en dispatch → payable-orders", () => {
  it("A. alta de orden (evento orders) conserva el gap de 10s", () => {
    expect(hubMinRefetchGapMs("orders", qk.payableOrders)).toBe(HUB_MIN_REFETCH_GAP_MS);
    expect(shouldSkipHubMinRefetchGap("orders", qk.payableOrders)).toBe(false);
    expect(hubShouldInvalidateQuery({
      source: "orders",
      queryKey: qk.payableOrders,
      updatedAt: TWO_SECONDS_AGO,
      now: NOW,
    })).toBe(false);
  });

  it("B. despacho usa gap corto (4s), no skip total ni gap de 10s", () => {
    expect(hubMinRefetchGapMs("dispatch", qk.payableOrders)).toBe(
      HUB_DISPATCH_PAYABLE_MIN_REFETCH_GAP_MS,
    );
    expect(shouldSkipHubMinRefetchGap("dispatch", qk.payableOrders)).toBe(false);

    // Aún caliente dentro del gap corto → no invalida (corta doble golpe RT).
    expect(hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: ["payable-orders", "branch-a", "DISPATCH_THEN_CASH", "shift-a"],
      updatedAt: TWO_SECONDS_AGO,
      now: NOW,
    })).toBe(false);

    // Pasado el gap corto → sí invalida (sin esperar 10s).
    expect(hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: ["payable-orders", "branch-a", "DISPATCH_THEN_CASH", "shift-a"],
      updatedAt: AFTER_SHORT_GAP,
      now: NOW,
    })).toBe(true);
  });

  it("C. el evento dispatch refresca Recaudar tras el gap corto, sin botón Actualizar", () => {
    const withinShortGap = hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: qk.payableOrders,
      updatedAt: TWO_SECONDS_AGO,
      now: NOW,
    });
    const afterShortGap = hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: qk.payableOrders,
      updatedAt: AFTER_SHORT_GAP,
      now: NOW,
    });
    const afterFullGap = hubShouldInvalidateQuery({
      source: "dispatch",
      queryKey: qk.payableOrders,
      updatedAt: AFTER_FULL_GAP,
      now: NOW,
    });

    expect(withinShortGap).toBe(false);
    expect(afterShortGap).toBe(true);
    expect(afterFullGap).toBe(true);
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
      expect(hubMinRefetchGapMs("dispatch", key)).toBe(HUB_MIN_REFETCH_GAP_MS);
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

    expect(hubMinRefetchGapMs("order_items", qk.payableOrders)).toBe(HUB_MIN_REFETCH_GAP_MS);
    expect(hubMinRefetchGapMs("payments", qk.payableOrders)).toBe(HUB_MIN_REFETCH_GAP_MS);
    expect(hubMinRefetchGapMs("ready", qk.payableOrders)).toBe(HUB_MIN_REFETCH_GAP_MS);
    expect(hubShouldInvalidateQuery({
      source: "payments",
      queryKey: qk.payableOrders,
      updatedAt: hot,
      now: NOW,
    })).toBe(false);
  });
});
