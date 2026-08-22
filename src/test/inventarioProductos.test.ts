import { describe, expect, it } from "vitest";
import {
  estadoInventarioDesdeCantidad,
  etiquetaTipoProducto,
  normalizarCantidadInventario,
} from "@/lib/inventarioProductos";

describe("inventarioProductos", () => {
  it("marca DISPONIBLE solo con cantidad > 0", () => {
    expect(estadoInventarioDesdeCantidad(0)).toBe("AGOTADO");
    expect(estadoInventarioDesdeCantidad(0.001)).toBe("DISPONIBLE");
    expect(estadoInventarioDesdeCantidad(12)).toBe("DISPONIBLE");
  });

  it("etiqueta tipo de producto", () => {
    expect(etiquetaTipoProducto("COMPRADO")).toBe("Comprado");
    expect(etiquetaTipoProducto("PREPARADO")).toBe("Preparado");
  });

  it("normaliza cantidad sin negativos", () => {
    expect(normalizarCantidadInventario("-3")).toBe(0);
    expect(normalizarCantidadInventario("2,5")).toBe(2.5);
    expect(normalizarCantidadInventario("1.2345")).toBe(1.235);
  });
});
