import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getUserDisplayName } from "@/lib/userDisplay";
import { cn } from "@/lib/utils";
import {
  MonitorCheck,
  Building2,
  Users,
  AlertCircle,
  Loader2,
  Clock,
  ShieldCheck,
  CreditCard,
  Truck,
  UtensilsCrossed,
  XCircle,
  RefreshCw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: string;
  name: string;
  address: string | null;
}

interface CashShift {
  id: string;
  branch_id: string;
  status: "OPEN" | "CLOSED";
  opened_at: string | null;
  closed_at: string | null;
  primary_cashier_id: string | null;
}

interface ShiftUser {
  id: string;
  shift_id: string;
  user_id: string;
  is_enabled: boolean;
  register_role: "PRIMARY" | "SECONDARY" | null;
  can_use_caja: boolean;
  can_dispatch_orders: boolean;
  can_serve_tables: boolean;
  is_supervisor: boolean;
  is_online: boolean;
  is_in_caja: boolean;
  profile_name: string | null;
}

interface OrderRow {
  id: string;
  branch_id: string;
  cash_shift_id: string | null;
  order_type: "DINE_IN" | "TABLE" | "TAKEOUT" | "EXPRESS" | "EXTRA";
  status: string;
  notes: string | null;
  order_code: string | null;
  paid_at: string | null;
  is_special: boolean;
}

interface BranchMonitorData {
  shift: CashShift | null;
  users: ShiftUser[];
  orders: OrderRow[];
  primaryCashierName: string | null;
  isLoading: boolean;
}

type MonitorState = Record<string, BranchMonitorData>;

// ─── Helper: format date ───────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-EC", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

// ─── Order Funnel Counts ───────────────────────────────────────────────────────

type OrderType = "DINE_IN" | "TAKEOUT" | "EXPRESS" | "EXTRA" | "SPECIAL";

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  DINE_IN: "Mesa",
  TAKEOUT: "Para llevar",
  EXPRESS: "Express",
  EXTRA: "Extra",
  SPECIAL: "Especial",
};

interface FunnelCounts {
  generadas: number;
  enCaja: number;
  pagadas: number;
  despachadas: number;
  anuladas: number;
}

function computeFunnel(orders: OrderRow[]): Record<OrderType, FunnelCounts> {
  const empty = (): FunnelCounts => ({
    generadas: 0,
    enCaja: 0,
    pagadas: 0,
    despachadas: 0,
    anuladas: 0,
  });

  const result: Record<OrderType, FunnelCounts> = {
    DINE_IN: empty(),
    TAKEOUT: empty(),
    EXPRESS: empty(),
    EXTRA: empty(),
    SPECIAL: empty(),
  };

  for (const order of orders) {
    // Normalize TABLE → DINE_IN for display
    let rawType = order.order_type === "TABLE" ? "DINE_IN" : order.order_type;
    if (order.is_special) {
      rawType = "SPECIAL";
    }
    
    if (!(rawType in result)) continue;
    const type = rawType as OrderType;
    const counts = result[type];

    const st = order.status?.toUpperCase();

    // Ensure mutual exclusion so an order only appears in one stage of the funnel
    if (st === "CANCELLED" && String(order.notes ?? "").includes("VOID_SUCCESSOR_ORDER")) {
      counts.anuladas++;
    } else if (st === "KITCHEN_DISPATCHED") {
      counts.despachadas++;
    } else if (st === "PAID" || order.paid_at) {
      counts.pagadas++;
    } else if ((st === "SENT_TO_KITCHEN" || st === "READY") && order.order_code) {
      counts.enCaja++;
    } else if (st !== "DRAFT" && type === "EXPRESS") {
      // Generadas: everything except pure draft. Per user request, only show for EXPRESS.
      counts.generadas++;
    }
  }

  return result;
}

// ─── Sub-Components ────────────────────────────────────────────────────────────

function PermBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        color,
      )}
    >
      {label}
    </span>
  );
}

function ShiftStatusHeader({
  shift,
  primaryCashierName,
  branchName,
}: {
  shift: CashShift | null;
  primaryCashierName: string | null;
  branchName: string;
}) {
  const isOpen = shift?.status === "OPEN";

  return (
    <div
      className={cn(
        "flex items-start justify-between rounded-2xl px-4 py-3",
        isOpen
          ? "bg-emerald-500/10 dark:bg-emerald-500/15"
          : "bg-slate-100 dark:bg-slate-800/50",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
            isOpen
              ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40"
              : "bg-slate-200 text-slate-500 dark:bg-slate-700",
          )}
        >
          <Building2 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {branchName}
          </p>
          <div className="flex items-center gap-1.5">
            {isOpen ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  Turno Abierto
                </span>
              </>
            ) : (
              <span className="text-sm font-bold text-slate-500">
                Turno Cerrado
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="text-right">
        {isOpen && shift?.opened_at && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            <span>{formatDateTime(shift.opened_at)}</span>
          </div>
        )}
        {primaryCashierName && (
          <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            Cajero: {primaryCashierName}
          </p>
        )}
      </div>
    </div>
  );
}

function ShiftUsersPanel({ users, shift }: { users: ShiftUser[]; shift: CashShift | null }) {
  if (users.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground italic">
        Sin usuarios habilitados en este turno
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {users.map((u) => (
        <div key={u.id} className="flex flex-wrap items-center gap-1.5">
          <div className="relative flex items-center gap-1">
            <span
              className={`flex h-2 w-2 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-950 ${
                u.is_online ? "bg-emerald-500" : "bg-red-500"
              }`}
              title={u.is_online ? "En línea" : "Desconectado"}
            ></span>
            <span className="text-sm font-semibold text-foreground">
              {u.profile_name ?? "Usuario"}
            </span>
            {u.is_in_caja && (
              <span className="ml-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-sm border border-emerald-200 dark:border-emerald-800" title="Usando caja activa">
                En Caja
              </span>
            )}
          </div>
          {u.can_use_caja && (
            <PermBadge
              label={shift?.primary_cashier_id === u.user_id ? "Caja Principal" : "Caja Secundaria"}
              color={
                shift?.primary_cashier_id === u.user_id
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-bold"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }
            />
          )}
          {u.can_dispatch_orders && (
            <PermBadge
              label="Despacho"
              color="bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300"
            />
          )}
          {u.can_serve_tables && (
            <PermBadge
              label="Mesas"
              color="bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300"
            />
          )}
          {u.is_supervisor && (
            <PermBadge
              label="Supervisor"
              color="bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function OrderFunnelMatrix({ orders }: { orders: OrderRow[] }) {
  const funnel = useMemo(() => computeFunnel(orders), [orders]);
  const types: OrderType[] = ["DINE_IN", "TAKEOUT", "EXPRESS", "EXTRA", "SPECIAL"];

  const colHeaders = [
    { label: "Generadas", icon: <UtensilsCrossed className="h-3 w-3" />, className: "text-slate-600 dark:text-slate-400" },
    { label: "En Caja", icon: <CreditCard className="h-3 w-3" />, className: "text-blue-600 dark:text-blue-400" },
    { label: "Pagadas", icon: <ShieldCheck className="h-3 w-3" />, className: "text-emerald-600 dark:text-emerald-400" },
    { label: "Despachadas", icon: <Truck className="h-3 w-3" />, className: "text-orange-600 dark:text-orange-400" },
    { label: "Anuladas", icon: <XCircle className="h-3 w-3" />, className: "text-red-600 dark:text-red-400" },
  ] as const;

  const totalRow = useMemo(() => {
    const tot: FunnelCounts = { generadas: 0, enCaja: 0, pagadas: 0, despachadas: 0, anuladas: 0 };
    for (const t of types) {
      tot.generadas += funnel[t].generadas;
      tot.enCaja += funnel[t].enCaja;
      tot.pagadas += funnel[t].pagadas;
      tot.despachadas += funnel[t].despachadas;
      tot.anuladas += funnel[t].anuladas;
    }
    return tot;
  }, [funnel]);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[380px] text-xs">
        <thead>
          <tr className="border-b border-slate-100 dark:border-slate-800">
            <th className="pb-1.5 pr-3 text-left font-semibold text-muted-foreground">
              Tipo
            </th>
            {colHeaders.map((col) => (
              <th key={col.label} className={cn("pb-1.5 text-center font-semibold", col.className)}>
                <span className="flex items-center justify-center gap-0.5">
                  {col.icon}
                  <span className="hidden sm:inline">{col.label}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => {
            const counts = funnel[type];
            const hasAny = counts.generadas > 0;
            return (
              <tr
                key={type}
                className={cn(
                  "border-b border-slate-50 dark:border-slate-800/50 transition-colors",
                  hasAny ? "" : "opacity-40",
                )}
              >
                <td className="py-1.5 pr-3 font-semibold text-slate-700 dark:text-slate-300">
                  {ORDER_TYPE_LABELS[type]}
                </td>
                <td className="py-1.5 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                  {counts.generadas || "—"}
                </td>
                <td className="py-1.5 text-center font-mono font-bold text-blue-700 dark:text-blue-400">
                  {counts.enCaja || "—"}
                </td>
                <td className="py-1.5 text-center font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {counts.pagadas || "—"}
                </td>
                <td className="py-1.5 text-center font-mono font-bold text-orange-700 dark:text-orange-400">
                  {counts.despachadas || "—"}
                </td>
                <td className="py-1.5 text-center font-mono font-bold text-red-700 dark:text-red-400">
                  {counts.anuladas > 0 ? (
                    <span className="inline-flex items-center gap-0.5">
                      <AlertCircle className="h-3 w-3" />
                      {counts.anuladas}
                    </span>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
          {/* Total row */}
          <tr className="border-t-2 border-slate-200 dark:border-slate-700 font-black">
            <td className="pt-2 pr-3 text-xs font-black uppercase tracking-wider text-muted-foreground">
              Total
            </td>
            <td className="pt-2 text-center font-mono text-slate-900 dark:text-slate-100">{totalRow.generadas || "—"}</td>
            <td className="pt-2 text-center font-mono text-blue-800 dark:text-blue-300">{totalRow.enCaja || "—"}</td>
            <td className="pt-2 text-center font-mono text-emerald-800 dark:text-emerald-300">{totalRow.pagadas || "—"}</td>
            <td className="pt-2 text-center font-mono text-orange-800 dark:text-orange-300">{totalRow.despachadas || "—"}</td>
            <td className="pt-2 text-center font-mono text-red-800 dark:text-red-300">
              {totalRow.anuladas > 0 ? (
                <span className="inline-flex items-center justify-center gap-0.5">
                  <AlertCircle className="h-3 w-3" />
                  {totalRow.anuladas}
                </span>
              ) : "—"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BranchCard({ branch, data }: { branch: Branch; data: BranchMonitorData }) {
  if (data.isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-[28px] border border-slate-200 bg-white shadow-md dark:border-slate-700 dark:bg-card">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_8px_32px_-16px_rgba(15,23,42,0.18)] transition-shadow hover:shadow-[0_16px_42px_-16px_rgba(15,23,42,0.28)] dark:border-slate-700 dark:bg-card">
      {/* Shift status header */}
      <div className="p-4 pb-0">
        <ShiftStatusHeader
          shift={data.shift}
          primaryCashierName={data.primaryCashierName}
          branchName={branch.name}
        />
      </div>

      {data.shift?.status === "OPEN" ? (
        <>
          {/* Users panel */}
          <div className="px-4 pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Usuarios habilitados ({data.users.length})
              </p>
            </div>
            <ShiftUsersPanel users={data.users} shift={data.shift} />
          </div>

          {/* Order funnel matrix */}
          <div className="p-4 pt-4">
            <div className="mb-2 flex items-center gap-2">
              <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Embudo de órdenes
              </p>
              <span className="ml-auto text-[10px] font-semibold text-muted-foreground">
                {data.orders.length} total
              </span>
            </div>
            <OrderFunnelMatrix orders={data.orders} />
          </div>
        </>
      ) : (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No hay turno activo en esta sucursal.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Hook: useGlobalMonitor ───────────────────────────────────────────────

function useGlobalMonitor(branches: Branch[]) {
  const [state, setState] = useState<MonitorState>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load data for a single branch using supabase directly to avoid dbSelect RLS/type issues
  const loadBranchData = async (branch: Branch): Promise<BranchMonitorData> => {
    // 1. Open shift — query directly to ensure cross-branch visibility for global admin
    const { data: shiftRows, error: shiftErr } = await supabase
      .from("cash_shifts" as any)
      .select("id, branch_id, status, opened_at, closed_at, primary_cashier_id")
      .eq("branch_id", branch.id)
      .eq("status", "OPEN")
      .order("opened_at", { ascending: false })
      .limit(1);

    if (shiftErr) {
      console.warn(`[MonitoreoGlobal] Error loading shift for branch ${branch.name}:`, shiftErr.message);
    }

    const shift: CashShift | null = (shiftRows as any[])?.[0] ?? null;

    if (!shift) {
      return { shift: null, users: [], orders: [], primaryCashierName: null, isLoading: false };
    }

    // 2. Shift users — join profiles inline using select syntax
    const { data: shiftUserRows, error: usersErr } = await supabase
      .from("cash_shift_users" as any)
      .select("id,shift_id,user_id,is_enabled,can_use_caja,can_dispatch_orders,can_serve_tables,is_supervisor,last_session_id,secondary_session_id,profiles(id,alias,username,current_app_session_id)")
      .eq("shift_id", shift.id);

    if (usersErr) {
      console.warn(`[MonitoreoGlobal] Error loading shift users for branch ${branch.name}:`, usersErr.message);
    }

    const users: ShiftUser[] = ((shiftUserRows as any[]) ?? [])
      .filter((u: any) => u.is_enabled === true || u.is_enabled === 1 || u.is_enabled === "true" || u.is_enabled === "t")
      .map((u: any) => {
      const profile = Array.isArray(u.profiles) ? u.profiles[0] : u.profiles;
      const name = getUserDisplayName(profile);
      return {
        id: u.id,
        shift_id: u.shift_id,
        user_id: u.user_id,
        is_enabled: Boolean(u.is_enabled),
        register_role: u.register_role ?? null,
        can_use_caja: Boolean(u.can_use_caja),
        can_dispatch_orders: Boolean(u.can_dispatch_orders),
        can_serve_tables: Boolean(u.can_serve_tables),
        is_supervisor: Boolean(u.is_supervisor),
        is_online: !!profile?.current_app_session_id,
        is_in_caja: !!u.last_session_id || !!u.secondary_session_id,
        profile_name: name,
      };
    });

    // Resolve primary cashier name
    const primaryUser = users.find((u) => u.register_role === "PRIMARY") ?? null;
    let primaryCashierName = primaryUser?.profile_name ?? null;

    // Fallback: fetch cashier by primary_cashier_id if not found via shift users
    if (!primaryCashierName && shift.primary_cashier_id) {
      const { data: cashierRows } = await supabase
        .from("profiles" as any)
        .select("id, alias, username")
        .eq("id", shift.primary_cashier_id)
        .limit(1);
      const cashier = (cashierRows as any[])?.[0];
      if (cashier) {
        primaryCashierName = getUserDisplayName(cashier);
      }
    }

    // 3. Orders for this shift — query directly
    const { data: orderRows, error: ordersErr } = await supabase
      .from("orders" as any)
      .select("id, branch_id, cash_shift_id, order_type, status, notes, order_code, paid_at, is_special")
      .eq("cash_shift_id", shift.id);

    if (ordersErr) {
      console.warn(`[MonitoreoGlobal] Error loading orders for branch ${branch.name}:`, ordersErr.message);
    }

    return {
      shift,
      users,
      orders: ((orderRows as any[]) ?? []) as OrderRow[],
      primaryCashierName,
      isLoading: false,
    };
  };

  // Initialize: load all branches
  useEffect(() => {
    if (branches.length === 0) return;

    // Set all as loading
    setState(
      Object.fromEntries(branches.map((b) => [b.id, { shift: null, users: [], orders: [], primaryCashierName: null, isLoading: true }]))
    );

    // Load each branch concurrently
    void Promise.all(
      branches.map(async (branch) => {
        const data = await loadBranchData(branch);
        setState((prev) => ({ ...prev, [branch.id]: data }));
      })
    );
  }, [branches.map((b) => b.id).join(",")]);

  // Realtime subscription
  useEffect(() => {
    if (branches.length === 0) return;

    // Debounce: avoid rapid-fire reloads when many events arrive at once
    const pendingReloads = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReload = (branchId: string) => {
      console.log(`[MonitoreoGlobal] Scheduling reload for branch: ${branchId}`);
      pendingReloads.add(branchId);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const toReload = [...pendingReloads];
        pendingReloads.clear();
        debounceTimer = null;

        await Promise.all(
          toReload.map(async (bId) => {
            const branch = branches.find((b) => b.id === bId);
            if (!branch) return;
            const data = await loadBranchData(branch);
            setState((prev) => ({ ...prev, [bId]: data }));
          })
        );
      }, 1200);
    };

    // When we receive an event, find which branch it belongs to
    const handleCashShiftEvent = (payload: any) => {
      const branchId = payload.new?.branch_id ?? payload.old?.branch_id;
      if (!branchId) {
        branches.forEach((b) => scheduleReload(b.id));
        return;
      }
      if (branches.some((b) => b.id === branchId)) scheduleReload(branchId);
    };

    const handleCashShiftUserEvent = (payload: any) => {
      branches.forEach((b) => scheduleReload(b.id));
    };

    const handleOrderEvent = (payload: any) => {
      const branchId = payload.new?.branch_id ?? payload.old?.branch_id;
      if (!branchId || !branches.some((b) => b.id === branchId)) return;
      scheduleReload(branchId);
    };

    const handleProfileEvent = (payload: any) => {
      console.log("[MonitoreoGlobal] Realtime profile update:", payload);
      branches.forEach((b) => scheduleReload(b.id));
    };

    const uniqueChannelName = `global-monitor-${Math.random().toString(36).substring(7)}`;
    const channel = supabase
      .channel(uniqueChannelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_shifts" }, handleCashShiftEvent)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_shift_users" }, handleCashShiftUserEvent)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, handleOrderEvent)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, handleProfileEvent)
      .subscribe((status) => {
        console.log("[MonitoreoGlobal] Realtime status:", status);
      });

    channelRef.current = channel;

    // Robust fallback: auto-refresh every 15 seconds
    const fallbackInterval = setInterval(() => {
      branches.forEach((b) => scheduleReload(b.id));
    }, 15000);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(fallbackInterval);
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [branches.map((b) => b.id).join(",")]);

  const forceReloadAll = () => {
    setState(
      Object.fromEntries(branches.map((b) => [b.id, { shift: null, users: [], orders: [], primaryCashierName: null, isLoading: true }]))
    );
    branches.forEach(async (branch) => {
      const data = await loadBranchData(branch);
      setState((prev) => ({ ...prev, [branch.id]: data }));
    });
  };

  return { state, forceReloadAll };
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const MonitoreoGlobal = () => {
  const { isGlobalAdmin, branches } = useBranch();

  // Security guard — double layer (ProtectedRoute is the first)
  if (!isGlobalAdmin) {
    return <Navigate to="/" replace />;
  }

  const { state: monitorState, forceReloadAll } = useGlobalMonitor(branches);

  const sortedBranches = useMemo(() => {
    return [...branches].sort((a, b) => {
      const shiftA = monitorState[a.id]?.shift;
      const shiftB = monitorState[b.id]?.shift;

      if (shiftA && shiftB) {
        return new Date(shiftA.opened_at).getTime() - new Date(shiftB.opened_at).getTime();
      }
      if (shiftA && !shiftB) return -1;
      if (!shiftA && shiftB) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [branches, monitorState]);

  return (
    <div className="px-2 py-3 sm:px-4 md:px-5 md:py-4 lg:px-6">
      {/* Header */}
      <div className="surface-glow mb-6 px-3 py-3 sm:px-5 sm:py-4">
        <div className="relative flex flex-wrap items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-indigo-200 bg-white/90 text-indigo-600 shadow-sm dark:border-indigo-800 dark:bg-indigo-950/30">
            <MonitorCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
              Monitoreo Global de Turnos
            </h1>
            <p className="text-xs font-medium text-muted-foreground sm:text-sm">
              Visión general de las operaciones en todas las sucursales
            </p>
          </div>
          <div className="ml-auto flex items-center">
            <button
              onClick={forceReloadAll}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white dark:bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Actualizar</span>
            </button>
          </div>
          
          {/* Realtime indicator */}
          <div className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 dark:border-emerald-800 dark:bg-emerald-950/30">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              En vivo
            </span>
          </div>
        </div>
      </div>

      {/* Column headers legend */}
      <div className="mb-4 flex flex-wrap items-center gap-3 px-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Leyenda embudo:
        </span>
        {[
          { label: "Generadas", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
          { label: "En Caja", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
          { label: "Pagadas", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
          { label: "Despachadas", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
          { label: "Anuladas (⚠️)", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
        ].map((item) => (
          <span
            key={item.label}
            className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold", item.color)}
          >
            {item.label}
          </span>
        ))}
      </div>

      {/* Branch grid */}
      {branches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Building2 className="mb-3 h-12 w-12 text-muted-foreground/40" />
          <p className="font-display text-lg font-bold text-foreground">
            Sin sucursales activas
          </p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            No hay sucursales activas registradas en el sistema.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {sortedBranches.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              data={monitorState[branch.id] ?? { shift: null, users: [], orders: [], primaryCashierName: null, isLoading: true }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default MonitoreoGlobal;
