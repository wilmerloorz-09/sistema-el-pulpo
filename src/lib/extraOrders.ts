import { supabase } from "@/integrations/supabase/client";
import { isExtraOrder } from "@/lib/orderFlow";

export interface ExtraOrderCardRow {
  id: string;
  status?: string | null;
  closed_at?: string | null;
  item_count?: number;
}

/** Tarjeta visible en modulo Extra (solo ordenes propias del usuario, no cerradas). */
export function extraOrderShowsOnExtraHome(order: ExtraOrderCardRow): boolean {
  if (order.closed_at) return false;
  const status = String(order.status ?? "");
  if (status === "CANCELLED") return false;
  if (status === "DRAFT") return Number(order.item_count ?? 0) > 0;
  return ["SENT_TO_KITCHEN", "READY", "PAID"].includes(status);
}

export function extraOrderCanCloseFromHome(status: string | null | undefined): boolean {
  return String(status ?? "") === "KITCHEN_DISPATCHED";
}

function isMissingCloseExtraRpc(error: { code?: string; message?: string } | null | undefined) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "PGRST202"
    || message.includes("close_extra_order")
    || message.includes("could not find the function")
  );
}

export function getExtraOrderCloseErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message ?? "No se pudo cerrar la orden");
  }
  if (error instanceof Error) return error.message;
  return "No se pudo cerrar la orden";
}

export async function closeExtraOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc("close_extra_order" as any, {
    p_order_id: orderId,
  } as any);

  if (!error) return;

  if (isMissingCloseExtraRpc(error)) {
    throw new Error(
      "Falta aplicar la migracion close_extra_order en Supabase (20260602130000_close_extra_order.sql).",
    );
  }

  throw error;
}

export function extraOrderStatusBadgeLabel(status: string | null | undefined): string | null {
  switch (String(status ?? "")) {
    case "DRAFT":
      return "Borrador";
    case "SENT_TO_KITCHEN":
      return "En caja";
    case "READY":
      return "Lista despacho";
    case "PAID":
      return "Pagada";
    case "KITCHEN_DISPATCHED":
      return "Despachada";
    default:
      return null;
  }
}

export interface ExtraCajaVisibilityScope {
  userId: string;
  primaryCashierId: string | null;
}

/**
 * @deprecated La visibilidad de Extra en Recaudar se controla con el combo de alcance
 * (`cajaPayableOrderScope`). Mantenido por compatibilidad con llamadas legacy.
 */
export function extraOrderVisibleInCaja(
  order: {
    order_type?: string | null;
    created_by?: string | null;
    is_tray_order?: boolean | null;
    is_special?: boolean | null;
  },
  scope: ExtraCajaVisibilityScope,
): boolean {
  if (!isExtraOrder(order)) return true;
  if (!scope.userId) return false;
  return order.created_by === scope.userId || scope.userId === scope.primaryCashierId;
}

/** Cualquier cajero con turno abierto puede cobrar Extra visible en su lista. */
export function canUserPayExtraOrder(
  _order: {
    order_type?: string | null;
    created_by?: string | null;
    is_tray_order?: boolean | null;
    is_special?: boolean | null;
  },
  _scope: ExtraCajaVisibilityScope,
): boolean {
  return true;
}
