import { describe, expect, it } from "vitest";
import {
  clienteFormularioEsValido,
  normalizarCedulaCelular,
  normalizarNombresApellidos,
  prepararClienteParaGuardar,
  validarClienteFormulario,
} from "@/lib/clientesValidacion";
import { CLIENTE_FORMULARIO_VACIO } from "@/types/cliente";

describe("clientesValidacion", () => {
  it("inicia el formulario con sexo masculino por defecto", () => {
    expect(CLIENTE_FORMULARIO_VACIO.sexo).toBe("M");
  });

  it("convierte nombres y apellidos a mayúsculas", () => {
    expect(normalizarNombresApellidos("maría josé")).toBe("MARÍA JOSÉ");
    expect(normalizarNombresApellidos("pérez")).toBe("PÉREZ");
  });

  it("normaliza cédula a 10 dígitos", () => {
    expect(normalizarCedulaCelular("12-345-678-90")).toBe("1234567890");
  });

  it("rechaza cédula incompleta", () => {
    const errores = validarClienteFormulario({
      ...CLIENTE_FORMULARIO_VACIO,
      cedula: "123",
      nombres: "Juan",
      apellidos: "Pérez",
      celular: "0991234567",
    });
    expect(errores.cedula).toBeTruthy();
    expect(clienteFormularioEsValido(errores)).toBe(false);
  });

  it("acepta formulario válido con correo y dirección opcionales", () => {
    const valores = {
      cedula: "1712345678",
      sexo: "F" as const,
      nombres: "María",
      apellidos: "Gómez",
      celular: "0987654321",
      correo: "",
      direccion: "",
    };
    const errores = validarClienteFormulario(valores);
    expect(clienteFormularioEsValido(errores)).toBe(true);
    expect(prepararClienteParaGuardar(valores)).toMatchObject({
      cedula: "1712345678",
      correo: null,
      direccion: null,
    });
  });
});
