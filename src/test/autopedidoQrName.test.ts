import { describe, expect, it } from "vitest";
import { nombreVisibleAutopedidoQr } from "@/services/autopedidosQrDb";

describe("nombreVisibleAutopedidoQr", () => {
  it("usa Nombre QR en productos cuando existe", () => {
    expect(
      nombreVisibleAutopedidoQr({
        name: "E_Pes_Jr",
        qr_name: "Encebollado junior",
        node_type: "product",
      }),
    ).toBe("Encebollado junior");
  });

  it("cae al nombre interno si Nombre QR esta vacio", () => {
    expect(
      nombreVisibleAutopedidoQr({
        name: "E_Pes_Jr",
        qr_name: "  ",
        node_type: "product",
      }),
    ).toBe("E_Pes_Jr");
  });

  it("no cambia el nombre de categorias", () => {
    expect(
      nombreVisibleAutopedidoQr({
        name: "L Encebollados",
        qr_name: "No deberia usarse",
        node_type: "category",
      }),
    ).toBe("L Encebollados");
  });
});
