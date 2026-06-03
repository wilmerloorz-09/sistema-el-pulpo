import type { Cliente, ClienteFormularioValores, ClienteSexo } from "@/types/cliente";

const SEXOS_VALIDOS: ClienteSexo[] = ["M", "F"];

const CEDULA_CELULAR_RE = /^[0-9]{10}$/;
const SOLO_LETRAS_RE = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ErroresClienteFormulario = Partial<Record<keyof ClienteFormularioValores, string>>;

export function normalizarCedulaCelular(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, 10);
}

export function normalizarSoloLetras(valor: string): string {
  return valor.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]/g, "").replace(/\s+/g, " ").trimStart();
}

/** Nombres y apellidos: solo letras/espacios y siempre en mayúsculas. */
export function normalizarNombresApellidos(valor: string): string {
  return normalizarSoloLetras(valor).toLocaleUpperCase("es-EC");
}

export function validarClienteFormulario(valores: ClienteFormularioValores): ErroresClienteFormulario {
  const errores: ErroresClienteFormulario = {};
  const cedula = normalizarCedulaCelular(valores.cedula);
  const celular = normalizarCedulaCelular(valores.celular);
  const nombres = valores.nombres.trim();
  const apellidos = valores.apellidos.trim();
  const correo = valores.correo.trim();
  const direccion = valores.direccion.trim();

  if (!CEDULA_CELULAR_RE.test(cedula)) {
    errores.cedula = "La cédula debe tener exactamente 10 dígitos numéricos.";
  }

  if (!valores.sexo || !SEXOS_VALIDOS.includes(valores.sexo)) {
    errores.sexo = "Seleccione el sexo.";
  }

  if (!nombres) {
    errores.nombres = "Los nombres son obligatorios.";
  } else if (!SOLO_LETRAS_RE.test(nombres)) {
    errores.nombres = "Solo letras y espacios.";
  } else if (nombres.length > 75) {
    errores.nombres = "Máximo 75 caracteres.";
  }

  if (!apellidos) {
    errores.apellidos = "Los apellidos son obligatorios.";
  } else if (!SOLO_LETRAS_RE.test(apellidos)) {
    errores.apellidos = "Solo letras y espacios.";
  } else if (apellidos.length > 75) {
    errores.apellidos = "Máximo 75 caracteres.";
  }

  if (!CEDULA_CELULAR_RE.test(celular)) {
    errores.celular = "El celular debe tener exactamente 10 dígitos numéricos.";
  }

  if (correo && !CORREO_RE.test(correo)) {
    errores.correo = "Correo electrónico no válido.";
  } else if (correo.length > 150) {
    errores.correo = "Máximo 150 caracteres.";
  }

  if (direccion.length > 2000) {
    errores.direccion = "La dirección es demasiado larga.";
  }

  return errores;
}

export function clienteFormularioEsValido(errores: ErroresClienteFormulario): boolean {
  return Object.keys(errores).length === 0;
}

/** Payload listo para persistir en Supabase. */
export function prepararClienteParaGuardar(
  valores: ClienteFormularioValores,
): Omit<ClienteFormularioValores, "correo" | "direccion"> & {
  correo: string | null;
  direccion: string | null;
} {
  const correo = valores.correo.trim();
  const direccion = valores.direccion.trim();

  return {
    cedula: normalizarCedulaCelular(valores.cedula),
    sexo: valores.sexo,
    nombres: normalizarNombresApellidos(valores.nombres).trim(),
    apellidos: normalizarNombresApellidos(valores.apellidos).trim(),
    celular: normalizarCedulaCelular(valores.celular),
    correo: correo || null,
    direccion: direccion || null,
  };
}

export function clienteAFormulario(cliente: Cliente): ClienteFormularioValores {
  return {
    cedula: cliente.cedula,
    sexo: cliente.sexo,
    nombres: normalizarNombresApellidos(cliente.nombres),
    apellidos: normalizarNombresApellidos(cliente.apellidos),
    celular: cliente.celular,
    correo: cliente.correo ?? "",
    direccion: cliente.direccion ?? "",
  };
}

export function nombreCompletoCliente(cliente: Pick<Cliente, "nombres" | "apellidos">): string {
  return `${cliente.nombres} ${cliente.apellidos}`.trim();
}
