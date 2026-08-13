import { describe, expect, it } from "vitest";
import {
  domingoPascua,
  esDiaHabilBancario,
  expandirRangoFechas,
  fechasAceptadasComprobante,
  feriadosNacionalesEcuador,
  siguienteDiaHabil,
} from "@/lib/feriadosBancarios";

describe("feriadosBancarios", () => {
  it("calcula Pascua 2026 y Carnaval", () => {
    expect(domingoPascua(2026)).toBe("2026-04-05");
    const nacionales = feriadosNacionalesEcuador(2026);
    expect(nacionales).toContainEqual({ fecha: "2026-02-16", nombre: "Carnaval" });
    expect(nacionales).toContainEqual({ fecha: "2026-02-17", nombre: "Carnaval" });
    expect(nacionales).toContainEqual({ fecha: "2026-04-02", nombre: "Jueves Santo" });
    expect(nacionales).toContainEqual({ fecha: "2026-04-03", nombre: "Viernes Santo" });
  });

  it("entre semana sin feriado solo acepta hoy", () => {
    expect(fechasAceptadasComprobante(new Date("2026-07-15T15:00:00Z")))
      .toEqual(["2026-07-15"]);
  });

  it("sábado y domingo siguen aceptando el lunes siguiente", () => {
    expect(fechasAceptadasComprobante(new Date("2026-07-18T15:00:00Z")))
      .toEqual(["2026-07-18", "2026-07-20"]);
    expect(fechasAceptadasComprobante(new Date("2026-07-19T15:00:00Z")))
      .toEqual(["2026-07-19", "2026-07-20"]);
  });

  it("feriado lunes acepta lunes y martes", () => {
    expect(fechasAceptadasComprobante(new Date("2026-08-10T15:00:00Z"), ["2026-08-10"]))
      .toEqual(["2026-08-10", "2026-08-11"]);
  });

  it("feriado viernes acepta viernes y lunes", () => {
    expect(fechasAceptadasComprobante(new Date("2026-12-25T15:00:00Z"), ["2026-12-25"]))
      .toEqual(["2026-12-25", "2026-12-28"]);
  });

  it("feriado de varios días salta hasta el siguiente hábil", () => {
    const carnaval = ["2026-02-16", "2026-02-17"];
    expect(fechasAceptadasComprobante(new Date("2026-02-16T15:00:00Z"), carnaval))
      .toEqual(["2026-02-16", "2026-02-18"]);
    expect(fechasAceptadasComprobante(new Date("2026-02-17T15:00:00Z"), carnaval))
      .toEqual(["2026-02-17", "2026-02-18"]);
    expect(esDiaHabilBancario("2026-02-18", carnaval)).toBe(true);
  });

  it("el día hábil siguiente a un feriado solo acepta ese día", () => {
    expect(fechasAceptadasComprobante(new Date("2026-08-11T15:00:00Z"), ["2026-08-10"]))
      .toEqual(["2026-08-11"]);
  });

  it("siguienteDiaHabil salta finde y feriados", () => {
    expect(siguienteDiaHabil("2026-08-07", ["2026-08-10"])).toBe("2026-08-11");
  });

  it("expande un rango omitiendo fines de semana", () => {
    expect(expandirRangoFechas("2026-02-16", "2026-02-18")).toEqual([
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
    ]);
    expect(expandirRangoFechas("2026-12-25", "2026-12-27")).toEqual(["2026-12-25"]);
  });
});
