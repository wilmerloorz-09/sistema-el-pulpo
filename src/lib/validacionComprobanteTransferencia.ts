import type { AnalisisComprobanteTransferencia } from "@/services/analisisComprobanteTransferencia";
import { fechasAceptadasComprobante } from "@/lib/feriadosBancarios";

export { fechaActualEcuador, fechasAceptadasComprobante } from "@/lib/feriadosBancarios";

export type EstadoReglaComprobante = "COINCIDE" | "NO_COINCIDE" | "NO_VERIFICABLE";
export type EstadoValidacionComprobante =
  | "VALIDADO"
  | "CON_NOVEDADES"
  | "NO_VERIFICABLE";

export interface CuentaBancariaDestino {
  id: string;
  banco_id: string;
  numero_cuenta: string;
  numero_cuenta_normalizado: string;
  tipo_cuenta: "AHORROS" | "CORRIENTE";
  titular: string;
  identificacion_titular: string | null;
  alias: string | null;
  sucursal_id: string | null;
  activa: boolean;
}

export interface BancoParaValidacion {
  id: string;
  nombre: string;
  mascara_cuenta_destino?: string | null;
}

export interface ResultadoValidacionComprobante {
  estado: EstadoValidacionComprobante;
  cuentaDestinoId: string | null;
  reglas: {
    bancoDestino: EstadoReglaComprobante;
    titularDestino: EstadoReglaComprobante;
    cuentaDestino: EstadoReglaComprobante;
    fecha: EstadoReglaComprobante;
    monto: EstadoReglaComprobante;
  };
  novedades: string[];
}

function normalizarTexto(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(s\.?a\.?|cia\.?|ltda\.?|limitada|compania)\b/gi, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function compararTexto(
  detectado: string | null,
  esperado: string,
): EstadoReglaComprobante {
  const detected = normalizarTexto(detectado);
  const expected = normalizarTexto(esperado);
  if (!detected) return "NO_VERIFICABLE";
  if (!expected) return "NO_VERIFICABLE";
  return detected === expected
    || detected.includes(expected)
    || expected.includes(detected)
    ? "COINCIDE"
    : "NO_COINCIDE";
}

function normalizarMascara(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[^Xx*#]/g, "")
    .replace(/[x*]/gi, "X");
}

function obtenerDigitosEsperados(
  numeroCuenta: string,
  mascara: string,
): { digitos: string; inicio: number; final: number } | null {
  const cuenta = numeroCuenta.replace(/\D/g, "");
  const pattern = normalizarMascara(mascara);
  if (!cuenta || !pattern.includes("#")) return null;

  const inicio = pattern.match(/^#+/)?.[0].length ?? 0;
  const final = pattern.match(/#+$/)?.[0].length ?? 0;
  if (inicio + final > 0) {
    if (cuenta.length < inicio + final) return null;
    return {
      digitos: `${cuenta.slice(0, inicio)}${final ? cuenta.slice(-final) : ""}`,
      inicio,
      final,
    };
  }

  if (pattern.length !== cuenta.length) return null;
  const digitos = [...pattern]
    .map((char, index) => char === "#" ? cuenta[index] : "")
    .join("");
  return { digitos, inicio: 0, final: 0 };
}

export function compararCuentaEnmascarada(
  cuentaDetectada: string | null,
  numeroCuentaRegistrado: string,
  mascaraBancoOrigen: string | null | undefined,
): EstadoReglaComprobante {
  if (!cuentaDetectada?.trim()) return "NO_VERIFICABLE";
  const expected = obtenerDigitosEsperados(
    numeroCuentaRegistrado,
    mascaraBancoOrigen ?? "",
  );
  if (!expected) return "NO_VERIFICABLE";

  const detectedDigits = cuentaDetectada.replace(/\D/g, "");
  const fullAccount = numeroCuentaRegistrado.replace(/\D/g, "");
  if (!detectedDigits) return "NO_VERIFICABLE";

  let comparable = detectedDigits;
  if (detectedDigits.length === fullAccount.length) {
    comparable = `${detectedDigits.slice(0, expected.inicio)}${
      expected.final ? detectedDigits.slice(-expected.final) : ""
    }`;
  }

  if (comparable.length !== expected.digitos.length) return "NO_VERIFICABLE";
  return comparable === expected.digitos ? "COINCIDE" : "NO_COINCIDE";
}

function validarFecha(
  fechaDetectada: string | null,
  now: Date,
  feriados: Iterable<string> = [],
): EstadoReglaComprobante {
  if (!fechaDetectada) return "NO_VERIFICABLE";
  const isoDate = fechaDetectada.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!isoDate) return "NO_VERIFICABLE";
  return fechasAceptadasComprobante(now, feriados).includes(isoDate)
    ? "COINCIDE"
    : "NO_COINCIDE";
}

function validarMonto(
  montoDetectado: number | null,
  montoEsperado: number,
): EstadoReglaComprobante {
  if (!montoDetectado || !Number.isFinite(montoDetectado)) return "NO_VERIFICABLE";
  return Math.abs(montoDetectado - montoEsperado) < 0.005
    ? "COINCIDE"
    : "NO_COINCIDE";
}

function scoreRegla(value: EstadoReglaComprobante, weight = 1): number {
  if (value === "COINCIDE") return 2 * weight;
  if (value === "NO_COINCIDE") return -weight;
  return 0;
}

export function validarComprobanteContraCuentas(params: {
  analisis: AnalisisComprobanteTransferencia;
  cuentas: CuentaBancariaDestino[];
  bancos: BancoParaValidacion[];
  bancoOrigenId: string;
  montoEsperado: number;
  now?: Date;
  feriados?: Iterable<string>;
}): ResultadoValidacionComprobante {
  const {
    analisis,
    cuentas,
    bancos,
    bancoOrigenId,
    montoEsperado,
    now = new Date(),
    feriados = [],
  } = params;
  const bancoOrigen = bancos.find((banco) => banco.id === bancoOrigenId);

  const candidatos = cuentas.map((cuenta) => {
    const bancoDestino = bancos.find((banco) => banco.id === cuenta.banco_id);
    const reglas = {
      bancoDestino: compararTexto(analisis.bancoDestino, bancoDestino?.nombre ?? ""),
      titularDestino: compararTexto(analisis.titularDestino, cuenta.titular),
      cuentaDestino: compararCuentaEnmascarada(
        analisis.cuentaDestino,
        cuenta.numero_cuenta_normalizado || cuenta.numero_cuenta,
        bancoOrigen?.mascara_cuenta_destino,
      ),
    };
    const score = scoreRegla(reglas.cuentaDestino, 4)
      + scoreRegla(reglas.bancoDestino, 2)
      + scoreRegla(reglas.titularDestino, 2);
    return { cuenta, reglas, score };
  });

  const mejorCandidato = candidatos.sort((a, b) => b.score - a.score)[0] ?? null;
  const candidato = mejorCandidato && mejorCandidato.score > 0
    ? mejorCandidato
    : null;
  const reglas = {
    bancoDestino: candidato?.reglas.bancoDestino ?? "NO_VERIFICABLE",
    titularDestino: candidato?.reglas.titularDestino ?? "NO_VERIFICABLE",
    cuentaDestino: candidato?.reglas.cuentaDestino ?? "NO_VERIFICABLE",
    fecha: validarFecha(analisis.fechaTransferencia, now, feriados),
    monto: validarMonto(analisis.monto, montoEsperado),
  } satisfies ResultadoValidacionComprobante["reglas"];

  const labels: Record<keyof typeof reglas, string> = {
    bancoDestino: "El banco destino no coincide con una cuenta autorizada",
    titularDestino: "El titular destino no coincide con una cuenta autorizada",
    cuentaDestino: "Los dígitos visibles de la cuenta destino no coinciden",
    fecha: "La fecha del comprobante no corresponde al día de hoy (en días no hábiles también se acepta el siguiente día hábil bancario)",
    monto: "El valor detectado no coincide con el valor registrado",
  };
  const unverifiable: Record<keyof typeof reglas, string> = {
    bancoDestino: "No se pudo verificar el banco destino",
    titularDestino: "No se pudo verificar el titular destino",
    cuentaDestino: "No se pudo verificar la cuenta destino",
    fecha: "No se pudo verificar la fecha del comprobante",
    monto: "No se pudo verificar el valor del comprobante",
  };

  const entries = Object.entries(reglas) as Array<
    [keyof typeof reglas, EstadoReglaComprobante]
  >;
  const mismatches = entries
    .filter(([, value]) => value === "NO_COINCIDE")
    .map(([key]) => labels[key]);
  const unknowns = entries
    .filter(([, value]) => value === "NO_VERIFICABLE")
    .map(([key]) => unverifiable[key]);

  const estado: EstadoValidacionComprobante = mismatches.length > 0
    ? "CON_NOVEDADES"
    : unknowns.length > 0
      ? "NO_VERIFICABLE"
      : "VALIDADO";

  return {
    estado,
    cuentaDestinoId: candidato?.cuenta.id ?? null,
    reglas,
    novedades: estado === "VALIDADO" ? [] : [...mismatches, ...unknowns],
  };
}
