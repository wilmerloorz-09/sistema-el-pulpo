import { describe, expect, it } from "vitest";
import { turnoDeSesionTerminado } from "@/lib/sesionTurno";

const sesion = { userId: "u1", branchId: "b1", shiftId: "s1" };

describe("turnoDeSesionTerminado", () => {
  it("no cierra si no hay turno registrado en la sesion", () => {
    expect(
      turnoDeSesionTerminado(null, { userId: "u1", branchId: "b1", shiftOpen: false, shiftId: null }),
    ).toBe(false);
  });

  it("no cierra mientras siga abierto el mismo turno", () => {
    expect(
      turnoDeSesionTerminado(sesion, { userId: "u1", branchId: "b1", shiftOpen: true, shiftId: "s1" }),
    ).toBe(false);
  });

  it("cierra cuando el turno se cerro", () => {
    expect(
      turnoDeSesionTerminado(sesion, { userId: "u1", branchId: "b1", shiftOpen: false, shiftId: null }),
    ).toBe(true);
  });

  it("cierra cuando ya hay otro turno abierto", () => {
    expect(
      turnoDeSesionTerminado(sesion, { userId: "u1", branchId: "b1", shiftOpen: true, shiftId: "s2" }),
    ).toBe(true);
  });

  it("ignora otra sucursal u otro usuario", () => {
    expect(
      turnoDeSesionTerminado(sesion, { userId: "u1", branchId: "b2", shiftOpen: false, shiftId: null }),
    ).toBe(false);
    expect(
      turnoDeSesionTerminado(sesion, { userId: "u2", branchId: "b1", shiftOpen: false, shiftId: null }),
    ).toBe(false);
  });
});
