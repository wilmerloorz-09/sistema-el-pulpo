import { describe, expect, it } from "vitest";
import { datosClienteEnRecibo } from "@/lib/paymentReceiptData";

describe("paymentReceiptData", () => {
  it("incluye cédula y nombre en el recibo cuando hay cliente", () => {
    expect(
      datosClienteEnRecibo({
        cedula: "1712345678",
        nombres: "JUAN",
        apellidos: "PÉREZ",
      }),
    ).toEqual({
      clienteCedula: "1712345678",
      clienteNombre: "JUAN PÉREZ",
    });
  });

  it("devuelve vacío sin cliente", () => {
    expect(datosClienteEnRecibo(null)).toEqual({});
  });
});
