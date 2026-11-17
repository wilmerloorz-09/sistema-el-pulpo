export type Sucursal = {
  id: string;
  nombre: string;
  codigo: string | null;
};

export type OrdenAbierta = {
  id: string;
  codigo: string | null;
  tipo: string;
  estado: string;
  mesa: string | null;
  id_mesa: string | null;
  total: number;
  pagado: number;
  saldo: number;
  creada_en: string;
  cliente: string | null;
};

/** Orden/cuenta abierta vinculada a una mesa (split). */
export type OrdenEnMesa = {
  id: string;
  codigo: string | null;
  total: number;
  especial?: boolean;
};

/** Mesa física habilitada en la sucursal (misma fuente que /mesas del POS). */
export type MesaSucursal = {
  id: string;
  nombre: string;
  orden_visual: number;
  /** Misma semántica visual que Mesas POS: free / occupied / to_pay. */
  estado: "libre" | "ocupada" | "por_cobrar";
  id_orden_activa: string | null;
  total_pendiente: number;
  ordenes: OrdenEnMesa[];
  cantidad_ordenes: number;
  especial: boolean;
  creado_por: string | null;
};

export type ItemOrden = {
  id: string;
  descripcion: string;
  cantidad: number;
  precio: number;
  total: number;
  id_producto: string | null;
  creado_en?: string;
};

export type ProductoCatalogo = {
  id_producto: string;
  codigo_barras: string;
  nombre: string;
  precio: number;
};

export type OperacionActividad = {
  id: string;
  tipo: "agregar" | "deshacer";
  cantidad: number;
  monto: number | null;
  codigo_barras: string | null;
  fecha_registro: string;
  id_orden: string;
  descripcion: string | null;
  orden_codigo: string | null;
};

export type ResultadoAgregar = {
  id_operacion: string;
  duplicada?: boolean;
  id_orden: string;
  id_producto: string;
  descripcion: string;
  cantidad: number;
  monto: number;
  total_orden: number;
  pagado: number;
  saldo: number;
};
