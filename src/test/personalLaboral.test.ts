import { describe, expect, it } from "vitest";
import { fechaOperativaTurno, funcionesRealizadas, resolverPrecioDia, resumirPersonal } from "@/lib/personalLaboral";

const weekly = {
  branch_id: "pulpo-1",
  lunes_viernes: 12,
  sabado: 14,
  domingo: 15,
};

describe("reporte de personal por turnos", () => {
  it("obtiene la fecha operativa en horario de Ecuador", () => {
    expect(fechaOperativaTurno("2026-09-08T03:30:00.000Z")).toBe("2026-09-07");
  });

  it("aplica precios de lunes a viernes, sábado y domingo", () => {
    expect(resolverPrecioDia("2026-09-07", "pulpo-1", weekly, []).valor).toBe(12);
    expect(resolverPrecioDia("2026-09-12", "pulpo-1", weekly, []).valor).toBe(14);
    expect(resolverPrecioDia("2026-09-13", "pulpo-1", weekly, []).valor).toBe(15);
  });

  it("el precio de una fecha especial reemplaza al precio semanal", () => {
    const result = resolverPrecioDia("2026-09-12", "pulpo-1", weekly, [
      { branch_id: "pulpo-1", fecha: "2026-09-12", valor: 25 },
    ]);
    expect(result).toEqual({ valor: 25, tipo: "ESPECIAL" });
  });

  it("usa una fecha especial global cuando la sucursal no tiene una propia", () => {
    const result = resolverPrecioDia("2026-09-12", "pulpo-2", weekly, [
      { branch_id: null, fecha: "2026-09-12", valor: 22 },
    ]);
    expect(result).toEqual({ valor: 22, tipo: "ESPECIAL" });
  });

  it("una fecha especial de sucursal tiene prioridad sobre la global", () => {
    const result = resolverPrecioDia("2026-09-12", "pulpo-1", weekly, [
      { branch_id: null, fecha: "2026-09-12", valor: 22 },
      { branch_id: "pulpo-1", fecha: "2026-09-12", valor: 30 },
    ]);
    expect(result).toEqual({ valor: 30, tipo: "ESPECIAL" });
  });

  it("mantiene los precios separados por sucursal", () => {
    expect(resolverPrecioDia("2026-09-07", "pulpo-2", undefined, [])).toEqual({
      valor: null,
      tipo: "SIN_CONFIGURAR",
    });
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
});
