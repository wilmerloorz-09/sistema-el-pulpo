import type {
  CampanaPromocional,
  CampanaPromocionalFormulario,
  OfertaCartelera,
  ResultadoOferta,
} from "@/types/campanaPromocional";
import { generateUUID } from "@/lib/uuid";

export type CampanaDatosBasicosFormulario = Pick<
  CampanaPromocionalFormulario,
  "titulo" | "consumo_minimo" | "porcentaje_descuento" | "descuento_maximo" | "dias_vigencia_descuento" | "activa"
>;

export type ErroresCampanaFormulario = Partial<Record<keyof CampanaPromocionalFormulario | "cartelera", string>>;

export function nuevaIdOferta(): string {
  return `oferta-${generateUUID().slice(0, 8)}`;
}

export function nuevaOfertaCartelera(idOferta?: string): OfertaCartelera {
  return {
    id_oferta: idOferta ?? nuevaIdOferta(),
    descripcion: "",
    bloqueo_at: "",
    cuota: 0,
    resultado: "PENDIENTE",
  };
}

export function normalizarResultadoOferta(valor?: string): ResultadoOferta {
  if (valor === "GANADA" || valor === "PERDIDA") return valor;
  return "PENDIENTE";
}

export function etiquetaResultadoOferta(resultado: ResultadoOferta): string {
  if (resultado === "GANADA") return "Ganadora";
  if (resultado === "PERDIDA") return "Perdedora";
  return "Pendiente";
}

/** Alinea cartelera con ofertas_cumplidas (datos legacy sin campo resultado). */
export function enriquecerCarteleraConResultado(
  ofertas: OfertaCartelera[],
  ofertasCumplidas: string[],
): OfertaCartelera[] {
  const hayCierre = ofertasCumplidas.length > 0;
  return ofertas.map((o) => {
    if (o.resultado) {
      return { ...o, resultado: normalizarResultadoOferta(o.resultado) };
    }
    if (ofertasCumplidas.includes(o.id_oferta)) {
      return { ...o, resultado: "GANADA" as const };
    }
    if (hayCierre) {
      return { ...o, resultado: "PERDIDA" as const };
    }
    return { ...o, resultado: "PENDIENTE" as const };
  });
}

export function ofertasCumplidasDesdeCartelera(ofertas: OfertaCartelera[]): string[] {
  return ofertas.filter((o) => normalizarResultadoOferta(o.resultado) === "GANADA").map((o) => o.id_oferta);
}

export function prepararOfertaParaGuardar(oferta: OfertaCartelera): OfertaCartelera {
  return {
    id_oferta: oferta.id_oferta.trim(),
    descripcion: oferta.descripcion.trim(),
    bloqueo_at: oferta.bloqueo_at,
    cuota: Number(oferta.cuota),
    resultado: normalizarResultadoOferta(oferta.resultado),
  };
}

export function campanaAFormularioBasico(campana: CampanaPromocional): CampanaDatosBasicosFormulario {
  return {
    titulo: campana.titulo,
    consumo_minimo: String(campana.consumo_minimo),
    porcentaje_descuento: String(campana.porcentaje_descuento),
    descuento_maximo: String(campana.descuento_maximo),
    dias_vigencia_descuento: String(campana.dias_vigencia_descuento),
    activa: campana.activa,
  };
}

/** Acepta "2.5" o "2,5" en formularios. */
export function parseNumeroCampo(valor: string): number {
  const normalizado = valor.trim().replace(",", ".");
  if (!normalizado) return Number.NaN;
  return Number(normalizado);
}

export function validarCampanaDatosBasicos(valores: CampanaDatosBasicosFormulario): ErroresCampanaFormulario {
  const errores: ErroresCampanaFormulario = {};
  if (!valores.titulo.trim()) errores.titulo = "El título es obligatorio.";

  const consumo = parseNumeroCampo(valores.consumo_minimo);
  if (!Number.isFinite(consumo) || consumo < 0) errores.consumo_minimo = "Consumo mínimo inválido.";

  const pct = parseNumeroCampo(valores.porcentaje_descuento);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) errores.porcentaje_descuento = "Porcentaje entre 0 y 100.";

  const max = parseNumeroCampo(valores.descuento_maximo);
  if (!Number.isFinite(max) || max < 0) errores.descuento_maximo = "Tope de descuento inválido.";

  const dias = parseNumeroCampo(valores.dias_vigencia_descuento);
  if (!Number.isInteger(dias) || dias <= 0) errores.dias_vigencia_descuento = "Días de vigencia inválidos.";

  return errores;
}

/** Convierte YYYY-MM-DD del input a ISO (fin del día local). */
export function bloqueoAtDesdeInputFecha(fecha: string): string {
  if (!fecha.trim()) return "";
  const partes = fecha.split("-").map(Number);
  if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) return "";
  const [anio, mes, dia] = partes;
  return new Date(anio, mes - 1, dia, 23, 59, 59, 999).toISOString();
}

/** Valor para input type="date" desde ISO guardado. */
export function bloqueoAtParaInputFecha(iso: string): string {
  if (!iso.trim()) return "";
  return iso.slice(0, 10);
}

export function formatFechaBloqueo(iso: string): string {
  if (!iso.trim()) return "";
  try {
    return new Date(iso).toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function validarOfertaCartelera(oferta: OfertaCartelera): string | null {
  if (!oferta.descripcion.trim()) return "La descripción es obligatoria.";
  if (!oferta.bloqueo_at) return "Indica la fecha límite de bloqueo.";
  if (!Number.isFinite(Number(oferta.cuota))) return "La cuota debe ser un número válido.";
  return null;
}

export function validarCampanaFormulario(valores: CampanaPromocionalFormulario): ErroresCampanaFormulario {
  const errores = validarCampanaDatosBasicos(valores);

  if (!valores.cartelera_ofertas.length) {
    errores.cartelera = "Agrega al menos una oferta a la cartelera.";
  } else {
    const invalida = valores.cartelera_ofertas.find(
      (o) => validarOfertaCartelera(o) !== null || !o.id_oferta.trim(),
    );
    if (invalida) errores.cartelera = "Cada oferta requiere descripción, fecha de bloqueo y cuota.";
  }

  return errores;
}

export function prepararActualizacionDatosBasicos(valores: CampanaDatosBasicosFormulario) {
  return {
    titulo: valores.titulo.trim(),
    consumo_minimo: parseNumeroCampo(valores.consumo_minimo),
    porcentaje_descuento: parseNumeroCampo(valores.porcentaje_descuento),
    descuento_maximo: parseNumeroCampo(valores.descuento_maximo),
    dias_vigencia_descuento: Math.trunc(parseNumeroCampo(valores.dias_vigencia_descuento)),
    activa: valores.activa,
  };
}

export function prepararCampanaBasicaParaGuardar(valores: CampanaDatosBasicosFormulario) {
  return {
    ...prepararActualizacionDatosBasicos(valores),
    cartelera_ofertas: [] as OfertaCartelera[],
    ofertas_cumplidas: [] as string[],
  };
}

export function campanaFormularioEsValido(errores: ErroresCampanaFormulario): boolean {
  return Object.keys(errores).length === 0;
}

export function prepararCampanaParaGuardar(valores: CampanaPromocionalFormulario) {
  return {
    titulo: valores.titulo.trim(),
    consumo_minimo: Number(valores.consumo_minimo),
    porcentaje_descuento: Number(valores.porcentaje_descuento),
    descuento_maximo: Number(valores.descuento_maximo),
    dias_vigencia_descuento: Math.trunc(Number(valores.dias_vigencia_descuento)),
    activa: valores.activa,
    cartelera_ofertas: valores.cartelera_ofertas.map((o) => prepararOfertaParaGuardar(o)),
    ofertas_cumplidas: [] as string[],
  };
}
