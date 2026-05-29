import { describe, expect, it } from "vitest";
import {
  buildCajaRpcPayload,
  buildCajaSetupIssues,
  getPrimaryCashierIdFromSetup,
} from "@/lib/shiftCajaSetupModel";

describe("shiftCajaSetupModel", () => {
  it("arma payload con principal y secundarios", () => {
    const payload = buildCajaRpcPayload({
      cashiers: [
        { id: "1", user_id: "p1", template_id: "t1", is_primary: true },
        { id: "2", user_id: "s1", template_id: "t2", is_primary: false },
      ],
    });
    expect(payload.p_primary_cashier_id).toBe("p1");
    expect(payload.p_secondary_cajas_enabled).toBe(true);
    expect(payload.p_secondary_cashier_ids).toEqual(["s1"]);
    expect(payload.p_secondary_caja_config).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: "p1", template_id: "t1" }),
        expect.objectContaining({ user_id: "s1", template_id: "t2" }),
      ]),
    );
  });

  it("incluye plantilla del cajero principal en la config enviada al RPC", () => {
    const payload = buildCajaRpcPayload({
      cashiers: [{ id: "1", user_id: "p1", template_id: "t1", is_primary: true }],
    });
    expect(payload.p_secondary_caja_config).toEqual([
      expect.objectContaining({ user_id: "p1", template_id: "t1" }),
    ]);
  });

  it("solo secundarios sin principal", () => {
    const payload = buildCajaRpcPayload({
      cashiers: [{ id: "1", user_id: "s1", template_id: "t1", is_primary: false }],
    });
    expect(payload.p_primary_cashier_id).toBeNull();
    expect(getPrimaryCashierIdFromSetup({ cashiers: [] })).toBe("");
  });

  it("valida plantilla por cajero", () => {
    const issues = buildCajaSetupIssues(
      {
        cashiers: [{ id: "1", user_id: "u1", is_primary: false }],
      },
      ["u1"],
    );
    expect(issues.some((issue) => issue.includes("plantilla"))).toBe(true);
  });
});
