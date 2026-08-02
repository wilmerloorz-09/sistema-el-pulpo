import { describe, expect, it } from "vitest";
import {
  getDefaultCajaPayableOrderScope,
  orderMatchesCajaPayableScope,
  CAJA_PAYABLE_SCOPE_ALL,
  CAJA_PAYABLE_SCOPE_MINE,
} from "@/lib/cajaPayableOrderScope";

describe("cajaPayableOrderScope", () => {
  it("default: siempre todas las órdenes del turno", () => {
    expect(getDefaultCajaPayableOrderScope("u1", "u1")).toBe(CAJA_PAYABLE_SCOPE_ALL);
    expect(getDefaultCajaPayableOrderScope("u2", "u1")).toBe(CAJA_PAYABLE_SCOPE_ALL);
    expect(getDefaultCajaPayableOrderScope(undefined, null)).toBe(CAJA_PAYABLE_SCOPE_ALL);
  });

  it("filtra por alcance", () => {
    const order = { created_by: "u2" };
    expect(orderMatchesCajaPayableScope(order, CAJA_PAYABLE_SCOPE_ALL, "u1")).toBe(true);
    expect(orderMatchesCajaPayableScope(order, CAJA_PAYABLE_SCOPE_MINE, "u1")).toBe(false);
    expect(orderMatchesCajaPayableScope(order, "user:u2", "u1")).toBe(true);
    expect(orderMatchesCajaPayableScope(order, "user:u3", "u1")).toBe(false);
  });
});
