import { describe, expect, it } from "vitest";
import {
  calcularConsumoOrdenPromocion,
  cumpleConsumoMinimoPromocion,
  esPagoActivoParaConsumo,
} from "@/lib/promocionesElegibilidad";

describe("promocionesElegibilidad", () => {
  it("ignora pagos anulados o revertidos", () => {
    expect(esPagoActivoParaConsumo("VOIDED: supervisor")).toBe(false);
    expect(esPagoActivoParaConsumo("REVERSED: test")).toBe(false);
    expect(esPagoActivoParaConsumo(null)).toBe(true);
  });

  it("usa total manual en orden especial", () => {
    const consumo = calcularConsumoOrdenPromocion(
      { id: "o1", total: 1, is_special: true, special_total_manual: 15 },
      {},
    );
    expect(consumo).toBe(15);
  });

  it("usa suma de pagos si la cabecera no tiene total", () => {
    const consumo = calcularConsumoOrdenPromocion({ id: "o2", total: null }, { o2: 8.5 });
    expect(consumo).toBe(8.5);
  });

  it("valida consumo mínimo con tolerancia", () => {
    expect(cumpleConsumoMinimoPromocion(2.5, 2.5)).toBe(true);
    expect(cumpleConsumoMinimoPromocion(2.49, 2.5)).toBe(false);
  });
});
