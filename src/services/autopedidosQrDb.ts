import { supabase } from "@/integrations/supabase/client";

export type ContextoTokenQr = {
  token_id: string;
  sucursal_id: string;
  sucursal_nombre: string;
  mesa_id: string;
  mesa_nombre: string;
  mesa_visual_order: number;
  turno_id: string;
  turno_abierto: boolean;
};

export type MenuNodeAutopedido = {
  id: string;
  branch_id: string;
  parent_id: string | null;
  name: string;
  qr_name: string | null;
  node_type: string;
  menu_scope: string;
  display_order: number;
  depth: number;
  price: number | null;
  image_url: string | null;
  icon: string | null;
  is_active: boolean;
  legacy_product_id: string | null;
  manual_price_enabled: boolean;
};

export type ModificadorAutopedido = {
  menu_node_id: string;
  modifier_id: string;
  display_order: number;
  modifier_name: string;
};

export type ClienteAutopedido = {
  id: string;
  cedula: string;
  sexo: string;
  nombres: string;
  apellidos: string;
  celular: string;
  correo: string | null;
};

export type TokenQrMesaGenerado = {
  token_id: string;
  mesa_id: string;
  mesa_nombre: string;
  mesa_visual_order: number;
  token_seguro: string;
  creado: boolean;
};

export type AutopedidoPendiente = {
  orden_id: string;
  mesa_id: string | null;
  mesa_nombre: string;
  mesa_visual_order: number;
  cliente_id: string | null;
  cliente_nombre: string | null;
  total: number;
  creado_en: string;
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
    item_note: string | null;
    modifiers: string[];
  }>;
};

export type ItemAutopedidoPayload = {
  menu_node_id: string;
  quantity: number;
  item_note?: string | null;
  unit_price?: number | null;
  modifier_ids?: string[];
};

function throwRpcError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function resolverContextoTokenQr(tokenSeguro: string): Promise<ContextoTokenQr> {
  const { data, error } = await supabase.rpc("resolver_contexto_token_qr_mesa" as any, {
    p_token_seguro: tokenSeguro,
  });
  if (error) throwRpcError(error, "No se pudo validar el código QR.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Código QR inválido o sin turno abierto.");
  return row as ContextoTokenQr;
}

export function nombreVisibleAutopedidoQr(node: Pick<MenuNodeAutopedido, "name" | "node_type" | "qr_name">): string {
  if (node.node_type === "product") {
    const qrName = node.qr_name?.trim();
    if (qrName) return qrName;
  }
  return node.name;
}

export async function obtenerMenuAutopedidoQr(tokenSeguro: string): Promise<MenuNodeAutopedido[]> {
  const { data, error } = await supabase.rpc("obtener_menu_autopedido_qr" as any, {
    p_token_seguro: tokenSeguro,
  });
  if (error) throwRpcError(error, "No se pudo cargar el menú.");
  return (data ?? []) as MenuNodeAutopedido[];
}

export async function obtenerModificadoresAutopedidoQr(
  tokenSeguro: string,
): Promise<ModificadorAutopedido[]> {
  const { data, error } = await supabase.rpc("obtener_modificadores_autopedido_qr" as any, {
    p_token_seguro: tokenSeguro,
  });
  if (error) throwRpcError(error, "No se pudieron cargar los modificadores.");
  return (data ?? []) as ModificadorAutopedido[];
}

export async function buscarClienteAutopedidoQr(
  tokenSeguro: string,
  cedula: string,
): Promise<ClienteAutopedido | null> {
  const { data, error } = await supabase.rpc("buscar_cliente_autopedido_qr" as any, {
    p_token_seguro: tokenSeguro,
    p_cedula: cedula,
  });
  if (error) throwRpcError(error, "No se pudo buscar el cliente.");
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ClienteAutopedido) ?? null;
}

export async function registrarClienteAutopedidoQr(params: {
  tokenSeguro: string;
  cedula: string;
  nombres: string;
  apellidos: string;
  celular: string;
  sexo: "M" | "F";
  correo?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("registrar_cliente_autopedido_qr" as any, {
    p_token_seguro: params.tokenSeguro,
    p_cedula: params.cedula,
    p_nombres: params.nombres,
    p_apellidos: params.apellidos,
    p_celular: params.celular,
    p_sexo: params.sexo,
    p_correo: params.correo ?? null,
  });
  if (error) throwRpcError(error, "No se pudo registrar el cliente.");
  return data as string;
}

export async function crearOrdenAutopedidoQr(params: {
  tokenSeguro: string;
  items: ItemAutopedidoPayload[];
  clienteId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("crear_orden_autopedido_qr" as any, {
    p_token_seguro: params.tokenSeguro,
    p_items: params.items,
    p_cliente_id: params.clienteId ?? null,
  });
  if (error) throwRpcError(error, "No se pudo enviar el pedido.");
  return data as string;
}

export async function generarTokensQrMesasSucursal(
  sucursalId: string,
  limite = 20,
): Promise<TokenQrMesaGenerado[]> {
  const { data, error } = await supabase.rpc("generar_tokens_qr_mesas_sucursal" as any, {
    p_sucursal_id: sucursalId,
    p_limite: limite,
  });
  if (error) throwRpcError(error, "No se pudieron generar los códigos QR.");
  return (data ?? []) as TokenQrMesaGenerado[];
}

export async function contarAutopedidosPendientes(sucursalId: string): Promise<number> {
  const { data, error } = await supabase.rpc("contar_autopedidos_pendientes" as any, {
    p_sucursal_id: sucursalId,
  });
  if (error) throwRpcError(error, "No se pudo contar autopedidos pendientes.");
  return Number(data ?? 0);
}

export async function listarAutopedidosPendientes(
  sucursalId: string,
): Promise<AutopedidoPendiente[]> {
  const { data, error } = await supabase.rpc("listar_autopedidos_pendientes" as any, {
    p_sucursal_id: sucursalId,
  });
  if (error) throwRpcError(error, "No se pudieron listar autopedidos pendientes.");
  return ((data ?? []) as AutopedidoPendiente[]).map((row) => ({
    ...row,
    items: Array.isArray(row.items) ? row.items : [],
  }));
}

export async function aprobarAutopedidoQr(ordenId: string): Promise<void> {
  const { error } = await supabase.rpc("aprobar_autopedido_qr" as any, {
    p_orden_id: ordenId,
  });
  if (error) throwRpcError(error, "No se pudo aprobar el autopedido.");
}

export async function rechazarAutopedidoQr(ordenId: string, motivo?: string): Promise<void> {
  const { error } = await supabase.rpc("rechazar_autopedido_qr" as any, {
    p_orden_id: ordenId,
    p_motivo: motivo ?? null,
  });
  if (error) throwRpcError(error, "No se pudo rechazar el autopedido.");
}

export function urlAutopedidoQr(tokenSeguro: string, origin = window.location.origin): string {
  return `${origin}/qr-pedido/${encodeURIComponent(tokenSeguro)}`;
}
