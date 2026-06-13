export type ResultadoOferta = "PENDIENTE" | "GANADA" | "PERDIDA";

export const RESULTADO_OFERTA_OPCIONES: { value: ResultadoOferta; label: string }[] = [
  { value: "PENDIENTE", label: "Pendiente" },
  { value: "GANADA", label: "Ganadora" },
  { value: "PERDIDA", label: "Perdedora" },
];

/** Opción de la cartelera de una campaña. */
export interface OfertaCartelera {
  id_oferta: string;
  descripcion: string;
  inicio_at?: string;
  bloqueo_at: string;
  cuota: number;
  resultado?: ResultadoOferta;
  tipo_oferta?: "RESULTADO" | "MARCADOR";
  marcador_final_local?: number | null;
  marcador_final_visitante?: number | null;
}

export type EstadoPrediccion = "PENDIENTE" | "GANADA" | "PERDIDA";

export interface CampanaPromocional {
  id: string;
  titulo: string;
  consumo_minimo: number;
  porcentaje_descuento: number;
  descuento_maximo: number;
  dias_vigencia_descuento: number;
  cartelera_ofertas: OfertaCartelera[];
  ofertas_cumplidas: string[];
  activa: boolean;
  creado_el: string;
}

export interface CampanaPromocionalFormulario {
  titulo: string;
  consumo_minimo: string;
  porcentaje_descuento: string;
  descuento_maximo: string;
  dias_vigencia_descuento: string;
  activa: boolean;
  cartelera_ofertas: OfertaCartelera[];
}

export const CAMPANA_FORMULARIO_VACIO: CampanaPromocionalFormulario = {
  titulo: "",
  consumo_minimo: "",
  porcentaje_descuento: "",
  descuento_maximo: "",
  dias_vigencia_descuento: "",
  activa: true,
  cartelera_ofertas: [],
};

export interface PrediccionCliente {
  id: string;
  campana_id: string;
  orden_id: string;
  cliente_id: string;
  oferta_seleccionada_id: string;
  estado_prediccion: EstadoPrediccion;
  prediccion_marcador_local: number | null;
  prediccion_marcador_visitante: number | null;
  monto_descuento_ganado: number | null;
  codigo_cupon: string | null;
  cupon_usado_el: string | null;
  fecha_caducidad_cupon: string | null;
  registrado_por: string | null;
  creado_el: string;
}

export interface OrdenElegiblePromocion {
  id: string;
  order_number: number | null;
  order_code: string | null;
  order_type: string;
  total: number;
  cliente_id: string | null;
  cliente?: {
    id: string;
    cedula: string;
    nombres: string;
    apellidos: string;
  } | null;
}
