import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dbSelect, supabase } from "@/services/DatabaseService";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  LayoutGrid,
  Loader2,
  Plus,
  PlayCircle,
  Power,
  Save,
  Truck,
  Trash2,
  Users,
  ReceiptText,
} from "lucide-react";
import {
  openCashClosureReportWindow,
  type CashShiftSnapshot,
  type CompletedPayment,
  type CashMovement,
  type MethodSummaryEntry,
} from "@/lib/cashReportUtils";
import { toast } from "sonner";
import { isMissingColumnError } from "@/lib/supabaseSchemaCompat";
import DispatchConfig from "@/components/admin/DispatchConfig";
import BranchCancelPolicyEditor, {
  type BranchCancelPolicyDraftRow,
} from "@/components/admin/BranchCancelPolicyEditor";
import ShiftCajaSetupSection, {
  type ShiftCajaSetupState,
  type ShiftCajaSetupUserOption,
} from "@/components/admin/ShiftCajaSetupSection";
import {
  EMPTY_CAJA_SETUP,
  buildCajaRpcPayload,
  buildCajaSetupIssues,
  cajaSetupSignature,
  countConfiguredShiftCashiers,
  formatCajaSetupSummary as formatCajaSetupSummaryText,
  mapPersistedCajaSetup,
  removeCashierFromSetup,
} from "@/lib/shiftCajaSetupModel";
import { invalidateOperationalOrderQueries } from "@/lib/queryEgress";
import { getUserAlias } from "@/lib/userDisplay";
import {
  useDispatchConfig,
  type DispatchAssignment,
  type DispatchConfig as DispatchConfigModel,
} from "@/hooks/useDispatchConfig";
import {
  fetchCashRegisterMovementsForShift,
  fetchCompletedPaymentsForShift,
  fetchShiftSnapshot,
} from "@/hooks/useCaja";

/** Ocultar editor de anulacion sin autorizacion en Turno (reactivar cuando se retome). */
const SHOW_SHIFT_CANCEL_POLICY_UI = false;

interface ShiftUserRow {
  user_id: string;
  full_name: string;
  username: string;
  alias?: string;
  is_profile_active: boolean;
  is_enabled: boolean;
  can_serve_tables: boolean;
  can_access_orders: boolean;
  can_edit_orders: boolean;
  can_dispatch_orders: boolean;
  can_manage_products: boolean;
  can_use_caja: boolean;
  can_authorize_order_cancel: boolean;
  can_double_session: boolean;
  is_supervisor: boolean;
  can_pack_orders: boolean;
  secondary_caja_takeout_enabled?: boolean;
  secondary_caja_express_enabled?: boolean;
  secondary_caja_template_id?: string | null;
  can_serve_plates?: boolean;
}

interface ZeroValueSpecialOrder {
  id: string;
  order_code: string | null;
  order_number: number | null;
  status: string;
  paid_at: string | null;
  special_total_manual: number | null;
  total: number | null;
}

const OPERATIVE_ROLE_KEYS: Array<
  keyof Pick<
    ShiftUserRow,
    | "can_serve_tables"
    | "can_access_orders"
    | "can_edit_orders"
    | "can_dispatch_orders"
    | "can_manage_products"
    | "can_authorize_order_cancel"
    | "is_supervisor"
    | "can_pack_orders"
    | "can_serve_plates"
  >
> = [
  "can_serve_tables",
  "can_access_orders",
  "can_dispatch_orders",
  "can_manage_products",
  "can_authorize_order_cancel",
  "is_supervisor",
  "can_pack_orders",
  "can_serve_plates",
];

function formatCajaSetupSummary(rows: ShiftUserRow[], setup: ShiftCajaSetupState) {
  const labelFor = (userId: string) => {
    const row = rows.find((item) => item.user_id === userId);
    return row?.full_name || getUserAlias(row) || "Usuario";
  };
  return formatCajaSetupSummaryText(labelFor, setup);
}

type ShiftUserRoleKey = keyof Pick<
  ShiftUserRow,
  | "can_serve_tables"
  | "can_access_orders"
  | "can_edit_orders"
  | "can_dispatch_orders"
  | "can_manage_products"
  | "can_use_caja"
  | "can_authorize_order_cancel"
  | "can_double_session"
  | "is_supervisor"
  | "can_pack_orders"
  | "can_serve_plates"
>;

function hasOperationalCapability(user: ShiftUserRow) {
  return OPERATIVE_ROLE_KEYS.some((key) => user[key]);
}

function normalizeShiftUser(
  user: ShiftUserRow,
  useFallbackServeRole: boolean,
): ShiftUserRow {
  const normalized: ShiftUserRow = {
    ...user,
    is_enabled: user.is_enabled ?? false,
    can_serve_tables: user.can_serve_tables ?? false,
    can_access_orders: user.can_access_orders ?? user.can_serve_tables ?? false,
    can_edit_orders: user.can_edit_orders ?? false,
    can_dispatch_orders: user.can_dispatch_orders ?? false,
    can_manage_products:
      user.can_manage_products ?? user.can_dispatch_orders ?? false,
    can_use_caja: user.can_use_caja ?? false,
    can_authorize_order_cancel: user.can_authorize_order_cancel ?? false,
    can_double_session: user.can_double_session ?? false,
    is_supervisor: user.is_supervisor ?? false,
    can_pack_orders: user.can_pack_orders ?? false,
    secondary_caja_takeout_enabled:
      user.secondary_caja_takeout_enabled ?? false,
    secondary_caja_express_enabled:
      user.secondary_caja_express_enabled ?? false,
    can_serve_plates: user.can_serve_plates ?? false,
  };

  if (useFallbackServeRole && !hasOperationalCapability(normalized)) {
    normalized.can_serve_tables = true;
    normalized.can_access_orders = true;
  }

  if (normalized.can_serve_tables) {
    normalized.can_access_orders = true;
  } else {
    normalized.can_access_orders = false;
  }

  if (normalized.can_dispatch_orders) {
    normalized.can_manage_products = true;
  }

  return normalized;
}

function sanitizeShiftUserCapability<
  T extends {
    isEnabled: boolean;
    canServeTables: boolean;
    canAccessOrders: boolean;
    canEditOrders: boolean;
    canDispatchOrders: boolean;
    canManageProducts: boolean;
    canUseCaja: boolean;
    canAuthorizeOrderCancel: boolean;
    canDoubleSession: boolean;
    isSupervisor: boolean;
    canPackOrders: boolean;
    canServePlates?: boolean;
  },
>(user: T): T {
  const normalizedUser = {
    ...user,
  };
  const hasOperationalRole =
    normalizedUser.canServeTables ||
    normalizedUser.canAccessOrders ||
    normalizedUser.canEditOrders ||
    normalizedUser.canDispatchOrders ||
    normalizedUser.canManageProducts ||
    normalizedUser.canUseCaja ||
    normalizedUser.canAuthorizeOrderCancel ||
    normalizedUser.isSupervisor ||
    normalizedUser.canPackOrders ||
    normalizedUser.canServePlates;

  if (!normalizedUser.isEnabled || hasOperationalRole) {
    return normalizedUser;
  }

  return {
    ...normalizedUser,
    isEnabled: false,
    canServeTables: false,
    canAccessOrders: false,
    canEditOrders: false,
    canDispatchOrders: false,
    canManageProducts: false,
    canUseCaja: false,
    canAuthorizeOrderCancel: false,
    canDoubleSession: false,
    isSupervisor: false,
    canPackOrders: false,
    canServePlates: false,
  };
}

function sameMembers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function shiftUserRolesSignature(rows: ShiftUserRow[]) {
  return JSON.stringify(
    rows
      .map((user) => ({
        user_id: user.user_id,
        can_serve_tables: user.can_serve_tables,
        can_access_orders: user.can_access_orders,
        can_edit_orders: user.can_edit_orders,
        can_dispatch_orders: user.can_dispatch_orders,
        can_manage_products: user.can_manage_products,
        can_authorize_order_cancel: user.can_authorize_order_cancel,
        can_double_session: user.can_double_session,
        is_supervisor: user.is_supervisor,
        can_pack_orders: user.can_pack_orders,
        can_serve_plates: user.can_serve_plates ?? false,
      }))
      .sort((a, b) => a.user_id.localeCompare(b.user_id)),
  );
}

function getCajaUserIds(rows: ShiftUserRow[]) {
  return rows
    .filter((row) => row.is_enabled !== false && row.can_use_caja)
    .map((row) => row.user_id)
    .sort();
}

function isMissingFunctionOrSchemaError(error: any, functionName?: string) {
  const message = String(error?.message ?? "");
  if (message.includes("schema cache")) return true;
  if (
    functionName &&
    message.includes(`Could not find the function public.${functionName}`)
  )
    return true;
  return false;
}

function isRecoverableCancelPolicyRpcError(error: any) {
  const message = String(error?.message ?? "");
  return (
    isMissingFunctionOrSchemaError(error, "save_branch_cancel_policy") ||
    message.includes(
      "El nodo indicado no es una categoria raiz valida para esta sucursal",
    )
  );
}

async function resolveFunctionInvokeError(err: any) {
  const context = err?.context;
  if (context && typeof context.text === "function") {
    try {
      const raw = await context.text();
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          return parsed?.error || raw;
        } catch {
          return raw;
        }
      }
    } catch {
      // ignore body parsing failures
    }
  }

  return err?.message || "No se pudo validar la contrasena";
}

function showShiftSetupError(
  error: any,
  setWarningDialog: React.Dispatch<
    React.SetStateAction<{ open: boolean; title: string; description: string }>
  >,
) {
  const rawMessage = String(error?.message ?? "").trim();

  if (
    rawMessage.startsWith("No puedes reducir a") &&
    rawMessage.includes("mesas sigan ocupadas:")
  ) {
    const [, tables] = rawMessage.split("mesas sigan ocupadas:");
    const occupiedTables = (tables ?? "").trim();
    setWarningDialog({
      open: true,
      title: "No se puede reducir el numero de mesas",
      description: occupiedTables
        ? `Las siguientes mesas aun no estan libres: ${occupiedTables}. Libera esas mesas primero y luego vuelve a intentarlo.`
        : "Todavia hay mesas ocupadas fuera del nuevo limite. Libera esas mesas primero y luego vuelve a intentarlo.",
    });
    return;
  }

  if (
    rawMessage.startsWith("No puedes cerrar el turno. Falta:")
    || rawMessage.startsWith("No puedes cerrar el turno porque aun existen ordenes o cobros pendientes")
    || rawMessage.startsWith("No puedes cerrar el turno porque la caja esta abierta")
  ) {
    const isDetailed = rawMessage.startsWith("No puedes cerrar el turno. Falta:");
    const legacyPending = rawMessage.startsWith(
      "No puedes cerrar el turno porque aun existen ordenes o cobros pendientes",
    );
    const detail = legacyPending
      ? rawMessage
          .replace(
            "No puedes cerrar el turno porque aun existen ordenes o cobros pendientes.",
            "",
          )
          .trim()
      : "";

    setWarningDialog({
      open: true,
      title: "No se puede cerrar el turno",
      description: isDetailed
        ? rawMessage
        : legacyPending
          ? (detail
            ? `Todavia quedan ordenes o cobros pendientes en esta sucursal.\n${detail}`
            : "Todavia quedan ordenes o cobros pendientes en esta sucursal. Finaliza o cobra esas ordenes primero.")
          : "La caja sigue abierta. Cierra la caja en el modulo Caja y luego vuelve a intentar cerrar el turno.",
    });
    return;
  }

  if (
    rawMessage.startsWith(
      "Ninguno de los usuarios del turno puede abrirse aqui porque ya estan en otro turno abierto",
    )
  ) {
    const detail = rawMessage
      .replace(
        "Ninguno de los usuarios del turno puede abrirse aqui porque ya estan en otro turno abierto:",
        "",
      )
      .trim();
    setWarningDialog({
      open: true,
      title: "Usuarios en otro turno abierto",
      description: detail
        ? `Estos usuarios ya estan habilitados en otro turno: ${detail}. Cierra ese turno o quitalos de la lista antes de abrir aqui.`
        : "Todos los usuarios seleccionados ya estan en otro turno abierto. Cierra ese turno o usa otros usuarios.",
    });
    return;
  }

  if (
    rawMessage.includes(
      "sin al menos un usuario habilitado con rol operativo disponible",
    )
  ) {
    setWarningDialog({
      open: true,
      title: "No se puede abrir el turno",
      description:
        "Ningun usuario cumple los requisitos para abrir turno (rol operativo activo y sin otro turno abierto). Revisa la lista o cierra turnos abiertos en otras sucursales.",
    });
    return;
  }

  if (
    /statement timeout|canceling statement due to statement timeout/i.test(
      rawMessage,
    )
  ) {
    setWarningDialog({
      open: true,
      title: "El cierre del turno tardo demasiado",
      description:
        "La base de datos cancelo la operacion por tiempo de espera. Suele ocurrir en sucursales con muchas ordenes del turno. Aplica la migracion de optimizacion de cierre de turno y vuelve a intentarlo. Si el error persiste, revisa ordenes pendientes en Caja/Despacho.",
    });
    return;
  }

  setWarningDialog({
    open: true,
    title: "Revisa la configuracion del turno",
    description:
      rawMessage ||
      "No se pudo guardar la configuracion del turno. Revisa los datos y vuelve a intentarlo.",
  });
}

function detectBrowserLabel(userAgent: string) {
  if (/edg/i.test(userAgent)) return "Edge";
  if (/opr|opera/i.test(userAgent)) return "Opera";
  if (/chrome|crios/i.test(userAgent)) return "Chrome";
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Navegador";
}

function buildClosureDeviceLabel() {
  if (typeof navigator === "undefined") return "Dispositivo no identificado";

  const userAgent = navigator.userAgent ?? "";
  const platform = navigator.platform || "Plataforma desconocida";
  const deviceType = /android|iphone|ipad|ipod|mobile/i.test(userAgent)
    ? "Movil"
    : "PC";
  const browser = detectBrowserLabel(userAgent);

  return `${deviceType} - ${platform} - ${browser}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Sin registro";
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ShiftSetupAdmin = () => {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { activeBranchId, activeBranch, isGlobalAdmin } = useBranch();
  const [activeTablesCount, setActiveTablesCount] = useState(0);
  const [shiftUsersState, setShiftUsersState] = useState<ShiftUserRow[]>([]);
  const [shiftCajaSetup, setShiftCajaSetup] =
    useState<ShiftCajaSetupState>(EMPTY_CAJA_SETUP);
  const [selectedUserToAdd, setSelectedUserToAdd] = useState("");
  const [checkingUserToAdd, setCheckingUserToAdd] = useState(false);
  const [cancelPolicyState, setCancelPolicyState] = useState<
    BranchCancelPolicyDraftRow[]
  >([]);
  const [cancelPoliciesDirty, setCancelPoliciesDirty] = useState(false);
  const [isShiftSetupDirty, setIsShiftSetupDirty] = useState(false);
  /** Se incrementa tras guardar para forzar rehidratacion del formulario. */
  const [baselineSyncToken, setBaselineSyncToken] = useState(0);

  const [draftDispatchConfig, setDraftDispatchConfig] =
    useState<DispatchConfigModel | null>(null);
  const [draftAssignments, setDraftAssignments] = useState<
    DispatchAssignment[]
  >([]);
  const [warningDialog, setWarningDialog] = useState({
    open: false,
    title: "",
    description: "",
  });
  const [zeroSpecialCloseDialog, setZeroSpecialCloseDialog] = useState(false);
  const [zeroValueSpecialOrders, setZeroValueSpecialOrders] = useState<
    ZeroValueSpecialOrder[]
  >([]);
  const [checkingZeroValueSpecialOrders, setCheckingZeroValueSpecialOrders] =
    useState(false);
  const [payingZeroValueSpecialOrders, setPayingZeroValueSpecialOrders] =
    useState(false);
  const [cashierChangeDialogOpen, setCashierChangeDialogOpen] = useState(false);
  const [cashierChangePassword, setCashierChangePassword] = useState("");
  const [cashierChangePasswordError, setCashierChangePasswordError] =
    useState("");
  const [validatingCashierChangePassword, setValidatingCashierChangePassword] =
    useState(false);
  const [showStaleCleanupConfirm, setShowStaleCleanupConfirm] = useState(false);
  const [isPrintingStaleReport, setIsPrintingStaleReport] = useState(false);

  const {
    config: dispatchConfig,
    assignments,
    isLoading: dispatchLoading,
  } = useDispatchConfig();

  const cajaTemplatesQuery = useQuery({
    queryKey: ["shift-admin-caja-templates", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [] as Array<{ id: string; name: string }>;
      const { data, error } = await supabase
        .from("cash_register_templates" as any)
        .select("id, name, is_active")
        .eq("branch_id", activeBranchId)
        .order("name", { ascending: true });
        
      if (error) throw error;
      
      return ((data ?? []) as any[])
        .filter((row) => Boolean(row.is_active))
        .map((row) => ({ id: row.id, name: row.name }));
    },
    enabled: !!activeBranchId,
  });

  const branchSettingsQuery = useQuery({
    queryKey: ["shift-admin-branch-settings", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;
      const { data, error } = await supabase
        .from("branches")
        .select("reference_table_count, workflow_mode")
        .eq("id", activeBranchId)
        .single();
      if (error) throw error;
      return {
        referenceTableCount: Number(data.reference_table_count ?? 0),
        workflowMode: String(
          (data as any).workflow_mode ?? "DISPATCH_THEN_CASH",
        ),
      };
    },
    enabled: !!activeBranchId,
  });

  const shiftQuery = useQuery({
    queryKey: ["shift-admin-current-shift", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;
      const { data, error } = await supabase
        .from("cash_shifts")
        .select(
          "id, status, opened_at, active_tables_count, primary_cashier_id, secondary_cajas_enabled, secondary_caja_template_id",
        )
        .eq("branch_id", activeBranchId)
        .eq("status", "OPEN")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const openedDate = new Date(data.opened_at);
        const today = new Date();
        const isStale =
          openedDate.getFullYear() !== today.getFullYear() ||
          openedDate.getMonth() !== today.getMonth() ||
          openedDate.getDate() !== today.getDate();

        return {
          id: data.id,
          status: data.status,
          opened_at: data.opened_at,
          active_tables_count: Number(data.active_tables_count ?? 0),
          primary_cashier_id: (data as any).primary_cashier_id ?? null,
          secondary_cajas_enabled: Boolean(
            (data as any).secondary_cajas_enabled,
          ),
          secondary_caja_template_id:
            (data as any).secondary_caja_template_id ?? null,
          is_stale: isStale,
        };
      }
      return null;
    },
    enabled: !!activeBranchId,
    placeholderData: keepPreviousData,
    retry: 2,
  });

  const shiftUsersQuery = useQuery({
    queryKey: [
      "shift-admin-users",
      activeBranchId,
      shiftQuery.data?.id ?? "closed",
    ],
    queryFn: async () => {
      if (!activeBranchId) return [] as ShiftUserRow[];
      const { data, error } = await supabase.rpc(
        "list_shift_users_for_branch" as any,
        {
          p_branch_id: activeBranchId,
        } as any,
      );
      if (error) throw error;
      const baseRows = ((data ?? []) as ShiftUserRow[]).filter(
        (row) => row.is_profile_active,
      );
      const shiftId = shiftQuery.data?.id;

      if (!shiftId) {
        return baseRows.map((row) => normalizeShiftUser(row, false));
      }

      const shiftUserSelectBase =
        "user_id, is_enabled, can_serve_tables, can_access_orders, can_edit_orders, can_dispatch_orders, can_manage_products, can_use_caja, can_authorize_order_cancel, can_double_session, is_supervisor, can_pack_orders, secondary_caja_takeout_enabled, secondary_caja_express_enabled, secondary_caja_template_id, can_serve_plates";
      const shiftUserSelectExtended = shiftUserSelectBase;

      let shiftUsersData: unknown[] | null = null;
      const extendedShiftUsersResult = await (supabase
        .from("cash_shift_users" as any)
        .select(shiftUserSelectExtended)
        .eq("shift_id", shiftId) as any);

      if (
        extendedShiftUsersResult.error &&
        isMissingColumnError(extendedShiftUsersResult.error)
      ) {
        const baseShiftUsersResult = await (supabase
          .from("cash_shift_users" as any)
          .select(shiftUserSelectBase)
          .eq("shift_id", shiftId) as any);
        if (baseShiftUsersResult.error) throw baseShiftUsersResult.error;
        shiftUsersData = baseShiftUsersResult.data ?? [];
      } else {
        if (extendedShiftUsersResult.error)
          throw extendedShiftUsersResult.error;
        shiftUsersData = extendedShiftUsersResult.data ?? [];
      }

      const shiftUsersMap = new Map<
        string,
        {
          is_enabled: boolean;
          can_serve_tables: boolean;
          can_access_orders: boolean;
          can_edit_orders: boolean;
          can_dispatch_orders: boolean;
          can_manage_products: boolean;
          can_use_caja: boolean;
          can_authorize_order_cancel: boolean;
          can_double_session: boolean;
          is_supervisor: boolean;
          can_pack_orders: boolean;
          secondary_caja_takeout_enabled: boolean;
          secondary_caja_express_enabled: boolean;
          secondary_caja_template_id: string | null;
          can_serve_plates: boolean;
        }
      >();

      for (const row of (shiftUsersData ?? []) as Array<{
        user_id: string;
        is_enabled: boolean | null;
        can_serve_tables: boolean | null;
        can_access_orders: boolean | null;
        can_edit_orders: boolean | null;
        can_dispatch_orders: boolean | null;
        can_manage_products: boolean | null;
        can_use_caja: boolean | null;
        can_authorize_order_cancel: boolean | null;
        can_double_session: boolean | null;
        is_supervisor: boolean | null;
        can_pack_orders: boolean | null;
        secondary_caja_takeout_enabled: boolean | null;
        secondary_caja_express_enabled: boolean | null;
        secondary_caja_template_id: string | null;
        can_serve_plates: boolean | null;
      }>) {
        shiftUsersMap.set(row.user_id, {
          is_enabled: Boolean(row.is_enabled),
          can_serve_tables: Boolean(row.can_serve_tables),
          can_access_orders: Boolean(
            row.can_access_orders ?? row.can_serve_tables,
          ),
          can_edit_orders: Boolean(row.can_edit_orders),
          can_dispatch_orders: Boolean(row.can_dispatch_orders),
          can_manage_products: Boolean(
            row.can_manage_products ?? row.can_dispatch_orders,
          ),
          can_use_caja: Boolean(row.can_use_caja),
          can_authorize_order_cancel: Boolean(row.can_authorize_order_cancel),
          can_double_session: Boolean(row.can_double_session),
          is_supervisor: Boolean(row.is_supervisor),
          can_pack_orders: Boolean(row.can_pack_orders),
          secondary_caja_takeout_enabled: Boolean(
            row.secondary_caja_takeout_enabled,
          ),
          secondary_caja_express_enabled: Boolean(
            row.secondary_caja_express_enabled,
          ),
          secondary_caja_template_id: row.secondary_caja_template_id ?? null,
          can_serve_plates: Boolean(row.can_serve_plates),
        });
      }

      return baseRows.map((row) =>
        normalizeShiftUser(
          {
            ...row,
            ...(shiftUsersMap.get(row.user_id) ?? {}),
          },
          false,
        ),
      );
    },
    enabled: !!activeBranchId,
  });

  const latestShiftAuditQuery = useQuery({
    queryKey: ["shift-admin-latest-shift-audit", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return null;

      const { data, error } = await supabase
        .from("cash_shifts")
        .select(
          "id, status, opened_at, closed_at, notes, closed_by, closed_from_device",
        )
        .eq("branch_id", activeBranchId)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      let closedByName: string | null = null;
      let closedByUsername: string | null = null;

      if ((data as any).closed_by) {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("full_name, username")
          .eq("id", (data as any).closed_by)
          .maybeSingle();

        if (profileError) throw profileError;
        closedByName = profileData?.full_name ?? null;
        closedByUsername = profileData?.username ?? null;
      }

      return {
        id: data.id,
        status: data.status,
        openedAt: data.opened_at,
        closedAt: data.closed_at,
        notes: data.notes ?? null,
        closedBy: (data as any).closed_by ?? null,
        closedByName,
        closedByUsername,
        closedFromDevice: (data as any).closed_from_device ?? null,
      };
    },
    enabled: !!activeBranchId,
  });

  const cancelPolicyQuery = useQuery({
    queryKey: ["shift-admin-cancel-policy", activeBranchId],
    queryFn: async () => {
      if (!activeBranchId) return [] as BranchCancelPolicyDraftRow[];
      const { data, error } = await supabase.rpc(
        "list_branch_cancel_policy_nodes" as any,
        {
          p_branch_id: activeBranchId,
        } as any,
      );
      if (error) throw error;
      const normalizedRows = ((data ?? []) as BranchCancelPolicyDraftRow[])
        .map((row) => ({
          ...row,
          menu_scope: row.menu_scope ?? "TABLE",
          descendant_product_count: Number(row.descendant_product_count ?? 0),
          is_primary_root_category: Boolean(row.is_primary_root_category),
          is_kitchen_plate: Boolean(row.is_kitchen_plate),
          allow_direct_cancel: Boolean(row.allow_direct_cancel),
        }))
        .filter((row) => row.descendant_product_count > 0);

      const shouldForcePrimaryRootOff =
        normalizedRows.length > 0 &&
        normalizedRows.every((row) => row.allow_direct_cancel) &&
        normalizedRows.some((row) => row.is_primary_root_category);

      if (!shouldForcePrimaryRootOff) {
        return normalizedRows;
      }

      return normalizedRows.map((row) =>
        row.is_primary_root_category
          ? { ...row, allow_direct_cancel: false }
          : row,
      );
    },
    enabled: !!activeBranchId && SHOW_SHIFT_CANCEL_POLICY_UI,
  });

  const referenceCount = branchSettingsQuery.data?.referenceTableCount ?? 0;
  const shiftStatusUnresolved =
    !shiftQuery.data
    && (shiftQuery.isLoading || shiftQuery.isPending || shiftQuery.isFetching || shiftQuery.isError);
  const isOpen = Boolean(shiftQuery.data);
  const isStale = !!(shiftQuery.data as any)?.is_stale && isOpen;
  const isCashThenDispatch =
    branchSettingsQuery.data?.workflowMode === "CASH_THEN_DISPATCH";
  const allBranchUsers = shiftUsersQuery.data ?? [];
  const persistedTablesCount = isOpen
    ? (shiftQuery.data?.active_tables_count ?? 0)
    : referenceCount;
  const persistedEnabledUsersData = useMemo(
    () =>
      allBranchUsers
        .filter((row) => row.is_enabled)
        .map((row) => normalizeShiftUser(row, false)),
    [allBranchUsers],
  );
  const persistedEnabledUserIds = useMemo(
    () => persistedEnabledUsersData.map((row) => row.user_id),
    [persistedEnabledUsersData],
  );
  const persistedCajaUserIds = useMemo(() => {
    const ids = new Set(getCajaUserIds(persistedEnabledUsersData));
    const primaryCashierId = shiftQuery.data?.primary_cashier_id;
    if (primaryCashierId) {
      ids.add(primaryCashierId);
    }
    return Array.from(ids).sort();
  }, [persistedEnabledUsersData, shiftQuery.data?.primary_cashier_id]);
  const persistedCajaSetup = useMemo((): ShiftCajaSetupState => {
    if (!isOpen || !shiftQuery.data) return EMPTY_CAJA_SETUP;

    const templateByUserId = new Map(
      persistedEnabledUsersData.map((row) => [row.user_id, row.secondary_caja_template_id]),
    );

    return mapPersistedCajaSetup({
      cajaUserIds: persistedCajaUserIds,
      primaryCashierId: shiftQuery.data.primary_cashier_id ?? null,
      fallbackTemplateId: shiftQuery.data.secondary_caja_template_id ?? null,
      templateByUserId,
    });
  }, [
    isOpen,
    persistedCajaUserIds,
    persistedEnabledUsersData,
    shiftQuery.data,
  ]);
  const persistedEnabledUserIdsKey = useMemo(
    () =>
      [...persistedEnabledUserIds]
        .sort((a, b) => a.localeCompare(b))
        .join("|"),
    [persistedEnabledUserIds],
  );
  const persistedCajaSetupKey = cajaSetupSignature(persistedCajaSetup);
  const enabledUserIds = useMemo(
    () => shiftUsersState.map((userState) => userState.user_id),
    [shiftUsersState],
  );
  const hasCajaConfigChange =
    isOpen && cajaSetupSignature(shiftCajaSetup) !== persistedCajaSetupKey;
  const loggedUserName =
    profile?.full_name ||
    profile?.username ||
    user?.email ||
    "usuario logueado";
  const cashierChangeSummary = useMemo(
    () => ({
      previous: formatCajaSetupSummary(
        persistedEnabledUsersData,
        persistedCajaSetup,
      ),
      next: formatCajaSetupSummary(shiftUsersState, shiftCajaSetup),
    }),
    [
      persistedCajaSetup,
      persistedEnabledUsersData,
      shiftCajaSetup,
      shiftUsersState,
    ],
  );
  const cajaSetupUserOptions = useMemo(
    (): ShiftCajaSetupUserOption[] =>
      shiftUsersState.map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name,
        username: row.username,
        alias: row.alias ?? row.username,
      })),
    [shiftUsersState],
  );
  const persistedCancelPolicies = useMemo(
    () => cancelPolicyQuery.data ?? [],
    [cancelPolicyQuery.data],
  );
  const comparableCancelPolicies = useMemo(() => {
    const normalizePolicies = (rows: BranchCancelPolicyDraftRow[]) =>
      rows
        .filter((row) => isGlobalAdmin || !row.is_primary_root_category)
        .map((policy) => ({
          menu_node_id: policy.menu_node_id,
          is_kitchen_plate: policy.is_kitchen_plate,
          allow_direct_cancel: policy.allow_direct_cancel,
        }))
        .sort((a, b) => a.menu_node_id.localeCompare(b.menu_node_id));

    return {
      current: normalizePolicies(cancelPolicyState),
      persisted: normalizePolicies(persistedCancelPolicies),
    };
  }, [cancelPolicyState, isGlobalAdmin, persistedCancelPolicies]);
  const availableUsersToAdd = useMemo(
    () =>
      allBranchUsers.filter(
        (branchUser) => !enabledUserIds.includes(branchUser.user_id),
      ),
    [allBranchUsers, enabledUserIds],
  );
  const dispatchCapableUsers = useMemo(
    () =>
      shiftUsersState.filter(
        (userState) => userState.can_dispatch_orders || userState.is_supervisor,
      ),
    [shiftUsersState],
  );
  const mesaCapableUsers = useMemo(
    () =>
      shiftUsersState.filter(
        (userState) => userState.can_serve_tables || userState.is_supervisor,
      ),
    [shiftUsersState],
  );
  const dispatchCapableUserIds = useMemo(
    () => dispatchCapableUsers.map((userState) => userState.user_id),
    [dispatchCapableUsers],
  );

  const dispatchConfigHydrationKey = useMemo(
    () =>
      JSON.stringify({
        branchId: activeBranchId ?? "",
        configId: dispatchConfig?.id ?? "",
        dispatch_mode: dispatchConfig?.dispatch_mode ?? "SINGLE",
        table_enabled: dispatchConfig?.table_enabled ?? true,
        takeout_enabled: dispatchConfig?.takeout_enabled ?? true,
        express_enabled: dispatchConfig?.express_enabled ?? true,
      }),
    [activeBranchId, dispatchConfig],
  );
  const assignmentsHydrationKey = useMemo(
    () =>
      JSON.stringify(
        [...(assignments ?? [])]
          .map((item) => ({
            user_id: item.user_id,
            dispatch_type: item.dispatch_type,
          }))
          .sort((a, b) =>
            `${a.user_id}-${a.dispatch_type}`.localeCompare(
              `${b.user_id}-${b.dispatch_type}`,
            ),
          ),
      ),
    [assignments],
  );
  const cancelPolicyHydrationKey = useMemo(
    () => JSON.stringify(comparableCancelPolicies.persisted),
    [comparableCancelPolicies.persisted],
  );

  const persistedSnapshotKey = useMemo(
    () =>
      [
        activeBranchId ?? "",
        shiftQuery.data?.id ?? "closed",
        String(persistedTablesCount),
        persistedEnabledUserIdsKey,
        shiftUserRolesSignature(persistedEnabledUsersData),
        persistedCajaSetupKey,
        dispatchConfigHydrationKey,
        assignmentsHydrationKey,
        cancelPolicyHydrationKey,
      ].join("||"),
    [
      activeBranchId,
      shiftQuery.data?.id,
      persistedTablesCount,
      persistedEnabledUserIdsKey,
      persistedEnabledUsersData,
      persistedCajaSetupKey,
      dispatchConfigHydrationKey,
      assignmentsHydrationKey,
      cancelPolicyHydrationKey,
    ],
  );

  const previousPersistedSnapshotKeyRef = useRef("");
  const previousBaselineSyncTokenRef = useRef(0);

  const markShiftSetupDirty = () => {
    setIsShiftSetupDirty(true);
  };

  const handleActiveTablesCountChange = (value: number) => {
    markShiftSetupDirty();
    setActiveTablesCount(value);
  };

  const handleShiftCajaSetupChange = (next: ShiftCajaSetupState) => {
    markShiftSetupDirty();
    setShiftCajaSetup(next);
  };

  useEffect(() => {
    const forceSync =
      baselineSyncToken !== previousBaselineSyncTokenRef.current;
    if (forceSync) {
      previousBaselineSyncTokenRef.current = baselineSyncToken;
    }

    const snapshotChanged =
      previousPersistedSnapshotKeyRef.current !== persistedSnapshotKey;

    if (!forceSync && !snapshotChanged) {
      return;
    }

    const previousKey = previousPersistedSnapshotKeyRef.current;
    previousPersistedSnapshotKeyRef.current = persistedSnapshotKey;

    const previousParts = previousKey.split("||");
    const nextParts = persistedSnapshotKey.split("||");
    const branchOrShiftChanged =
      !previousKey ||
      previousParts[0] !== nextParts[0] ||
      previousParts[1] !== nextParts[1];

    // Conservar ediciones locales solo si no forzamos sync (post-guardar).
    if (!forceSync && isShiftSetupDirty && !branchOrShiftChanged) {
      setShiftCajaSetup((current) => {
        if (countConfiguredShiftCashiers(current) > 0) {
          return current;
        }
        if (countConfiguredShiftCashiers(persistedCajaSetup) === 0) {
          return current;
        }
        return persistedCajaSetup;
      });
      return;
    }

    setActiveTablesCount(persistedTablesCount);
    setShiftUsersState(persistedEnabledUsersData);
    setShiftCajaSetup(persistedCajaSetup);
    setDraftDispatchConfig(dispatchConfig ?? null);
    setDraftAssignments(assignments ?? []);
    setCancelPolicyState(persistedCancelPolicies);
    setCancelPoliciesDirty(false);
    setIsShiftSetupDirty(false);
  }, [
    persistedSnapshotKey,
    baselineSyncToken,
    isShiftSetupDirty,
    persistedTablesCount,
    persistedEnabledUsersData,
    persistedCajaSetup,
    dispatchConfig,
    assignments,
    persistedCancelPolicies,
  ]);

  useEffect(() => {
    if (!selectedUserToAdd) return;
    if (
      !availableUsersToAdd.some(
        (branchUser) => branchUser.user_id === selectedUserToAdd,
      )
    ) {
      setSelectedUserToAdd("");
    }
  }, [availableUsersToAdd, selectedUserToAdd]);

  const workingDispatchConfig = draftDispatchConfig ?? dispatchConfig;
  // Hasta hidratar el draft, comparar contra assignments del servidor (evita "dirty" falso).
  const workingAssignments =
    draftDispatchConfig != null ? draftAssignments : (assignments ?? []);

  const enabledViews = useMemo(() => {
    const views: Array<{ code: "TABLE" | "TAKEOUT"; label: string }> = [];
    if (activeTablesCount > 0) views.push({ code: "TABLE", label: "Mesa" });
    views.push({ code: "TAKEOUT", label: "Para llevar" });
    return views;
  }, [activeTablesCount]);

  const enabledAssignments = useMemo(() => {
    const enabledSet = new Set(dispatchCapableUserIds);
    return workingAssignments.filter((assignment) =>
      enabledSet.has(assignment.user_id),
    );
  }, [dispatchCapableUserIds, workingAssignments]);

  const enabledDispatchUserIds = useMemo(
    () =>
      Array.from(
        new Set(enabledAssignments.map((assignment) => assignment.user_id)),
      ),
    [enabledAssignments],
  );

  const missingDispatchViews = useMemo(() => {
    if ((workingDispatchConfig?.dispatch_mode ?? "SINGLE") !== "SPLIT")
      return [] as string[];

    return enabledViews
      .filter(
        (view) =>
          !enabledAssignments.some(
            (assignment) =>
              assignment.dispatch_type === "ALL" ||
              assignment.dispatch_type === view.code,
          ),
      )
      .map((view) => view.label);
  }, [workingDispatchConfig?.dispatch_mode, enabledAssignments, enabledViews]);

  const setupIssues = useMemo(() => {
    const issues: string[] = [];

    if (enabledUserIds.length === 0) {
      issues.push(
        "Debe haber por lo menos un usuario habilitado para este turno.",
      );
    }

    const usersWithoutOperationalRole = shiftUsersState
      .filter((userState) => !hasOperationalCapability(userState))
      .map(
        (userState) => userState.full_name || getUserAlias(userState) || "Usuario",
      );

    if (usersWithoutOperationalRole.length > 0) {
      issues.push(
        `Cada usuario habilitado debe tener al menos un rol operativo. Revisa: ${usersWithoutOperationalRole.join(", ")}.`,
      );
    }

    if (activeTablesCount > 0 && mesaCapableUsers.length === 0) {
      issues.push(
        "Debe haber por lo menos un usuario para atencion de mesas en este turno.",
      );
    }

    if (dispatchCapableUsers.length === 0) {
      issues.push(
        "Debe haber por lo menos un usuario para despacho en este turno.",
      );
    }

    issues.push(...buildCajaSetupIssues(shiftCajaSetup, enabledUserIds));

    if ((workingDispatchConfig?.dispatch_mode ?? "SINGLE") === "SPLIT") {
      if (enabledDispatchUserIds.length === 0) {
        issues.push(
          "Debe haber por lo menos un usuario habilitado asignado a despacho.",
        );
      }
      if (missingDispatchViews.length > 0) {
        issues.push(
          `Asigna al menos un despachador habilitado para: ${missingDispatchViews.join(", ")}.`,
        );
      }
    }

    return Array.from(new Set(issues));
  }, [
    activeTablesCount,
    mesaCapableUsers.length,
    dispatchCapableUsers.length,
    workingDispatchConfig?.dispatch_mode,
    enabledDispatchUserIds.length,
    enabledUserIds.length,
    shiftUsersState,
    shiftCajaSetup,
    missingDispatchViews,
    isCashThenDispatch,
  ]);

  const hasSetupIssues = setupIssues.length > 0;
  const dispatchConfigChanged =
    (dispatchConfig?.dispatch_mode ?? "SINGLE") !==
    (workingDispatchConfig?.dispatch_mode ?? "SINGLE");
  const assignmentsChanged =
    JSON.stringify(
      [...(assignments ?? [])]
        .map((item) => ({
          user_id: item.user_id,
          dispatch_type: item.dispatch_type,
        }))
        .sort((a, b) =>
          `${a.user_id}-${a.dispatch_type}`.localeCompare(
            `${b.user_id}-${b.dispatch_type}`,
          ),
        ),
    ) !==
    JSON.stringify(
      [...workingAssignments]
        .map((item) => ({
          user_id: item.user_id,
          dispatch_type: item.dispatch_type,
        }))
        .sort((a, b) =>
          `${a.user_id}-${a.dispatch_type}`.localeCompare(
            `${b.user_id}-${b.dispatch_type}`,
          ),
        ),
    );
  const cancelPoliciesChanged =
    JSON.stringify(comparableCancelPolicies.current) !==
    JSON.stringify(comparableCancelPolicies.persisted);
  const hasComputedLocalChanges =
    activeTablesCount !== persistedTablesCount ||
    cajaSetupSignature(shiftCajaSetup) !== persistedCajaSetupKey ||
    !sameMembers(
      shiftUsersState.map((u) => u.user_id),
      persistedEnabledUserIds,
    ) ||
    shiftUserRolesSignature(shiftUsersState) !==
      shiftUserRolesSignature(persistedEnabledUsersData) ||
    dispatchConfigChanged ||
    assignmentsChanged ||
    cancelPoliciesChanged ||
    cancelPoliciesDirty;
  // Solo diferencias reales vs servidor; no usar isShiftSetupDirty solo
  // (puede quedar true aunque el usuario revirtiera los cambios).
  const hasLocalChanges = hasComputedLocalChanges;

  // Si el usuario deshace los cambios (vuelve al estado persistido), limpiar dirty flag.
  useEffect(() => {
    if (!isShiftSetupDirty) return;
    if (hasComputedLocalChanges) return;
    setIsShiftSetupDirty(false);
    setCancelPoliciesDirty(false);
  }, [isShiftSetupDirty, hasComputedLocalChanges]);

  const validateSetup = () => {
    if (setupIssues.length > 0) {
      throw new Error(setupIssues[0]);
    }
  };

  const verifyCurrentUserPassword = async (password: string) => {
    if (!user) throw new Error("No hay usuario autenticado");

    const identifier = profile?.alias || profile?.username || profile?.email || user.email;
    if (!identifier) {
      throw new Error(
        "No se pudo identificar al usuario actual para validar la contrasena.",
      );
    }

    const res = await supabase.functions.invoke("login-with-identifier", {
      body: {
        identifier,
        password,
      },
    });

    if (res.error) {
      throw new Error(await resolveFunctionInvokeError(res.error));
    }

    if (res.data?.error) {
      throw new Error(res.data.error);
    }

    if (res.data?.user?.id !== user.id) {
      throw new Error(
        "La contrasena no corresponde al usuario que esta realizando el cambio.",
      );
    }
  };

  const handleSaveShiftClick = () => {
    if (hasCajaConfigChange) {
      setCashierChangePassword("");
      setCashierChangePasswordError("");
      setCashierChangeDialogOpen(true);
      return;
    }

    saveShiftMutation.mutate();
  };

  const handleConfirmCashierChange = async () => {
    const password = cashierChangePassword.trim();

    if (!password) {
      setCashierChangePasswordError(
        "Ingresa tu contrasena para confirmar el cambio de cajero.",
      );
      return;
    }

    setValidatingCashierChangePassword(true);
    setCashierChangePasswordError("");

    try {
      await verifyCurrentUserPassword(password);
      setCashierChangeDialogOpen(false);
      setCashierChangePassword("");
      saveShiftMutation.mutate();
    } catch (error: any) {
      setCashierChangePasswordError(
        error?.message || "No se pudo validar la contrasena.",
      );
    } finally {
      setValidatingCashierChangePassword(false);
    }
  };

  const toggleUser = (userId: string, checked: boolean) => {
    markShiftSetupDirty();
    setShiftUsersState((prev) => {
      if (checked) {
        const userRow = allBranchUsers.find(
          (branchUser) => branchUser.user_id === userId,
        );
        if (!userRow) return prev;

        const defaultShiftUser = normalizeShiftUser(
          {
            ...userRow,
            is_enabled: true,
            can_serve_tables: true,
            can_access_orders: true,
            can_use_caja: false,
            can_double_session: false,
          },
          false,
        );

        return [...prev, defaultShiftUser];
      }
      setShiftCajaSetup((prev) => removeCashierFromSetup(prev, userId));
      return prev.filter((u) => u.user_id !== userId);
    });
  };

  const addSelectedUser = async () => {
    if (!selectedUserToAdd) {
      toast.error("Selecciona un usuario para agregar al turno");
      return;
    }

    if (!activeBranchId) {
      toast.error("No hay sucursal activa");
      return;
    }

    const selectedUser = allBranchUsers.find(
      (branchUser) => branchUser.user_id === selectedUserToAdd,
    );
    const selectedUserName =
      selectedUser?.full_name || getUserAlias(selectedUser) || "El usuario";

    setCheckingUserToAdd(true);
    try {
      const { data, error } = await supabase.rpc(
        "get_user_open_shift_conflict" as any,
        {
          p_user_id: selectedUserToAdd,
          p_branch_id: activeBranchId,
        } as any,
      );

      if (error) throw error;

      const conflict = (
        (data ?? []) as Array<{ branch_name: string | null }>
      )[0];
      if (conflict) {
        setWarningDialog({
          open: true,
          title: "Usuario ya habilitado",
          description: `${selectedUserName} no se puede agregar porque esta habilitado en el turno de la sucursal ${conflict.branch_name ?? "otra sucursal"}.`,
        });
        return;
      }

      toggleUser(selectedUserToAdd, true);
      setSelectedUserToAdd("");
    } catch (error: any) {
      showShiftSetupError(error, setWarningDialog);
    } finally {
      setCheckingUserToAdd(false);
    }
  };

  const updateUserRole = (
    userId: string,
    role: ShiftUserRoleKey,
    value: boolean,
  ) => {

    if (role === "can_use_caja") {
      return;
    }

    if (role === "can_pack_orders" && value === true) {
      const existingPacker = shiftUsersState.find((u) => u.can_pack_orders && u.user_id !== userId);
      if (existingPacker) {
        toast.error(`Solo puede haber un Empacador por turno. ${existingPacker.full_name || getUserAlias(existingPacker)} ya tiene este permiso.`);
        return;
      }
    }

    markShiftSetupDirty();
    setShiftUsersState((prev) =>
      prev.map((u) => {
        if (u.user_id !== userId) return u;
        return normalizeShiftUser({ ...u, [role]: value }, false);
      }),
    );
  };

  const invalidateShiftState = async () => {
    invalidateOperationalOrderQueries(qc, {
      branchId: activeBranchId,
      includeTables: true,
      includeCompletedPayments: true,
      includeShiftGate: true,
      includeCurrentShift: true,
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["shift-admin-current-shift"] }),
      qc.invalidateQueries({ queryKey: ["shift-admin-users"] }),
      qc.invalidateQueries({ queryKey: ["open-cash-shift"], exact: false }),
      qc.invalidateQueries({ queryKey: ["open-cash-shift-id"], exact: false }),
      qc.invalidateQueries({ queryKey: ["dispatch-bootstrap", activeBranchId] }),
      qc.invalidateQueries({
        queryKey: ["shift-admin-cancel-policy", activeBranchId],
      }),
      qc.invalidateQueries({
        queryKey: ["shift-admin-latest-shift-audit", activeBranchId],
      }),
    ]);

    // Refetch critico para que hasLocalChanges se limpie tras guardar.
    await Promise.all([
      qc.refetchQueries({ queryKey: ["shift-admin-current-shift"] }),
      qc.refetchQueries({
        queryKey: [
          "shift-admin-users",
          activeBranchId,
          shiftQuery.data?.id ?? "closed",
        ],
      }),
      qc.refetchQueries({ queryKey: ["dispatch-bootstrap", activeBranchId] }),
      ...(SHOW_SHIFT_CANCEL_POLICY_UI
        ? [
            qc.refetchQueries({
              queryKey: ["shift-admin-cancel-policy", activeBranchId],
            }),
          ]
        : []),
    ]);
  };

  const updateCancelPolicy = (
    menuNodeId: string,
    patch: Partial<
      Pick<
        BranchCancelPolicyDraftRow,
        "is_kitchen_plate" | "allow_direct_cancel"
      >
    >,
  ) => {
    setCancelPolicyState((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.menu_node_id !== menuNodeId) return row;
        const updatedRow = { ...row, ...patch };
        if (
          updatedRow.allow_direct_cancel !== row.allow_direct_cancel ||
          updatedRow.is_kitchen_plate !== row.is_kitchen_plate
        ) {
          changed = true;
        }
        return updatedRow;
      });

      if (changed) {
        setCancelPoliciesDirty(true);
        setIsShiftSetupDirty(true);
      }

      return next;
    });
  };

  const persistDispatchDraft = async () => {
    if (!activeBranchId || !workingDispatchConfig)
      throw new Error("No hay configuracion de despacho");

    const upsertPayload = {
      branch_id: activeBranchId,
      dispatch_mode: workingDispatchConfig.dispatch_mode,
      table_enabled: activeTablesCount > 0,
      takeout_enabled: true,
      updated_at: new Date().toISOString(),
    };

    const upsertResult = await (supabase
      .from("dispatch_config" as any)
      .upsert(upsertPayload, {
        onConflict: "branch_id",
        ignoreDuplicates: false,
      })
      .select(
        "id, branch_id, dispatch_mode, table_enabled, takeout_enabled, created_at, updated_at",
      )
      .single() as any);

    if (upsertResult.error) throw upsertResult.error;

    const savedConfig = upsertResult.data as DispatchConfigModel;

    const deleteResult = await (supabase
      .from("dispatch_assignments" as any)
      .delete()
      .eq("dispatch_config_id", savedConfig.id) as any);
    if (deleteResult.error) throw deleteResult.error;

    if (
      savedConfig.dispatch_mode === "SPLIT" &&
      workingAssignments.length > 0
    ) {
      const dispatchUserSet = new Set(dispatchCapableUserIds);
      const sanitizedAssignments = workingAssignments
        .filter((assignment) => dispatchUserSet.has(assignment.user_id))
        .map((assignment) => ({
          dispatch_config_id: savedConfig.id,
          user_id: assignment.user_id,
          dispatch_type: assignment.dispatch_type,
        }));

      if (sanitizedAssignments.length > 0) {
        const insertResult = await (supabase
          .from("dispatch_assignments" as any)
          .insert(sanitizedAssignments) as any);
        if (insertResult.error) throw insertResult.error;
      }
    }
  };

  const persistCancelPolicyDraft = async () => {
    if (!activeBranchId) throw new Error("No hay sucursal activa");
    if (!cancelPoliciesChanged && !cancelPoliciesDirty) return;

    const validPolicyIds = new Set(
      persistedCancelPolicies.map((row) => row.menu_node_id),
    );

    const payload = cancelPolicyState
      .filter((row) => validPolicyIds.has(row.menu_node_id))
      .filter((row) => row.descendant_product_count > 0)
      .filter((row) => isGlobalAdmin || !row.is_primary_root_category)
      .map((row) => ({
        menu_node_id: row.menu_node_id,
        is_kitchen_plate: row.is_kitchen_plate,
        allow_direct_cancel: row.allow_direct_cancel,
      }));

    const { error } = await supabase.rpc(
      "save_branch_cancel_policy" as any,
      {
        p_branch_id: activeBranchId,
        p_policies: payload,
      } as any,
    );

    if (!error) return;

    if (!isRecoverableCancelPolicyRpcError(error)) {
      throw error;
    }

    for (const row of cancelPolicyState) {
      if (!validPolicyIds.has(row.menu_node_id)) continue;
      if (row.descendant_product_count <= 0) continue;
      if (!isGlobalAdmin && row.is_primary_root_category) continue;

      if (!row.is_kitchen_plate && !row.allow_direct_cancel) {
        const { error: deleteError } = await (supabase
          .from("branch_cancel_policy" as any)
          .delete()
          .eq("branch_id", activeBranchId)
          .eq("menu_node_id", row.menu_node_id) as any);
        if (deleteError) throw deleteError;
        continue;
      }

      const { error: upsertError } = await (supabase
        .from("branch_cancel_policy" as any)
        .upsert(
          {
            branch_id: activeBranchId,
            menu_node_id: row.menu_node_id,
            is_kitchen_plate: row.is_kitchen_plate,
            allow_direct_cancel: row.allow_direct_cancel,
            updated_by: user?.id ?? null,
          } as any,
          {
            onConflict: "branch_id,menu_node_id",
            ignoreDuplicates: false,
          },
        ) as any);
      if (upsertError) throw upsertError;
    }
  };

  const setShiftUserEnabledCompat = async (params: {
    shiftId: string;
    userId: string;
    isEnabled: boolean;
    canServeTables: boolean;
    canAccessOrders: boolean;
    canEditOrders: boolean;
    canDispatchOrders: boolean;
    canManageProducts: boolean;
    canUseCaja: boolean;
    canAuthorizeOrderCancel: boolean;
    canDoubleSession: boolean;
    isSupervisor: boolean;
    canPackOrders: boolean;
    canServePlates?: boolean;
  }) => {
    const sanitizedParams = sanitizeShiftUserCapability(params);

    if (!sanitizedParams.isEnabled) {
      const { error: deleteError } = await (supabase
        .from("cash_shift_users" as any)
        .delete()
        .eq("shift_id", sanitizedParams.shiftId)
        .eq("user_id", sanitizedParams.userId) as any);

      if (deleteError) throw deleteError;
      return;
    }

    const { error: upsertError } = await (supabase
      .from("cash_shift_users" as any)
      .upsert(
        {
          shift_id: sanitizedParams.shiftId,
          user_id: sanitizedParams.userId,
          is_enabled: true,
          can_serve_tables: sanitizedParams.canServeTables,
          can_access_orders: sanitizedParams.canAccessOrders,
          can_edit_orders: sanitizedParams.canEditOrders,
          can_dispatch_orders: sanitizedParams.canDispatchOrders,
          can_manage_products: sanitizedParams.canManageProducts,
          can_use_caja: false,
          can_authorize_order_cancel: sanitizedParams.canAuthorizeOrderCancel,
          can_double_session: sanitizedParams.canDoubleSession,
          is_supervisor: sanitizedParams.isSupervisor,
          can_pack_orders: sanitizedParams.canPackOrders,
          can_serve_plates: sanitizedParams.canServePlates ?? false,
        } as any,
        {
          onConflict: "shift_id,user_id",
          ignoreDuplicates: false,
        },
      ) as any);

    if (upsertError) throw upsertError;
  };

  const persistShiftUsersForShift = async (
    shiftId: string,
    sanitizedEnabledUsers: Array<{
      userId: string;
      isEnabled: boolean;
      canServeTables: boolean;
      canAccessOrders: boolean;
      canEditOrders: boolean;
      canDispatchOrders: boolean;
      canManageProducts: boolean;
      canUseCaja: boolean;
      canAuthorizeOrderCancel: boolean;
      canDoubleSession: boolean;
      isSupervisor: boolean;
      canPackOrders: boolean;
      canServePlates?: boolean;
    }>,
  ) => {
    for (const entry of sanitizedEnabledUsers) {
      await setShiftUserEnabledCompat({
        shiftId,
        userId: entry.userId,
        isEnabled: true,
        canServeTables: entry.canServeTables,
        canAccessOrders: entry.canAccessOrders,
        canEditOrders: entry.canEditOrders,
        canDispatchOrders: entry.canDispatchOrders,
        canManageProducts: entry.canManageProducts,
        canUseCaja: entry.canUseCaja,
        canAuthorizeOrderCancel: entry.canAuthorizeOrderCancel,
        canDoubleSession: entry.canDoubleSession,
        isSupervisor: entry.isSupervisor,
        canPackOrders: entry.canPackOrders,
        canServePlates: entry.canServePlates ?? false,
      });
    }
  };

  const persistShiftCajaConfiguration = async (shiftId: string) => {
    if (!activeBranchId) throw new Error("No hay sucursal activa");

    const cajaPayload = buildCajaRpcPayload(shiftCajaSetup);

    const { error } = await supabase.rpc(
      "apply_shift_caja_configuration" as any,
      {
        p_shift_id: shiftId,
        p_branch_id: activeBranchId,
        ...cajaPayload,
      } as any,
    );

    if (
      error &&
      (isMissingColumnError(error) ||
        isMissingFunctionOrSchemaError(error, "apply_shift_caja_configuration"))
    ) {
      const { error: legacyError } = await supabase.rpc(
        "apply_shift_caja_configuration" as any,
        {
          p_shift_id: shiftId,
          p_branch_id: activeBranchId,
          p_primary_cashier_id: cajaPayload.p_primary_cashier_id,
          p_secondary_cajas_enabled: cajaPayload.p_secondary_cajas_enabled,
          p_secondary_caja_template_id: cajaPayload.p_secondary_caja_template_id,
          p_secondary_cashier_ids: cajaPayload.p_secondary_cashier_ids,
        } as any,
      );
      if (legacyError) throw legacyError;
      return;
    }

    if (error) throw error;
  };

  /** Reaplica Sesión doble tras apply_shift_caja_* (versiones antiguas podían ponerla en false). */
  const restoreDoubleSessionFlags = async (
    shiftId: string,
    users: Array<{ userId: string; canDoubleSession: boolean }>,
  ) => {
    for (const entry of users) {
      if (!entry.canDoubleSession) continue;
      const { error } = await (supabase
        .from("cash_shift_users" as any)
        .update({ can_double_session: true } as any)
        .eq("shift_id", shiftId)
        .eq("user_id", entry.userId) as any);
      if (error) throw error;
    }
  };

  const resolveCurrentOpenShiftId = async () => {
    if (!activeBranchId) throw new Error("No hay sucursal activa");

    const { data, error } = await supabase
      .from("cash_shifts")
      .select("id")
      .eq("branch_id", activeBranchId)
      .eq("status", "OPEN")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data?.id)
      throw new Error("No se pudo resolver el turno abierto recien creado");
    return data.id as string;
  };

  const openShiftCompat = async () => {
    if (!user) throw new Error("No hay usuario autenticado");
    if (!activeBranchId) throw new Error("No hay sucursal activa");

    const normalizedCount = Math.max(0, Math.trunc(activeTablesCount || 0));
    const cajaPayload = buildCajaRpcPayload(shiftCajaSetup);
    const sanitizedEnabledUsers = shiftUsersState
      .map((u) =>
        sanitizeShiftUserCapability({
          isEnabled: true,
          user_id: u.user_id,
          canServeTables: u.can_serve_tables,
          canAccessOrders: u.can_access_orders,
          canEditOrders: u.can_edit_orders,
          canDispatchOrders: u.can_dispatch_orders,
          canManageProducts: u.can_manage_products,
          canUseCaja: false,
          canAuthorizeOrderCancel: u.can_authorize_order_cancel,
          canDoubleSession: u.can_double_session,
          isSupervisor: u.is_supervisor,
          canPackOrders: u.can_pack_orders,
          canServePlates: u.can_serve_plates ?? false,
        }),
      )
      .filter((entry) => entry.isEnabled);

    if (sanitizedEnabledUsers.length === 0) {
      throw new Error(
        "Debe haber por lo menos un usuario habilitado para abrir el turno.",
      );
    }

    const shiftUserConflicts: string[] = [];
    for (const entry of sanitizedEnabledUsers) {
      const { data: conflictRows, error: conflictError } = await supabase.rpc(
        "get_user_open_shift_conflict" as any,
        { p_user_id: entry.user_id, p_branch_id: activeBranchId } as any,
      );
      if (conflictError) throw conflictError;
      const conflict = (
        (conflictRows ?? []) as Array<{ branch_name: string | null }>
      )[0];
      if (conflict) {
        const label =
          shiftUsersState.find((row) => row.user_id === entry.user_id)
            ?.full_name ||
          getUserAlias(
            shiftUsersState.find((row) => row.user_id === entry.user_id),
          ) ||
          "Usuario";
        shiftUserConflicts.push(
          `${label} (turno abierto en ${conflict.branch_name ?? "otra sucursal"})`,
        );
      }
    }
    if (shiftUserConflicts.length === sanitizedEnabledUsers.length) {
      throw new Error(
        `Ninguno de los usuarios del turno puede abrirse aqui porque ya estan en otro turno abierto: ${shiftUserConflicts.join(", ")}`,
      );
    }
    if (shiftUserConflicts.length > 0) {
      throw new Error(
        `Quita o reemplaza usuarios que ya estan en otro turno abierto: ${shiftUserConflicts.join(", ")}`,
      );
    }

    const enabledUsersJson = sanitizedEnabledUsers.map((entry) => ({
      user_id: entry.user_id,
      can_serve_tables: entry.canServeTables,
      can_access_orders: entry.canAccessOrders,
      can_edit_orders: entry.canEditOrders,
      can_dispatch_orders: entry.canDispatchOrders,
      can_manage_products: entry.canManageProducts,
      can_use_caja: false,
      can_authorize_order_cancel: entry.canAuthorizeOrderCancel,
      can_double_session: entry.canDoubleSession,
      is_supervisor: entry.isSupervisor,
      can_pack_orders: entry.canPackOrders ?? false,
      can_serve_plates: entry.canServePlates ?? false,
    }));

    const { data, error } = await supabase.rpc(
      "open_cash_shift_with_tables" as any,
      {
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_active_tables_count: normalizedCount,
        p_enabled_users: enabledUsersJson,
        ...cajaPayload,
      } as any,
    );

    if (!error) {
      const shiftId =
        (data as string | null) ?? (await resolveCurrentOpenShiftId());
      await persistShiftUsersForShift(
        shiftId,
        sanitizedEnabledUsers.map((entry) => ({
          shiftId,
          userId: entry.user_id,
          isEnabled: true,
          canServeTables: entry.canServeTables,
          canAccessOrders: entry.canAccessOrders,
          canEditOrders: entry.canEditOrders,
          canDispatchOrders: entry.canDispatchOrders,
          canManageProducts: entry.canManageProducts,
          canUseCaja: entry.canUseCaja,
          canAuthorizeOrderCancel: entry.canAuthorizeOrderCancel,
          canDoubleSession: entry.canDoubleSession,
          isSupervisor: entry.isSupervisor,
          canPackOrders: entry.canPackOrders ?? false,
          canServePlates: entry.canServePlates ?? false,
        })),
      );
      // persistShiftUsersForShift fuerza can_use_caja=false; reaplicar cajero principal/secundarios.
      await persistShiftCajaConfiguration(shiftId);
      await restoreDoubleSessionFlags(
        shiftId,
        sanitizedEnabledUsers.map((entry) => ({
          userId: entry.user_id,
          canDoubleSession: entry.canDoubleSession,
        })),
      );
      return shiftId;
    }

    if (!isMissingFunctionOrSchemaError(error, "open_cash_shift_with_tables")) {
      throw error;
    }

    const legacyUserIds = enabledUsersJson.map((entry) => entry.user_id);
    const { data: legacyData, error: legacyError } = await supabase.rpc(
      "open_cash_shift_with_tables" as any,
      {
        p_cashier_id: user.id,
        p_branch_id: activeBranchId,
        p_active_tables_count: normalizedCount,
        p_denoms: [],
        p_enabled_user_ids: legacyUserIds,
      } as any,
    );

    if (legacyError) throw legacyError;

    const shiftId =
      (legacyData as string | null) ?? (await resolveCurrentOpenShiftId());

    await persistShiftUsersForShift(
      shiftId,
      shiftUsersState
        .map((entry) =>
          sanitizeShiftUserCapability({
            shiftId,
            userId: entry.user_id,
            isEnabled: true,
            canServeTables: entry.can_serve_tables,
            canAccessOrders: entry.can_access_orders,
            canEditOrders: entry.can_edit_orders,
            canDispatchOrders: entry.can_dispatch_orders,
            canManageProducts: entry.can_manage_products,
            canUseCaja: entry.can_use_caja,
            canAuthorizeOrderCancel: entry.can_authorize_order_cancel,
            canDoubleSession: entry.can_double_session,
            isSupervisor: entry.is_supervisor,
            canPackOrders: entry.can_pack_orders,
            canServePlates: entry.can_serve_plates,
          }),
        )
        .filter((entry) => entry.isEnabled),
    );

    if (countConfiguredShiftCashiers(shiftCajaSetup) > 0) {
      await persistShiftCajaConfiguration(shiftId);
    }
    await restoreDoubleSessionFlags(
      shiftId,
      sanitizedEnabledUsers.map((entry) => ({
        userId: entry.user_id,
        canDoubleSession: entry.canDoubleSession,
      })),
    );

    return shiftId;
  };

  const openShiftMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No hay usuario autenticado");
      if (!activeBranchId) throw new Error("No hay sucursal activa");
      validateSetup();
      await persistDispatchDraft();
      await persistCancelPolicyDraft();
      await openShiftCompat();
    },
    onSuccess: () => {
      invalidateShiftState();
      toast.success("Turno abierto correctamente");
    },
    onError: (err: any) => showShiftSetupError(err, setWarningDialog),
  });

  const saveShiftMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId || !shiftQuery.data?.id)
        throw new Error("No hay turno abierto");
      validateSetup();
      await persistDispatchDraft();
      await persistCancelPolicyDraft();

      const normalizedCount = Math.max(0, Math.trunc(activeTablesCount || 0));
      const { error: tablesError } = await supabase.rpc(
        "configure_shift_active_tables" as any,
        {
          p_branch_id: activeBranchId,
          p_shift_id: shiftQuery.data.id,
          p_active_tables_count: normalizedCount,
        } as any,
      );
      if (tablesError) throw tablesError;

      const sanitizedEnabledUsers = shiftUsersState
        .map((entry) =>
          sanitizeShiftUserCapability({
            shiftId: shiftQuery.data!.id,
            userId: entry.user_id,
            isEnabled: true,
            canServeTables: entry.can_serve_tables,
            canAccessOrders: entry.can_access_orders,
            canEditOrders: entry.can_edit_orders,
            canDispatchOrders: entry.can_dispatch_orders,
            canManageProducts: entry.can_manage_products,
            canUseCaja: false,
            canAuthorizeOrderCancel: entry.can_authorize_order_cancel,
            canDoubleSession: entry.can_double_session,
            isSupervisor: entry.is_supervisor,
            canPackOrders: entry.can_pack_orders,
            canServePlates: entry.can_serve_plates ?? false,
          }),
        )
        .filter((entry) => entry.isEnabled);

      if (sanitizedEnabledUsers.length === 0) {
        throw new Error(
          "Debe haber por lo menos un usuario habilitado para guardar el turno.",
        );
      }

      await persistShiftUsersForShift(
        shiftQuery.data.id,
        sanitizedEnabledUsers,
      );
      await persistShiftCajaConfiguration(shiftQuery.data.id);
      await restoreDoubleSessionFlags(
        shiftQuery.data.id,
        sanitizedEnabledUsers.map((entry) => ({
          userId: entry.userId,
          canDoubleSession: entry.canDoubleSession,
        })),
      );

      const enabledUserIdsForShift = sanitizedEnabledUsers.map(
        (entry) => entry.userId,
      );
      const deleteQuery = supabase
        .from("cash_shift_users" as any)
        .delete()
        .eq("shift_id", shiftQuery.data.id) as any;

      const { error: cleanupError } =
        enabledUserIdsForShift.length > 0
          ? await deleteQuery.not(
              "user_id",
              "in",
              `(${enabledUserIdsForShift.join(",")})`,
            )
          : await deleteQuery;

      if (cleanupError) throw cleanupError;
    },
    onSuccess: async () => {
      setIsShiftSetupDirty(false);
      setCancelPoliciesDirty(false);
      await invalidateShiftState();
      setBaselineSyncToken((token) => token + 1);
      toast.success("Configuracion del turno guardada");
    },
    onError: (err: any) => showShiftSetupError(err, setWarningDialog),
  });

  const triggerStaleShiftReport = async (
    shiftId: string,
    branchName: string,
  ) => {
    setIsPrintingStaleReport(true);
    const reportToastId = "printing-stale-report";
    toast.loading("Generando reporte de cierre...", { id: reportToastId });

    try {
      const [shift, payments, movements] = await Promise.all([
        fetchShiftSnapshot(shiftId),
        fetchCompletedPaymentsForShift(shiftId),
        fetchCashRegisterMovementsForShift(shiftId),
      ]);

      const methodSummaryMap = new Map<
        string,
        { methodName: string; amount: number; paymentCount: number }
      >();
      for (const payment of payments) {
        if (payment.status === "voided" || payment.status === "reversed") continue;
        const current = methodSummaryMap.get(payment.method_name) ?? {
          methodName: payment.method_name,
          amount: 0,
          paymentCount: 0,
        };
        current.amount += Number(payment.amount ?? 0);
        current.paymentCount += 1;
        methodSummaryMap.set(payment.method_name, current);
      }

      const methodSummary: MethodSummaryEntry[] = Array.from(
        methodSummaryMap.values(),
      )
        .map((entry, index) => ({
          methodId: `stale-method-${index}-${entry.methodName}`,
          methodName: entry.methodName,
          amount: entry.amount,
          paymentCount: entry.paymentCount,
        }))
        .sort(
          (left, right) =>
            right.amount - left.amount ||
            left.methodName.localeCompare(right.methodName),
        );

      openCashClosureReportWindow({
        branchName,
        shift,
        completedPayments: payments,
        methodSummary,
        movements: movements as any,
        closureNotes:
          "Cierre automático de turno expirado (Limpieza inteligente)",
        reportMode: "shift",
      });

      toast.success("Reporte de cierre generado correctamente", {
        id: reportToastId,
      });
    } catch (err: any) {
      console.error("Failed to generate stale shift report", err);
      toast.error("Error al generar el reporte de cierre: " + err.message, {
        id: reportToastId,
      });
    } finally {
      setIsPrintingStaleReport(false);
    }
  };

  const closeShiftMutation = useMutation({
    mutationFn: async () => {
      if (!activeBranchId || !shiftQuery.data?.id)
        throw new Error("No hay turno abierto");

      if (isStale) {
        const { error } = await supabase.rpc(
          "cleanup_and_close_stale_shift" as any,
          {
            p_shift_id: shiftQuery.data.id,
            p_branch_id: activeBranchId,
            p_notes:
              "Cierre automático de turno expirado (Limpieza inteligente)",
          } as any,
        );
        if (error) throw error;
        return;
      }

      const { error } = await supabase.rpc(
        "close_cash_shift_with_tables" as any,
        {
          p_shift_id: shiftQuery.data.id,
          p_branch_id: activeBranchId,
          p_notes: "Cierre desde Administracion > Turno",
          p_closed_from_device: buildClosureDeviceLabel(),
          p_closed_from_user_agent: navigator.userAgent ?? "",
        } as any,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      const wasStale = isStale;
      const closedShiftId = shiftQuery.data?.id;
      const branchName = activeBranch?.name || "Sucursal";

      invalidateShiftState();

      if (wasStale) {
        toast.success("Turno expirado cerrado y depurado correctamente");
        if (closedShiftId) {
          triggerStaleShiftReport(closedShiftId, branchName);
        }
      } else {
        toast.success("Turno cerrado correctamente");
      }
    },
    onError: (err: any) => showShiftSetupError(err, setWarningDialog),
  });

  const loadZeroValueSpecialOrders = async () => {
    if (!activeBranchId) return [];

    const { data: openShiftRow, error: openShiftErr } = await supabase
      .from("cash_shifts")
      .select("id")
      .eq("branch_id", activeBranchId)
      .eq("status", "OPEN")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (openShiftErr) throw openShiftErr;
    const openShiftId = openShiftRow?.id as string | undefined;
    if (!openShiftId) return [];

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_code, order_number, status, paid_at, special_total_manual, total",
      )
      .eq("branch_id", activeBranchId)
      .eq("cash_shift_id", openShiftId)
      .eq("is_special", true)
      .not("status", "in", "(PAID,CANCELLED)");

    if (error) throw error;
    return ((data ?? []) as ZeroValueSpecialOrder[]).filter((order) => {
      const specialTotal =
        order.special_total_manual == null
          ? null
          : Number(order.special_total_manual);
      const orderTotal = order.total == null ? null : Number(order.total);
      const zeroValue = Number(specialTotal ?? orderTotal ?? 0) <= 0;
      const blocksShiftClose =
        order.status === "SENT_TO_KITCHEN" ||
        order.status === "READY" ||
        (order.status === "KITCHEN_DISPATCHED" && !order.paid_at);

      return zeroValue && blocksShiftClose;
    });
  };

  const handleCloseShiftClick = async () => {
    if (closeShiftMutation.isPending || checkingZeroValueSpecialOrders) return;

    if (isStale) {
      setShowStaleCleanupConfirm(true);
      return;
    }

    setCheckingZeroValueSpecialOrders(true);
    try {
      const specialOrders = await loadZeroValueSpecialOrders();

      if (specialOrders.length > 0) {
        setZeroValueSpecialOrders(specialOrders);
        setZeroSpecialCloseDialog(true);
        return;
      }

      closeShiftMutation.mutate();
    } catch (err: any) {
      showShiftSetupError(err, setWarningDialog);
    } finally {
      setCheckingZeroValueSpecialOrders(false);
    }
  };

  const handleContinueCloseWithZeroSpecialOrders = async () => {
    if (!activeBranchId || zeroValueSpecialOrders.length === 0) {
      setZeroSpecialCloseDialog(false);
      closeShiftMutation.mutate();
      return;
    }

    setPayingZeroValueSpecialOrders(true);
    try {
      for (const order of zeroValueSpecialOrders) {
        const { error } = await supabase.rpc("autopagar_orden_especial_cero_interna" as any, {
          p_order_id: order.id,
          p_actor_id: user?.id ?? null,
        });
        if (error) throw error;
      }

      invalidateOperationalOrderQueries(qc, {
        branchId: activeBranchId,
        includeTables: true,
        includeCompletedPayments: true,
      });

      toast.success("Ordenes especiales de $0 marcadas como pagadas");
      setZeroSpecialCloseDialog(false);
      setZeroValueSpecialOrders([]);
      closeShiftMutation.mutate();
    } catch (err: any) {
      showShiftSetupError(err, setWarningDialog);
    } finally {
      setPayingZeroValueSpecialOrders(false);
    }
  };

  if (!activeBranchId) {
    return (
      <div className="rounded-[24px] border border-orange-200 bg-white/80 p-4 text-sm text-muted-foreground shadow-sm">
        Selecciona una sucursal para administrar el turno.
      </div>
    );
  }

  const loading =
    branchSettingsQuery.isLoading ||
    shiftUsersQuery.isLoading ||
    shiftQuery.isLoading ||
    dispatchLoading ||
    cajaTemplatesQuery.isLoading ||
    (SHOW_SHIFT_CANCEL_POLICY_UI && cancelPolicyQuery.isLoading);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const saveShiftDisabledReason = isStale
    ? "Turno expirado: cierra el turno antes de guardar cambios."
    : hasSetupIssues
      ? setupIssues[0]
      : saveShiftMutation.isPending
        ? "Guardando..."
        : validatingCashierChangePassword
          ? "Validando contrasena..."
          : null;
  const isSaveShiftDisabled =
    Boolean(saveShiftDisabledReason) || !hasLocalChanges;

  const enabledViewLabels = enabledViews.map((view) => view.label);
  const shiftUsers = shiftUsersQuery.data ?? [];
  const latestShiftAudit = latestShiftAuditQuery.data;

  return (
    <>
      <div className="space-y-3 sm:space-y-4">
        <section className="rounded-[24px] border border-orange-200 bg-gradient-to-br from-white via-orange-50/70 to-amber-50/80 p-4 shadow-[0_22px_55px_-42px_rgba(249,115,22,0.55)] sm:rounded-[28px] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-orange-200 bg-white/90 text-primary shadow-sm">
                <PlayCircle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-black text-foreground sm:text-lg">
                  Configuracion del turno operativo
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge
                variant="outline"
                className={
                  shiftStatusUnresolved
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : isOpen
                      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                      : "border-orange-200 bg-orange-50 text-primary"
                }
              >
                {shiftStatusUnresolved
                  ? shiftQuery.isError
                    ? "No se pudo verificar"
                    : "Verificando turno…"
                  : isOpen
                    ? "Turno abierto"
                    : "Turno cerrado"}
              </Badge>
              {isOpen && (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-white/80 text-emerald-800"
                >
                  Apertura: {formatDateTime(shiftQuery.data?.opened_at)}
                </Badge>
              )}
              {isOpen && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCloseShiftClick}
                  disabled={
                    closeShiftMutation.isPending ||
                    checkingZeroValueSpecialOrders
                  }
                >
                  {closeShiftMutation.isPending ||
                  checkingZeroValueSpecialOrders ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  Cerrar turno
                </Button>
              )}
            </div>
          </div>

          {(shiftQuery.data as any)?.is_stale && isOpen && (
            <div className="mt-4 rounded-[20px] border border-red-200 bg-red-50/90 px-3 py-3 sm:rounded-[22px] sm:px-4">
              <div className="flex items-start gap-3 text-red-950">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
                <div className="space-y-1">
                  <p className="text-[1.05rem] font-black tracking-tight">
                    Turno expirado detectado (Día anterior)
                  </p>
                  <p className="text-sm leading-relaxed text-red-900/80 font-medium">
                    Este turno corresponde a una fecha anterior. Por seguridad,
                    todos los módulos operativos del sistema han sido
                    bloqueados.
                    <span className="block mt-1.5 font-bold">
                      Debes cerrar este turno para desbloquear la sucursal y
                      poder abrir un turno nuevo.
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {hasSetupIssues && (
            <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50/90 px-3 py-3 sm:rounded-[22px] sm:px-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-amber-900">
                    Faltan condiciones para abrir o guardar el turno
                  </p>
                  <ul className="space-y-1 text-sm text-amber-800">
                    {setupIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {!isOpen && latestShiftAudit?.status === "CLOSED" && (
            <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/90 px-3 py-3 text-sm text-slate-700 sm:rounded-[22px] sm:px-4">
              <p className="font-bold text-slate-900">
                Ultimo cierre registrado
              </p>
              <p className="mt-1">
                Cerrado: {formatDateTime(latestShiftAudit.closedAt)}
              </p>
              <p>
                Usuario:{" "}
                {latestShiftAudit.closedByName ||
                  latestShiftAudit.closedByUsername ||
                  "No identificado"}
              </p>
              <p>
                Equipo: {latestShiftAudit.closedFromDevice || "No registrado"}
              </p>
              {latestShiftAudit.notes ? (
                <p>Origen: {latestShiftAudit.notes}</p>
              ) : null}
            </div>
          )}
        </section>

        <div
          className={
            SHOW_SHIFT_CANCEL_POLICY_UI
              ? "grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"
              : "max-w-md"
          }
        >
          <div className="flex min-h-0 flex-col gap-4">
            <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-700">
                    <LayoutGrid className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-foreground sm:text-base">
                      Numero de mesas
                    </h4>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-100 via-white to-cyan-100 p-3.5 shadow-sm sm:p-4">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  Mesas habilitadas del turno
                </label>
                <NumericInput
                  value={activeTablesCount}
                  onValueChange={handleActiveTablesCountChange}
                  min={0}
                  disabled={isStale}
                  className="h-11 rounded-2xl text-center text-lg font-black sm:h-12 sm:text-xl xl:h-14 xl:text-2xl"
                />
              </div>
            </section>
          </div>

          {SHOW_SHIFT_CANCEL_POLICY_UI ? (
            <BranchCancelPolicyEditor
              rows={cancelPolicyState}
              isGlobalAdmin={isGlobalAdmin}
              disabled={
                isStale ||
                openShiftMutation.isPending ||
                saveShiftMutation.isPending
              }
              onChange={updateCancelPolicy}
              className="h-full"
            />
          ) : null}
        </div>

        <section className="rounded-[22px] border border-orange-200 bg-white/88 p-4 shadow-sm sm:rounded-[26px] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-violet-700">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-black text-foreground sm:text-base">
                  Usuarios habilitados
                </h4>
              </div>
            </div>
            <Badge
              variant="outline"
              className="border-violet-200 bg-violet-50 text-violet-700"
            >
              {enabledUserIds.length} de {shiftUsers.length} habilitados
            </Badge>
          </div>

          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 p-3.5 shadow-sm sm:p-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-violet-700">
                    Agregar usuario al turno
                  </label>
                  <select
                    value={selectedUserToAdd}
                    onChange={(event) =>
                      setSelectedUserToAdd(event.target.value)
                    }
                    disabled={isStale}
                    className="h-12 w-full rounded-2xl border border-violet-200 bg-white px-4 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-violet-400 disabled:opacity-50"
                  >
                    <option value="">
                      Selecciona un usuario de esta sucursal...
                    </option>
                    {availableUsersToAdd.map((branchUser) => (
                      <option
                        key={branchUser.user_id}
                        value={branchUser.user_id}
                      >
                        {getUserAlias(branchUser) || "Usuario"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <Button
                    type="button"
                    onClick={addSelectedUser}
                    disabled={
                      isStale || !selectedUserToAdd || checkingUserToAdd
                    }
                    className="h-11 w-full gap-2 rounded-2xl xl:h-12 xl:w-auto"
                  >
                    {checkingUserToAdd ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Agregar
                  </Button>
                </div>
              </div>

              {availableUsersToAdd.length === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Todos los usuarios activos de esta sucursal ya fueron
                  agregados al turno.
                </p>
              )}
            </div>

            {shiftUsersState.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/50 px-4 py-8 text-center text-sm text-violet-800">
                Todavia no has agregado usuarios a este turno.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {shiftUsersState.map((branchUser) => {
                  const userState = shiftUsersState.find(
                    (u) => u.user_id === branchUser.user_id,
                  );
                  const isSupervisorLocked =
                    !!userState?.is_supervisor && isOpen;

                  return (
                    <div
                      key={branchUser.user_id}
                      className="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-3 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-bold text-foreground">
                            {getUserAlias(branchUser) || "Usuario"}
                          </p>
                          {userState?.is_supervisor && (
                            <Badge
                              variant="outline"
                              className="h-5 shrink-0 border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] leading-none text-amber-800"
                            >
                              Supervisor
                            </Badge>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={isStale || isSupervisorLocked}
                          className="h-7 w-7 shrink-0 rounded-md text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => toggleUser(branchUser.user_id, false)}
                          title={
                            isSupervisorLocked
                              ? "No puedes quitar al supervisor del turno abierto"
                              : "Quitar usuario del turno"
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="mt-2.5 grid grid-cols-3 gap-x-2 gap-y-2 rounded-lg border border-violet-100 bg-white/60 px-2.5 py-2.5">
                        <label className="flex min-w-0 items-center gap-1.5 text-xs leading-snug">
                          <Checkbox
                            className="h-4 w-4"
                            checked={userState?.can_serve_tables ?? false}
                            disabled={isStale}
                            onCheckedChange={(c) =>
                              updateUserRole(
                                branchUser.user_id,
                                "can_serve_tables",
                                c === true,
                              )
                            }
                          />
                          <span className="min-w-0 truncate text-muted-foreground">
                            Venta
                          </span>
                        </label>

                        <label className="flex min-w-0 items-center gap-1.5 text-xs leading-snug">
                          <Checkbox
                            className="h-4 w-4"
                            checked={userState?.can_dispatch_orders ?? false}
                            disabled={isStale}
                            onCheckedChange={(c) =>
                              updateUserRole(
                                branchUser.user_id,
                                "can_dispatch_orders",
                                c === true,
                              )
                            }
                          />
                          <span className="min-w-0 truncate text-muted-foreground">
                            Despacho
                          </span>
                        </label>

                        <label className="flex min-w-0 items-center gap-1.5 text-xs leading-snug">
                          <Checkbox
                            className="h-4 w-4"
                            checked={userState?.can_serve_plates ?? false}
                            disabled={isStale}
                            onCheckedChange={(c) =>
                              updateUserRole(
                                branchUser.user_id,
                                "can_serve_plates",
                                c === true,
                              )
                            }
                          />
                          <span className="min-w-0 truncate text-muted-foreground">
                            Servir
                          </span>
                        </label>

                        <label
                          className="flex min-w-0 items-center gap-1.5 text-xs leading-snug"
                          title="Permiso de Empacador (solo uno por turno)"
                        >
                          <Checkbox
                            className="h-4 w-4"
                            checked={userState?.can_pack_orders ?? false}
                            disabled={isStale}
                            onCheckedChange={(c) =>
                              updateUserRole(
                                branchUser.user_id,
                                "can_pack_orders",
                                c === true,
                              )
                            }
                          />
                          <span className="min-w-0 truncate text-muted-foreground">
                            Empacador
                          </span>
                        </label>

                        <label
                          className="col-span-2 flex min-w-0 items-center gap-1.5 text-xs leading-snug"
                          title="Permite acceder al sistema en dos dispositivos a la vez"
                        >
                          <Checkbox
                            className="h-4 w-4"
                            checked={userState?.can_double_session ?? false}
                            disabled={isStale}
                            onCheckedChange={(c) =>
                              updateUserRole(
                                branchUser.user_id,
                                "can_double_session",
                                c === true,
                              )
                            }
                          />
                          <span className="min-w-0 truncate text-muted-foreground">
                            Sesión doble
                          </span>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <ShiftCajaSetupSection
          enabledUsers={cajaSetupUserOptions}
          templates={cajaTemplatesQuery.data ?? []}
          value={shiftCajaSetup}
          onChange={handleShiftCajaSetupChange}
          disabled={
            isStale ||
            openShiftMutation.isPending ||
            saveShiftMutation.isPending
          }
        />

        <section className="rounded-[22px] border border-orange-200 bg-gradient-to-r from-white via-orange-50 to-amber-50 p-4 shadow-sm sm:rounded-[26px]">
          <div className="flex flex-col items-stretch gap-2 md:items-end">
            {isOpen ? (
              <>
                <span
                  title={saveShiftDisabledReason ?? undefined}
                  className={`inline-flex w-full md:w-auto ${isSaveShiftDisabled ? "cursor-not-allowed" : ""}`}
                >
                  <Button
                    variant="secondary"
                    onClick={handleSaveShiftClick}
                    disabled={isSaveShiftDisabled}
                    className="h-12 w-full md:w-auto"
                  >
                    {saveShiftMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Guardar
                  </Button>
                </span>
                {isSaveShiftDisabled && saveShiftDisabledReason ? (
                  <p className="text-xs font-medium text-amber-900 md:text-right">
                    {saveShiftDisabledReason}
                  </p>
                ) : hasLocalChanges ? (
                  <p className="text-xs text-muted-foreground md:text-right">
                    Hay cambios sin guardar.
                  </p>
                ) : null}
              </>
            ) : (
              <Button
                onClick={() => openShiftMutation.mutate()}
                disabled={hasSetupIssues || openShiftMutation.isPending}
                className="h-12 w-full md:w-auto"
              >
                {openShiftMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                Abrir turno
              </Button>
            )}
          </div>
        </section>
      </div>

      <Dialog
        open={cashierChangeDialogOpen}
        onOpenChange={(open) => {
          if (validatingCashierChangePassword || saveShiftMutation.isPending)
            return;
          setCashierChangeDialogOpen(open);
          if (!open) {
            setCashierChangePassword("");
            setCashierChangePasswordError("");
          }
        }}
      >
        <DialogContent className="max-w-md rounded-[24px] border border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-50 p-5 shadow-[0_30px_80px_-42px_rgba(245,158,11,0.55)]">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-black text-amber-950">
              Confirmar cambio de configuracion de caja
            </DialogTitle>
            <DialogDescription className="space-y-2 text-sm leading-6 text-amber-900/80">
              <span className="block">
                Se va a modificar la configuracion de caja del turno abierto.
                Confirma con la contrasena del usuario logueado.
              </span>
              <span className="block font-semibold text-amber-950">
                Usuario logueado: {loggedUserName}
              </span>
              <span className="block font-semibold text-amber-950">
                Actual: {cashierChangeSummary.previous}
              </span>
              <span className="block font-semibold text-amber-950">
                Nuevo: {cashierChangeSummary.next}
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label
              htmlFor="cashier-change-password"
              className="text-xs font-bold uppercase tracking-[0.16em] text-amber-800"
            >
              Ingrese su contrasena para confirmar
            </Label>
            <Input
              id="cashier-change-password"
              type="password"
              value={cashierChangePassword}
              onChange={(event) => {
                setCashierChangePassword(event.target.value);
                setCashierChangePasswordError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleConfirmCashierChange();
                }
              }}
              autoComplete="current-password"
              disabled={
                validatingCashierChangePassword || saveShiftMutation.isPending
              }
              className="h-11 rounded-2xl border-amber-200 bg-white"
            />
            {cashierChangePasswordError ? (
              <p className="text-sm font-medium text-red-700">
                {cashierChangePasswordError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={
                validatingCashierChangePassword || saveShiftMutation.isPending
              }
              onClick={() => setCashierChangeDialogOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                validatingCashierChangePassword || saveShiftMutation.isPending
              }
              onClick={() => void handleConfirmCashierChange()}
              className="w-full bg-orange-600 text-white hover:bg-orange-700 sm:w-auto"
            >
              {validatingCashierChangePassword ||
              saveShiftMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Confirmar y guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={zeroSpecialCloseDialog}
        onOpenChange={(open) => {
          if (payingZeroValueSpecialOrders || closeShiftMutation.isPending)
            return;
          setZeroSpecialCloseDialog(open);
        }}
      >
        <AlertDialogContent className="max-w-md rounded-[24px] border border-orange-200 bg-gradient-to-br from-white via-orange-50 to-amber-50 p-5 shadow-[0_30px_80px_-42px_rgba(249,115,22,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-black text-orange-950">
              Ordenes especiales con valor $0
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-orange-900/80">
              Existen {zeroValueSpecialOrders.length} orden(es) especiales con
              valor $0. Para cerrar el turno, el sistema puede marcarlas como
              pagadas automaticamente y continuar con el cierre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel
              disabled={
                payingZeroValueSpecialOrders || closeShiftMutation.isPending
              }
              className="w-full sm:w-auto"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                payingZeroValueSpecialOrders || closeShiftMutation.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                handleContinueCloseWithZeroSpecialOrders();
              }}
              className="w-full bg-orange-600 text-white hover:bg-orange-700 sm:w-auto"
            >
              {payingZeroValueSpecialOrders || closeShiftMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              Continuar cierre
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={warningDialog.open}
        onOpenChange={(open) => setWarningDialog((prev) => ({ ...prev, open }))}
      >
        <AlertDialogContent className="max-w-lg rounded-[24px] border border-amber-200 bg-gradient-to-br from-white via-amber-50 to-orange-50 p-5 shadow-[0_30px_80px_-42px_rgba(245,158,11,0.55)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-black text-amber-950">
              {warningDialog.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-[50vh] overflow-y-auto whitespace-pre-line text-sm leading-6 text-amber-900/80">
                {warningDialog.description}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() =>
                setWarningDialog({ open: false, title: "", description: "" })
              }
              className="w-full sm:w-auto"
            >
              Aceptar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={showStaleCleanupConfirm}
        onOpenChange={setShowStaleCleanupConfirm}
      >
        <AlertDialogContent className="max-w-md rounded-[26px] border border-amber-200 bg-gradient-to-br from-white via-amber-50/30 to-orange-50/30 p-6 shadow-[0_24px_64px_-32px_rgba(245,158,11,0.5)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-3 text-xl font-bold text-amber-950">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              Cierre y limpieza de turno
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4 pt-2 text-sm leading-relaxed text-amber-900/80">
              <p>
                Este turno pertenece a un día anterior. Para proceder con el
                cierre, el sistema realizará una{" "}
                <strong>limpieza automática</strong> de los datos pendientes:
              </p>
              <ul className="list-disc space-y-2 pl-4 font-medium">
                <li>
                  Eliminación de órdenes <strong>borrador</strong> y{" "}
                  <strong>en caja</strong>.
                </li>
                <li>
                  Despacho y cierre de órdenes <strong>pagadas</strong>.
                </li>
                <li>
                  Cierre administrativo de órdenes <strong>pendientes</strong>.
                </li>
                <li>
                  Cierre automático de la <strong>caja operativa</strong> y
                  generación de reporte.
                </li>
              </ul>
              <p className="text-xs italic text-amber-700/70">
                Esta acción es irreversible y necesaria para desbloquear la
                sucursal.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 flex-col gap-2 sm:flex-row">
            <Button
              variant="ghost"
              onClick={() => setShowStaleCleanupConfirm(false)}
              className="w-full rounded-xl hover:bg-amber-100/50 sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setShowStaleCleanupConfirm(false);
                closeShiftMutation.mutate();
              }}
              disabled={closeShiftMutation.isPending}
              className="w-full gap-2 rounded-xl bg-amber-600 shadow-lg shadow-amber-600/20 hover:bg-amber-700 sm:w-auto"
            >
              {closeShiftMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
              Confirmar limpieza y cierre
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ShiftSetupAdmin;
