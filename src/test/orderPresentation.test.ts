import { describe, expect, it } from "vitest";
import {
  cleanOrderCode,
  getOrderMesaHeaderNumber,
  getOrderOriginLabel,
  getOrderRef,
} from "@/lib/orderPresentation";

describe("cleanOrderCode", () => {
  it("quita el sufijo de anulación -Vxxxx", () => {
    expect(cleanOrderCode("SUC001280528-0001-Vcdfc")).toBe("SUC001280528-0001");
  });
});

describe("getOrderRef", () => {
  it("prioriza order_number sobre order_code con sufijo de anulación", () => {
    expect(getOrderRef("SUC001280528-0001-Vcdfc", 1)).toBe("#0001");
  });

  it("usa order_number aunque order_code sea null (histórica)", () => {
    expect(getOrderRef(null, 1)).toBe("#0001");
  });
});

describe("getOrderOriginLabel", () => {
  it("para especial en mesa muestra la mesa y el marcador especial", () => {
    expect(
      getOrderOriginLabel({
        orderType: "DINE_IN",
        tableName: "Mesa 2",
        isSpecial: true,
      }),
    ).toBe("Mesa 2 (Orden Especial)");
  });

  it("para especial sin mesa queda solo Orden Especial", () => {
    expect(
      getOrderOriginLabel({
        orderType: "DINE_IN",
        tableName: null,
        isSpecial: true,
      }),
    ).toBe("Orden Especial");
  });
});

describe("getOrderMesaHeaderNumber", () => {
  it("prioriza order_number sobre order_code con sufijo de anulación", () => {
    expect(
      getOrderMesaHeaderNumber({
        orderCode: "SUC001280528-0001-Vcdfc",
        orderNumber: 1,
        tableOrderPosition: 1,
      }),
    ).toBe("0001");
  });

  it("extrae secuencia numérica del order_code limpio", () => {
    expect(
      getOrderMesaHeaderNumber({
        orderCode: "SUC001280528-0042",
        orderNumber: null,
        tableOrderPosition: 2,
      }),
    ).toBe("0042");
  });

  it("usa posición de mesa si no hay número operativo", () => {
    expect(
      getOrderMesaHeaderNumber({
        orderCode: null,
        orderNumber: null,
        tableOrderPosition: 3,
      }),
    ).toBe("3");
  });
});
