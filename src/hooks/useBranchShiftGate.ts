import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { isMissingColumnError } from "@/lib/supabaseSchemaCompat";
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
 * pero el gate corre cada pocos segundos en cada tablet. Cachearlo por turno
 * evita repetir la misma consulta cientos de miles de veces al dia.
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
    0, // gate: sin safety poll con hub sano (mismo comportamiento previo)
  );

  const query = useQuery({
    queryKey: [qk.branchShiftGate[0], activeBranchId, user?.id ?? null, isBranchAdmin],
    queryFn: async (): Promise<BranchShiftGate> => {
      const defaultValue: BranchShiftGate = {
        shiftId: null,
        shiftOpen: true,
        userEnabled: true,
        lastSessionId: null,
        secondarySessionId: null,
        cajaSessionSlots: [],
        maxCajaSessions: 99,
        globalCajaSessionsUsed: 0,
        tabSessionId: TAB_SESSION_ID,
        cashierId: null,
        captureUserId: null,
        activeTablesCount: 0,
        cajaStatus: "OPEN",
        canServeTables: true,
        canAccessOrders: true,
        canEditOrders: true,
        canDispatchOrders: true,
        canManageProducts: true,
        canUseCaja: true,
        primaryCashierId: null,
        isSecondaryCashier: false,
        secondaryCajaTakeoutEnabled: true,
        secondaryCajaExpressEnabled: true,
        canServePlates: true,
        canPackOrders: true,
        canAuthorizeOrderCancel: true,
        canDoubleSession: true,
        isSupervisor: true,
        isCaptureDeviceOnly: false,
        legacyFallbackApplied: true,
        isStaleShift: false,
        puedeRegistrarPromociones: true,
      };

      if (!activeBranchId || !user?.id) {
        return {
          ...defaultValue,
          shiftOpen: false,
          userEnabled: false,
          cajaStatus: "UNOPENED",
          canServeTables: false,
          canAccessOrders: false,
          canEditOrders: false,
          canDispatchOrders: false,
          canManageProducts: false,
          canUseCaja: false,
          secondaryCajaTakeoutEnabled: false,
          secondaryCajaExpressEnabled: false,
          canServePlates: false,
          canPackOrders: false,
          canAuthorizeOrderCancel: false,
          canDoubleSession: false,
          isSupervisor: false,
          puedeRegistrarPromociones: false,
        };
      }

      const runQuery = async (): Promise<BranchShiftGate> => {

      const { data, error } = await supabase.rpc("get_my_branch_shift_gate" as any, {
        p_branch_id: activeBranchId,
      } as any);
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      const shiftId = row?.shift_id ?? null;

      if (!shiftId) {
        return {
          shiftId: null,
          shiftOpen: Boolean(row?.shift_open),
          userEnabled: Boolean(row?.user_enabled),
          lastSessionId: null,
          secondarySessionId: null,
          cajaSessionSlots: [],
          maxCajaSessions: 1,
          globalCajaSessionsUsed: 0,
          tabSessionId: TAB_SESSION_ID,
          cashierId: null,
          captureUserId: null,
          activeTablesCount: Number(row?.active_tables_count ?? 0),
          cajaStatus: row?.caja_status ?? "UNOPENED",
          canServeTables: Boolean(row?.can_serve_tables),
          canAccessOrders: Boolean(row?.can_access_orders ?? row?.can_serve_tables),
          canEditOrders: Boolean(row?.can_edit_orders),
          canDispatchOrders: Boolean(row?.can_dispatch_orders),
          canManageProducts: Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
          canUseCaja: Boolean(row?.can_use_caja),
          primaryCashierId: null,
          isSecondaryCashier: false,
          secondaryCajaTakeoutEnabled: false,
          secondaryCajaExpressEnabled: false,
          canServePlates: false,
          canPackOrders: false,
          canAuthorizeOrderCancel: Boolean(row?.can_authorize_order_cancel),
          canDoubleSession: Boolean(row?.can_double_session),
          isSupervisor: Boolean(row?.is_supervisor),
          isCaptureDeviceOnly: false,
          legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
          isStaleShift: false,
          puedeRegistrarPromociones: false,
        };
      }

      const shiftUserSelectBase =
        "is_enabled, can_serve_tables, can_access_orders, can_edit_orders, can_dispatch_orders, can_manage_products, can_use_caja, can_pack_orders, can_authorize_order_cancel, is_supervisor, can_double_session, last_session_id, secondary_session_id, caja_session_slots";
      const shiftUserSelectExtended = `${shiftUserSelectBase}, secondary_caja_takeout_enabled, secondary_caja_express_enabled, can_serve_plates`;

      // Paralelo: meta + usuario + usage (antes era waterfall serial → login lento).
      // Admin: no necesita cash_shift_users (bypass de roles).
      // Promociones: no bloquear el gate (nav de promos desactivado; cache async).
      const shiftMetaPromise = (supabase
        .from("cash_shifts" as any)
        .select("cashier_id, capture_user_id, opened_at, primary_cashier_id")
        .eq("id", shiftId)
        .maybeSingle() as any);

      const shiftUserPromise = isBranchAdmin
        ? Promise.resolve({ data: null, error: null })
        : (supabase
            .from("cash_shift_users" as any)
            .select(shiftUserSelectExtended)
            .eq("shift_id", shiftId)
            .eq("user_id", user.id)
            .maybeSingle() as any);

      const usagePromise = supabase.rpc("get_caja_shift_terminal_usage", {
        p_branch_id: activeBranchId,
      } as any);

      const [shiftMetaResult, shiftUserFirst, usageResult] = await Promise.all([
        shiftMetaPromise,
        shiftUserPromise,
        usagePromise,
      ]);

      if (shiftMetaResult.error) throw shiftMetaResult.error;
      const shiftMetaRow = shiftMetaResult.data;

      let shiftUserRow: Record<string, unknown> | null = null;
      if (!isBranchAdmin) {
        if (shiftUserFirst.error && isMissingColumnError(shiftUserFirst.error)) {
          const baseShiftUserResult = await (supabase
            .from("cash_shift_users" as any)
            .select(shiftUserSelectBase)
            .eq("shift_id", shiftId)
            .eq("user_id", user.id)
            .maybeSingle() as any);
          if (baseShiftUserResult.error) throw baseShiftUserResult.error;
          shiftUserRow = baseShiftUserResult.data ?? null;
        } else {
          if (shiftUserFirst.error) throw shiftUserFirst.error;
          shiftUserRow = shiftUserFirst.data ?? null;
        }
      }

      const openedDate = shiftMetaRow?.opened_at ? new Date(shiftMetaRow.opened_at) : null;
      const today = new Date();
      const isStaleShift = openedDate
        ? (openedDate.getFullYear() !== today.getFullYear() ||
           openedDate.getMonth() !== today.getMonth() ||
           openedDate.getDate() !== today.getDate())
        : false;

      const directUserEnabled = Boolean(shiftUserRow?.is_enabled);
      const hasDirectShiftRow = shiftUserRow != null;
      const primaryCashierId = (shiftMetaRow?.primary_cashier_id as string | null) ?? null;
      const isPrimaryCashierForShift =
        Boolean(primaryCashierId) && primaryCashierId === user.id && directUserEnabled;
      const resolvedCanUseCaja = hasDirectShiftRow
        ? Boolean(shiftUserRow?.can_use_caja) || isPrimaryCashierForShift
        : Boolean(row?.can_use_caja) || isPrimaryCashierForShift;
      const isSecondaryCashier =
        resolvedCanUseCaja
        && Boolean(primaryCashierId)
        && primaryCashierId !== user.id;
      const cashierId = shiftMetaRow?.cashier_id ?? null;
      const captureUserId = shiftMetaRow?.capture_user_id ?? null;

      let globalCajaSessionsUsed = 0;
      let maxCajaSessions = 1;
      const usageError = usageResult.error;
      const usageRows = usageResult.data;
      if (!usageError && Array.isArray(usageRows) && usageRows.length > 0) {
        const usageRow = usageRows[0] as { global_sessions_used?: number; shift_max?: number };
        globalCajaSessionsUsed = Math.max(0, Number(usageRow?.global_sessions_used ?? 0));
        maxCajaSessions = Math.max(1, Math.min(10, Number(usageRow?.shift_max ?? 1)));
      }

      const slotsFromRow = Array.isArray(shiftUserRow?.caja_session_slots)
        ? (shiftUserRow!.caja_session_slots as string[]).filter((s) => Boolean(s && String(s).trim()))
        : [];
      const cajaSessionSlots =
        slotsFromRow.length > 0
          ? slotsFromRow
          : [shiftUserRow?.last_session_id, shiftUserRow?.secondary_session_id].filter(
              (s): s is string => Boolean(s && String(s).trim()),
            );

      // No await: no retrasar login/home por permisos de promociones.
      const promoCacheKey = `${user.id}:${shiftId}`;
      const promoCached = promoPermissionCache.get(promoCacheKey);
      const puedeRegistrarPromociones = promoCached?.value ?? false;
      void leerPuedeRegistrarPromociones(user.id, shiftId).catch(() => undefined);

      const gate: BranchShiftGate = {
        shiftId,
        shiftOpen: Boolean(row?.shift_open),
        userEnabled: hasDirectShiftRow ? directUserEnabled : Boolean(row?.user_enabled),
        lastSessionId: shiftUserRow?.last_session_id ?? null,
        secondarySessionId: shiftUserRow?.secondary_session_id ?? null,
        cajaSessionSlots,
        maxCajaSessions,
        globalCajaSessionsUsed,
        tabSessionId: TAB_SESSION_ID,
        cashierId,
        captureUserId,
        activeTablesCount: Number(row?.active_tables_count ?? 0),
        cajaStatus: row?.caja_status ?? "UNOPENED",
        canServeTables: hasDirectShiftRow ? Boolean(shiftUserRow?.can_serve_tables) : Boolean(row?.can_serve_tables),
        canAccessOrders: hasDirectShiftRow
          ? Boolean(shiftUserRow?.can_access_orders ?? shiftUserRow?.can_serve_tables)
          : Boolean(row?.can_access_orders ?? row?.can_serve_tables),
        canEditOrders: hasDirectShiftRow ? Boolean(shiftUserRow?.can_edit_orders) : Boolean(row?.can_edit_orders),
        canDispatchOrders: hasDirectShiftRow ? Boolean(shiftUserRow?.can_dispatch_orders) : Boolean(row?.can_dispatch_orders),
        canManageProducts: hasDirectShiftRow
          ? Boolean(shiftUserRow?.can_manage_products ?? shiftUserRow?.can_dispatch_orders)
          : Boolean(row?.can_manage_products ?? row?.can_dispatch_orders),
        canUseCaja: resolvedCanUseCaja,
        primaryCashierId,
        isSecondaryCashier,
        secondaryCajaTakeoutEnabled: isSecondaryCashier
          ? Boolean(shiftUserRow?.secondary_caja_takeout_enabled)
          : false,
        secondaryCajaExpressEnabled: isSecondaryCashier
          ? Boolean(shiftUserRow?.secondary_caja_express_enabled)
          : false,
        canServePlates: hasDirectShiftRow ? Boolean(shiftUserRow?.can_serve_plates) : false,
        canPackOrders: hasDirectShiftRow ? Boolean(shiftUserRow?.can_pack_orders) : false,
        canAuthorizeOrderCancel: hasDirectShiftRow ? Boolean(shiftUserRow?.can_authorize_order_cancel) : Boolean(row?.can_authorize_order_cancel),
        canDoubleSession: hasDirectShiftRow ? Boolean(shiftUserRow?.can_double_session) : Boolean(row?.can_double_session),
        isSupervisor: hasDirectShiftRow ? Boolean(shiftUserRow?.is_supervisor) : Boolean(row?.is_supervisor),
        isCaptureDeviceOnly: false,
        legacyFallbackApplied: Boolean(row?.legacy_fallback_applied),
        isStaleShift,
        puedeRegistrarPromociones,
      };

      // Admin: no depender de cash_shift_users (la lectura directa puede pisar la RPC).
      if (isBranchAdmin && gate.shiftOpen) {
        return {
          ...gate,
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

      return gate;
    };

    try {
      // 12s con lecturas en paralelo (antes 15s serial).
      const resolved = await Promise.race([
        runQuery(),
        new Promise<BranchShiftGate>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout de turno")), 12_000)
        ),
      ]);
      return resolved;
    } catch (err) {
      // No devolver defaultValue (shiftId null): React Query lo trata como éxito,
      // pisa el caché y cambia las query keys de Despacho/Caja → listas vacías.
      // Al lanzar, keepPreviousData conserva el último gate válido.
      console.warn(
        "[useBranchShiftGate] Query timed out or failed. Re-throwing so React Query keeps cached data:",
        err,
      );
      throw err;
    }
  },
    enabled: !!activeBranchId && !!user?.id,
    staleTime: SHIFT_GATE_STALE_MS,
    // Realtime SUBSCRIBED → sin poll; si el hub cae → respaldo lento.
    refetchInterval: adaptiveGatePoll,
    refetchOnWindowFocus: false,
    // Conserva el gate previo mientras cambia sucursal/usuario o hay un refetch en curso.
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
