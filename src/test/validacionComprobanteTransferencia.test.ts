import { describe, expect, it } from "vitest";
import {
  compararCuentaEnmascarada,
  validarComprobanteContraCuentas,
  type BancoParaValidacion,
  type CuentaBancariaDestino,
} from "@/lib/validacionComprobanteTransferencia";
import type { AnalisisComprobanteTransferencia } from "@/services/analisisComprobanteTransferencia";

const bancos: BancoParaValidacion[] = [
  { id: "origen-final", nombre: "Banco Origen", mascara_cuenta_destino: "XXXXXX####" },
  { id: "origen-extremos", nombre: "Banco Extremos", mascara_cuenta_destino: "##XXXXX##" },
  { id: "destino", nombre: "Banco Pichincha", mascara_cuenta_destino: "XXXXXX####" },
];

const cuenta: CuentaBancariaDestino = {
  id: "cuenta-1",
  banco_id: "destino",
  numero_cuenta: "1234567890",
  numero_cuenta_normalizado: "1234567890",
  tipo_cuenta: "AHORROS",
  titular: "Picantería El Pulpo S.A.",
  identificacion_titular: "1799999999001",
  alias: "Principal",
  sucursal_id: null,
  activa: true,
};

const analisisBase: AnalisisComprobanteTransferencia = {
  numeroTransferencia: "ABC123",
  monto: 25.5,
  bancoOrigen: "Banco Origen",
  bancoDestino: "Banco Pichincha",
  titularDestino: "Picanteria El Pulpo",
  cuentaDestino: "XXXXXX7890",
  fechaTransferencia: "2026-07-18",
  confianza: 0.96,
  observaciones: "",
};

describe("compararCuentaEnmascarada", () => {
  it("compara últimos dígitos según la máscara del banco origen", () => {
    expect(
      compararCuentaEnmascarada("******7890", "1234567890", "XXXXXX####"),
    ).toBe("COINCIDE");
  });

  it("compara primeros y últimos dígitos", () => {
    expect(
      compararCuentaEnmascarada("12XXXXX90", "1234567890", "##XXXXX##"),
    ).toBe("COINCIDE");
    expect(
      compararCuentaEnmascarada("13XXXXX90", "1234567890", "##XXXXX##"),
    ).toBe("NO_COINCIDE");
  });
});

describe("validarComprobanteContraCuentas", () => {
  it("valida banco, titular, cuenta, fecha Ecuador y monto", () => {
    const result = validarComprobanteContraCuentas({
      analisis: analisisBase,
      cuentas: [cuenta],
      bancos,
      bancoOrigenId: "origen-final",
      montoEsperado: 25.5,
      now: new Date("2026-07-18T15:00:00Z"),
    });

    expect(result.estado).toBe("VALIDADO");
    expect(result.cuentaDestinoId).toBe("cuenta-1");
    expect(result.novedades).toEqual([]);
  });

  it("marca novedad si la fecha no es la del día en Ecuador", () => {
    const result = validarComprobanteContraCuentas({
      analisis: { ...analisisBase, fechaTransferencia: "2026-07-17" },
      cuentas: [cuenta],
      bancos,
      bancoOrigenId: "origen-final",
      montoEsperado: 25.5,
      now: new Date("2026-07-18T15:00:00Z"),
    });

    expect(result.estado).toBe("CON_NOVEDADES");
    expect(result.reglas.fecha).toBe("NO_COINCIDE");
  });

  it("queda no verificable cuando el comprobante oculta datos necesarios", () => {
    const result = validarComprobanteContraCuentas({
      analisis: {
        ...analisisBase,
        bancoDestino: null,
        titularDestino: null,
        cuentaDestino: null,
      },
      cuentas: [cuenta],
      bancos,
      bancoOrigenId: "origen-final",
      montoEsperado: 25.5,
      now: new Date("2026-07-18T15:00:00Z"),
    });

    expect(result.estado).toBe("NO_VERIFICABLE");
    expect(result.novedades.length).toBeGreaterThan(0);
  });
});
