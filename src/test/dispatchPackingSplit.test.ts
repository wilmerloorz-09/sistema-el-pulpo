import { describe, expect, it } from "vitest";
import {
  isPackingQueueOrderType,
  shouldExcludeOrderFromDispatchForPackingSplit,
} from "@/lib/dispatchPackingSplit";

describe("dispatchPackingSplit", () => {
  it("clasifica para llevar y express como cola de empaquetador", () => {
    expect(isPackingQueueOrderType("TAKEOUT")).toBe(true);
    expect(isPackingQueueOrderType("EXPRESS")).toBe(true);
    expect(isPackingQueueOrderType("TABLE")).toBe(false);
    expect(isPackingQueueOrderType("DINE_IN")).toBe(false);
    expect(isPackingQueueOrderType("EXTRA")).toBe(false);
  });

  it("excluye para llevar y express de Despacho solo si hay empaquetador habilitado", () => {
    expect(
      shouldExcludeOrderFromDispatchForPackingSplit(
        { order_type: "TAKEOUT" },
        { module: "dispatch", hasEnabledPackers: true },
      ),
    ).toBe(true);
    expect(
      shouldExcludeOrderFromDispatchForPackingSplit(
        { order_type: "EXPRESS" },
        { module: "dispatch", hasEnabledPackers: true },
      ),
    ).toBe(true);
    expect(
      shouldExcludeOrderFromDispatchForPackingSplit(
        { order_type: "TAKEOUT" },
        { module: "dispatch", hasEnabledPackers: false },
      ),
    ).toBe(false);
  });

  it("mantiene las demas ordenes en Despacho aunque haya empaquetador", () => {
    expect(
      shouldExcludeOrderFromDispatchForPackingSplit(
        { order_type: "TABLE" },
        { module: "dispatch", hasEnabledPackers: true },
      ),
    ).toBe(false);
    expect(
      shouldExcludeOrderFromDispatchForPackingSplit(
        { order_type: "EXTRA" },
        { module: "dispatch", hasEnabledPackers: true },
      ),
    ).toBe(false);
  });

  it("no aplica la exclusion a otros modulos", () => {
    expect(
      shouldExcludeOrderFromDispatchForPackingSplit(
        { order_type: "TAKEOUT" },
        { module: "packing", hasEnabledPackers: true },
      ),
    ).toBe(false);
  });
});
