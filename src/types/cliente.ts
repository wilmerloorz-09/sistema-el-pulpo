/** Sexo registrado en tabla `clientes`. */
export type ClienteSexo = "M" | "F";

export const CLIENTE_SEXO_OPCIONES: { value: ClienteSexo; label: string }[] = [
  { value: "M", label: "Masculino" },
  { value: "F", label: "Femenino" },
];

export function etiquetaSexoCliente(sexo: ClienteSexo): string {
  return CLIENTE_SEXO_OPCIONES.find((o) => o.value === sexo)?.label ?? sexo;
}

/** Registro de comensal en tabla `clientes`. */
export interface Cliente {
  id: string;
  cedula: string;
  sexo: ClienteSexo;
  nombres: string;
  apellidos: string;
  celular: string;
  correo: string | null;
  direccion: string | null;
  creado_por: string | null;
  creado_el: string;
  actualizado_el: string;
}

/** Valores editables del formulario (crear / editar). */
export interface ClienteFormularioValores {
  cedula: string;
  sexo: ClienteSexo;
  nombres: string;
  apellidos: string;
  celular: string;
  correo: string;
  direccion: string;
}

export const CLIENTE_FORMULARIO_VACIO: ClienteFormularioValores = {
  cedula: "",
  sexo: "M",
  nombres: "",
  apellidos: "",
  celular: "",
  correo: "",
  direccion: "",
};
