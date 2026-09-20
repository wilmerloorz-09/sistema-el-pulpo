import { describe, expect, it } from "vitest";
import {
  fechaOperativaTurno,
  funcionesRealizadas,
  resolverSueldoPersonalDia,
  resumirPersonal,
} from "@/lib/personalLaboral";

const sueldo = {
  lunes_viernes: 20,
  sabado: 22,
  domingo: 25,
  dia_especial: 40,
};

describe("reporte de personal por turnos", () => {
  it("obtiene la fecha operativa en horario de Ecuador", () => {
    expect(fechaOperativaTurno("2026-09-08T03:30:00.000Z")).toBe("2026-09-07");
  });

  it("usa solo el sueldo de la persona (sin precios por sucursal)", () => {
    expect(resolverSueldoPersonalDia("2026-09-07", "pulpo-1", sueldo, []).valor).toBe(20);
    expect(resolverSueldoPersonalDia("2026-09-12", "pulpo-1", sueldo, []).valor).toBe(22);
    expect(resolverSueldoPersonalDia("2026-09-13", "pulpo-1", sueldo, []).valor).toBe(25);
  });

  it("sin sueldo de persona queda sin configurar", () => {
    expect(resolverSueldoPersonalDia("2026-09-07", "pulpo-1", null, [])).toEqual({
      valor: null,
      tipo: "SIN_CONFIGURAR",
    });
  });

  it("usa el sueldo de día especial de la persona cuando la fecha es especial", () => {
    expect(resolverSueldoPersonalDia(
      "2026-09-12",
      "pulpo-1",
      sueldo,
      [{ branch_id: "pulpo-1", fecha: "2026-09-12", valor: 99 }],
    )).toEqual({ valor: 40, tipo: "ESPECIAL" });
  });

  it("dia especial sin sueldo de persona queda sin configurar", () => {
    expect(resolverSueldoPersonalDia(
      "2026-09-12",
      "pulpo-1",
      null,
      [{ branch_id: "pulpo-1", fecha: "2026-09-12", valor: 99 }],
    )).toEqual({ valor: null, tipo: "SIN_CONFIGURAR" });
  });

  it("reconoce dia especial aunque la fecha venga con hora", () => {
    expect(resolverSueldoPersonalDia(
      "2026-09-12",
      "pulpo-1",
      sueldo,
      [{ branch_id: null, fecha: "2026-09-12T00:00:00+00:00", valor: 99 }],
    )).toEqual({ valor: 40, tipo: "ESPECIAL" });
  });

  it("resume turnos y total por persona", () => {
    const result = resumirPersonal([
      { userId: "jose", personName: "José", valor: 12 },
      { userId: "jose", personName: "José", valor: 14 },
      { userId: "ana", personName: "Ana", valor: 15 },
    ]);
    expect(result).toEqual([
      { userId: "ana", personName: "Ana", jornadas: 1, total: 15 },
      { userId: "jose", personName: "José", jornadas: 2, total: 26 },
    ]);
  });

  it("muestra todas las funciones asignadas a la persona en el turno", () => {
    expect(funcionesRealizadas({
      can_serve_tables: true,
      can_dispatch_orders: true,
      can_use_caja: true,
    })).toEqual(["Venta / Mesas", "Despacho", "Caja"]);
  });

  it("incluye Operativo en el resumen de funciones del turno", () => {
    expect(funcionesRealizadas({
      is_operativo: true,
    })).toEqual(["Operativo"]);
  });
});
