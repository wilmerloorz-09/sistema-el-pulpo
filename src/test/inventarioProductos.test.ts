import { describe, expect, it } from "vitest";
import {
  calcularCantidadNuevaMovimiento,
  estadoInventarioDesdeCantidad,
  etiquetaCantidadMovimiento,
  etiquetaTipoMovimientoInventario,
  etiquetaTipoProducto,
  normalizarCantidadInventario,
  validarMovimientoInventario,
  motivoMovimientoParaRpc,
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

  it("calcula cantidad nueva por tipo de movimiento", () => {
    expect(calcularCantidadNuevaMovimiento(10, "INGRESO", 5)).toBe(15);
    expect(calcularCantidadNuevaMovimiento(10, "SALIDA", 4)).toBe(6);
    expect(calcularCantidadNuevaMovimiento(10, "AJUSTE", 25)).toBe(25);
  });

  it("valida movimientos de inventario", () => {
    expect(validarMovimientoInventario(10, "INGRESO", 0, "Compra")).toMatch(/mayor a 0/);
    expect(validarMovimientoInventario(10, "SALIDA", 11, "Traslado")).toMatch(/insuficiente/);
    expect(validarMovimientoInventario(10, "AJUSTE", 8, "")).toMatch(/motivo/);
    expect(validarMovimientoInventario(10, "SALIDA", 3, "")).toMatch(/motivo/);
    expect(validarMovimientoInventario(10, "INGRESO", 3, "")).toBeNull();
    expect(validarMovimientoInventario(10, "INGRESO", 3, "Reposición")).toBeNull();
  });

  it("motivo por defecto en ingreso para RPC", () => {
    expect(motivoMovimientoParaRpc("INGRESO", "")).toBe("Ingreso");
    expect(motivoMovimientoParaRpc("INGRESO", "  ")).toBe("Ingreso");
    expect(motivoMovimientoParaRpc("INGRESO", "Compra")).toBe("Compra");
    expect(motivoMovimientoParaRpc("SALIDA", "Traslado")).toBe("Traslado");
  });

  it("etiqueta movimientos", () => {
    expect(etiquetaTipoMovimientoInventario("INGRESO")).toBe("Ingreso");
    expect(etiquetaCantidadMovimiento("INGRESO", 5, 10, 15)).toBe("+5");
    expect(etiquetaCantidadMovimiento("AJUSTE", 20, 10, 20)).toBe("10 → 20");
  });
});
