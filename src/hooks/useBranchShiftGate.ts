import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { canManage } from "@/lib/permissions";
import { usuarioPuedeRegistrarPromociones } from "@/services/prediccionesClientesDb";
import {
  SHIFT_GATE_BACKUP_POLL_MS,
  SHIFT_GATE_STALE_MS,
  useAdaptiveRefetchInterval,
  useOperationalOrdersRealtime,
} from "@/lib/queryEgress";
import { qk } from "@/lib/queryKeys";

export const TAB_SESSION_ID = crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36);

/**
 * El permiso de promociones se asigna al abrir turno y no cambia dentro de el,
 * pero el gate corre en cada tablet. Cachearlo por turno evita repetir la misma
 * consulta; no bloquea el path crítico del login.
 */
const PROMO_PERMISSION_TTL_MS = 5 * 60 * 1000;
const promoPermissionCache = new Map<string, { value: boolean; expiresAt: number }>();

async function leerPuedeRegistrarPromociones(userId: string, shiftId: string): Promise<boolean> {
  const cacheKey = `${userId}:${shiftId}`;
  const cached = promoPermissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = await usuarioPuedeRegistrarPromociones();
  promoPermissionCache.set(cacheKey, { value, expiresAt: Date.now() + PROMO_PERMISSION_TTL_MS });
  return value;
}

export interface BranchShiftGate {
  shiftId: string | null;
  shiftOpen: boolean;
  /** Apertura del turno OPEN (para filtrar órdenes del turno). */
  openedAt: string | null;
  userEnabled: boolean;
  lastSessionId: string | null;
  secondarySessionId: string | null;
  /** IDs de navegador con sesión de Caja activa para el usuario actual. */
  cajaSessionSlots: string[];
  /** Máximo de terminales Caja simultáneos configurado en Admin > Turno. */
  maxCajaSessions: number;
  /** Suma de sesiones activas (todas las terminales) en el turno abierto. */
  globalCajaSessionsUsed: number;
  tabSessionId: string;
  cashierId: string | null;
  captureUserId: string | null;
  activeTablesCount: number;
  cajaStatus: "UNOPENED" | "OPEN" | "CLOSED";
  canServeTables: boolean;
  canAccessOrders: boolean;
  canEditOrders: boolean;
  canDispatchOrders: boolean;
  canManageProducts: boolean;
  canUseCaja: boolean;
  /** Cajero principal del turno (caja principal). */
  primaryCashierId: string | null;
  /** Usuario actual es cajero secundario (tiene caja y no es el principal). */
  isSecondaryCashier: boolean;
  /** Cajero secundario: puede cobrar sus TAKEOUT propias. */
  secondaryCajaTakeoutEnabled: boolean;
  /** Cajero secundario: puede cobrar sus EXPRESS propias. */
  secondaryCajaExpressEnabled: boolean;
  canServePlates: boolean;
  canPackOrders: boolean;
  canAuthorizeOrderCancel: boolean;
  canDoubleSession: boolean;
  isSupervisor: boolean;
  isCaptureDeviceOnly: boolean;
  legacyFallbackApplied: boolean;
  isStaleShift: boolean;
  puedeRegistrarPromociones: boolean;
}

type GateRpcRow = {
  shift_id?: string | null;
  shift_open?: boolean | null;
  user_enabled?: boolean | null;
  active_tables_count?: number | null;
  caja_status?: string | null;
  can_serve_tables?: boolean | null;
  can_access_orders?: boolean | null;
  can_edit_orders?: boolean | null;
  can_dispatch_orders?: boolean | null;
  can_manage_products?: boolean | null;
  can_use_caja?: boolean | null;
  can_pack_orders?: boolean | null;
  can_serve_plates?: boolean | null;
  can_authorize_order_cancel?: boolean | null;
  can_double_session?: boolean | null;
  is_supervisor?: boolean | null;
  cashier_id?: string | null;
  capture_user_id?: string | null;
  primary_cashier_id?: string | null;
  opened_at?: string | null;
  is_stale_shift?: boolean | null;
  last_session_id?: string | null;
  secondary_session_id?: string | null;
  caja_session_slots?: string[] | null;
  secondary_caja_takeout_enabled?: boolean | null;
  secondary_caja_express_enabled?: boolean | null;
  is_secondary_cashier?: boolean | null;
  max_caja_sessions?: number | null;
  global_caja_sessions_used?: number | null;
  legacy_fallback_applied?: boolean | null;
};

function mapGateRow(
  row: GateRpcRow | null | undefined,
  opts?: { forceAdminOpen?: boolean; puedeRegistrarPromociones?: boolean },
): BranchShiftGate {
  const shiftId = row?.shift_id ?? null;
  const slots = Array.isArray(row?.caja_session_slots)
    ? row!.caja_session_slots!.filter((s) => Boolean(s && String(s).trim()))
    : [];
  const cajaSessionSlots =
    slots.length > 0
      ? slots
      : [row?.last_session_id, row?.secondary_session_id].filter(
          (s): s is string => Boolean(s && String(s).trim()),
        );

  const base: BranchShiftGate = {
    shiftId,
    shiftOpen: Boolean(row?.shift_open),
    openedAt: row?.opened_at ?? null,
    userEnabled: Boolean(row?.user_enabled),
    lastSessionId: row?.last_session_id ?? null,
    secondarySessionId: row?.secondary_session_id ?? null,
    cajaSessionSlots,
    maxCajaSessions: Math.max(1, Math.min(10, Number(row?.max_caja_sessions ?? 1))),
    globalCajaSessionsUsed: Math.max(0, Number(row?.global_caja_sessions_used ?? 0)),
    tabSessionId: TAB_SESSION_ID,
    cashierId: row?.cashier_id ?? null,
    captureUserId: row?.capture_user_id ?? null,
    activeTablesCount: Number(row?.active_tables_count ?? 0),
    cajaStatus: (row?.caja_status as BranchShiftGate["cajaStatus"]) ?? "UNOPENED",
    canServeTables: Boolean(row?.can_serve_tables),
    canAccessOrders: Boolean(row?.can_access_orders ?? row?.can_serve_tables),
    canEditOrders: Boolean(row?.can_edit_orders),
    canDispatchOrders: Boolean(row?.can_dispatch_orders),
    canManageProducts: Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
    canUseCaja: Boolean(row?.can_use_caja),
    primaryCashierId: row?.primary_cashier_id ?? null,
    isSecondaryCashier: Boolean(row?.is_secondary_cashier),
    secondaryCajaTakeoutEnabled: Boolean(row?.secondary_caja_takeout_enabled),
    secondaryCajaExpressEnabled: Boolean(row?.secondary_caja_express_enabled),
    canServePlates: Boolean(row?.can_serve_plates),
    canPackOrders: Boolean(row?.can_pack_orders),
    canAuthorizeOrderCancel: Boolean(row?.can_authorize_order_cancel),
    canDoubleSession: Boolean(row?.can_double_session),
    isSupervisor: Boolean(row?.is_supervisor),
    isCaptureDeviceOnly: false,
    legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
    isStaleShift: Boolean(row?.is_stale_shift),
    puedeRegistrarPromociones: Boolean(opts?.puedeRegistrarPromociones),
  };

  if (opts?.forceAdminOpen && base.shiftOpen) {
    return {
      ...base,
      userEnabled: true,
      canServeTables: true,
      canAccessOrders: true,
      canEditOrders: true,
      canDispatchOrders: true,
      canManageProducts: true,
      canUseCaja: true,
      canServePlates: true,
      canPackOrders: true,
      canAuthorizeOrderCancel: true,
      canDoubleSession: true,
      isSupervisor: true,
      isSecondaryCashier: false,
      secondaryCajaTakeoutEnabled: false,
      secondaryCajaExpressEnabled: false,
      puedeRegistrarPromociones: true,
    };
  }

  return base;
}

export function useBranchShiftGate() {
  const { activeBranchId, permissions, isGlobalAdmin } = useBranch();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isBranchAdmin =
    Boolean(isGlobalAdmin)
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");

  const adaptiveGatePoll = useAdaptiveRefetchInterval(
    activeBranchId,
    SHIFT_GATE_BACKUP_POLL_MS,
    Boolean(activeBranchId && user?.id),
    0, // gate: sin safety poll con hub sano
  );

  const query = useQuery({
    queryKey: [qk.branchShiftGate[0], activeBranchId, user?.id ?? null, isBranchAdmin],
    queryFn: async (): Promise<BranchShiftGate> => {
      if (!activeBranchId || !user?.id) {
        return mapGateRow(null);
      }

      const runQuery = async (): Promise<BranchShiftGate> => {
        // Preferir v2 unificada (CREATE sin DROP, segura bajo carga).
        // Si no existe aún, caer a v1 + enriquecimiento paralelo.
        let row: GateRpcRow | null = null;
        let usedV2 = false;

        const v2 = await supabase.rpc("get_my_branch_shift_gate_v2" as any, {
          p_branch_id: activeBranchId,
        } as any);

        if (!v2.error) {
          row = (Array.isArray(v2.data) ? v2.data[0] : v2.data) as GateRpcRow | null;
          usedV2 = true;
        } else {
          const v1 = await supabase.rpc("get_my_branch_shift_gate" as any, {
            p_branch_id: activeBranchId,
          } as any);
          if (v1.error) throw v1.error;
          row = (Array.isArray(v1.data) ? v1.data[0] : v1.data) as GateRpcRow | null;
        }

        const shiftId = row?.shift_id ?? null;
        const isUnified =
          usedV2
          || Boolean(row && Object.prototype.hasOwnProperty.call(row, "max_caja_sessions"));

        let enriched: GateRpcRow | null = row;

        if (!isUnified && shiftId) {
          const [metaRes, userRes, usageRes] = await Promise.all([
            supabase
              .from("cash_shifts" as any)
              .select("cashier_id, capture_user_id, opened_at, primary_cashier_id")
              .eq("id", shiftId)
              .maybeSingle() as any,
            isBranchAdmin
              ? Promise.resolve({ data: null, error: null })
              : (supabase
                  .from("cash_shift_users" as any)
                  .select(
                    "is_enabled, can_serve_tables, can_access_orders, can_edit_orders, can_dispatch_orders, can_manage_products, can_use_caja, can_pack_orders, can_authorize_order_cancel, is_supervisor, can_double_session, last_session_id, secondary_session_id, caja_session_slots, secondary_caja_takeout_enabled, secondary_caja_express_enabled, can_serve_plates",
                  )
                  .eq("shift_id", shiftId)
                  .eq("user_id", user.id)
                  .maybeSingle() as any),
            supabase.rpc("get_caja_shift_terminal_usage", {
              p_branch_id: activeBranchId,
            } as any),
          ]);

          if (metaRes.error) throw metaRes.error;
          if (userRes.error) throw userRes.error;

          const meta = metaRes.data as Record<string, unknown> | null;
          const userRow = userRes.data as Record<string, unknown> | null;
          const usageRow = Array.isArray(usageRes.data) ? usageRes.data[0] : usageRes.data;
          const openedAt = meta?.opened_at ? new Date(String(meta.opened_at)) : null;
          const today = new Date();
          const isStale = openedAt
            ? openedAt.getFullYear() !== today.getFullYear()
              || openedAt.getMonth() !== today.getMonth()
              || openedAt.getDate() !== today.getDate()
            : false;

          const primaryCashierId = (meta?.primary_cashier_id as string | null) ?? null;
          const directEnabled = Boolean(userRow?.is_enabled);
          const canUseCaja =
            Boolean(userRow?.can_use_caja)
            || Boolean(row?.can_use_caja)
            || (Boolean(primaryCashierId) && primaryCashierId === user.id && directEnabled);
          const isSecondary =
            canUseCaja && Boolean(primaryCashierId) && primaryCashierId !== user.id;

          enriched = {
            ...row,
            can_edit_orders: Boolean(userRow?.can_edit_orders ?? row?.can_edit_orders),
            can_pack_orders: Boolean(userRow?.can_pack_orders),
            can_serve_plates: Boolean(userRow?.can_serve_plates),
            can_double_session: Boolean(userRow?.can_double_session),
            can_serve_tables: Boolean(userRow?.can_serve_tables ?? row?.can_serve_tables),
            can_access_orders: Boolean(
              userRow?.can_access_orders ?? userRow?.can_serve_tables ?? row?.can_access_orders,
            ),
            can_dispatch_orders: Boolean(userRow?.can_dispatch_orders ?? row?.can_dispatch_orders),
            can_manage_products: Boolean(
              userRow?.can_manage_products ?? userRow?.can_dispatch_orders ?? row?.can_manage_products,
            ),
            can_use_caja: canUseCaja,
            can_authorize_order_cancel: Boolean(
              userRow?.can_authorize_order_cancel ?? row?.can_authorize_order_cancel,
            ),
            is_supervisor: Boolean(userRow?.is_supervisor ?? row?.is_supervisor),
            user_enabled: userRow != null ? directEnabled : Boolean(row?.user_enabled),
            cashier_id: (meta?.cashier_id as string | null) ?? null,
            capture_user_id: (meta?.capture_user_id as string | null) ?? null,
            primary_cashier_id: primaryCashierId,
            opened_at: meta?.opened_at ? String(meta.opened_at) : null,
            is_stale_shift: isStale,
            last_session_id: (userRow?.last_session_id as string | null) ?? null,
            secondary_session_id: (userRow?.secondary_session_id as string | null) ?? null,
            caja_session_slots: Array.isArray(userRow?.caja_session_slots)
              ? (userRow!.caja_session_slots as string[])
              : [],
            secondary_caja_takeout_enabled: isSecondary
              ? Boolean(userRow?.secondary_caja_takeout_enabled)
              : false,
            secondary_caja_express_enabled: isSecondary
              ? Boolean(userRow?.secondary_caja_express_enabled)
              : false,
            is_secondary_cashier: isSecondary,
            max_caja_sessions: Math.max(1, Math.min(10, Number(usageRow?.shift_max ?? 1))),
            global_caja_sessions_used: Math.max(0, Number(usageRow?.global_sessions_used ?? 0)),
            legacy_fallback_applied: true,
          };
        }

        let puedeRegistrarPromociones = false;
        if (shiftId) {
          const promoCacheKey = `${user.id}:${shiftId}`;
          puedeRegistrarPromociones = promoPermissionCache.get(promoCacheKey)?.value ?? false;
          void leerPuedeRegistrarPromociones(user.id, shiftId).catch(() => undefined);
        }

        return mapGateRow(enriched, {
          forceAdminOpen: isBranchAdmin,
          puedeRegistrarPromociones: isBranchAdmin ? true : puedeRegistrarPromociones,
        });
      };

      try {
        return await Promise.race([
          runQuery(),
          new Promise<BranchShiftGate>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout de turno")), 8_000)
          ),
        ]);
      } catch (err) {
        console.warn(
          "[useBranchShiftGate] Query timed out or failed. Re-throwing so React Query keeps cached data:",
          err,
        );
        throw err;
      }
    },
    enabled: !!activeBranchId && !!user?.id,
    staleTime: SHIFT_GATE_STALE_MS,
    refetchInterval: adaptiveGatePoll,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    retry: 1,
    retryDelay: 800,
  });

  useOperationalOrdersRealtime({
    branchId: activeBranchId,
    queryClient: qc,
    channelPrefix: "branch-shift-gate-rt",
    enabled: Boolean(activeBranchId && user?.id),
    queryKeys: [qk.branchShiftGate, qk.currentShift, qk.openCashShift],
    includeShiftGate: true,
    shiftId: query.data?.shiftId ?? null,
  });

  return query;
}
