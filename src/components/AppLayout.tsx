import { useState, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { purgeEmptyDineInTableDraftOnLeave } from "@/hooks/useOrder";
import { Building2, KeyRound, LogOut, RefreshCw, UserRound, WifiOff, Menu } from "lucide-react";
import BottomNav from "./BottomNav";
import SidebarNav from "./SidebarNav";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { AutopedidosQrBadgeButton, AutopedidosQrPanel } from "@/components/autopedidos/AutopedidosQrPanel";

import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useTheme } from "@/hooks/useTheme";
import { useHubRealtimeStatus } from "@/lib/queryEgress";
import { OrderReadyAlertCenter } from "@/hooks/useMeseroOrderReadyNotification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MobileMenuSheet } from "./MobileMenuSheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getUserDisplayName, getUserRealName } from "@/lib/userDisplay";
import { CashReportViewer } from "@/components/caja/CashReportViewer";

const AppLayout = () => {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [autopedidosOpen, setAutopedidosOpen] = useState(false);
  const location = useLocation();
  const qc = useQueryClient();
  const ordenesLeaveRef = useRef<{ orderId: string; skipPurge: boolean } | null>(null);
  const { signOut, profile } = useAuth();

  /** En /ordenes solo importa pathname: si la key incluye ?order=…, cada cambio de URL remonta todo y el menú parpadea (mesa libre optimista → id real). */
  const mainOutletKey =
    location.pathname === "/ordenes" ? location.pathname : `${location.pathname}${location.search}`;

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  /** Purga al salir de /ordenes o al cambiar de orden; no dependemos del remount del Outlet. */
  useEffect(() => {
    const isOrdenes = location.pathname === "/ordenes";
    const params = new URLSearchParams(location.search);
    const currentOrderId = params.get("order");
    const skipPurge = params.get("from") === "editar";

    const prev = ordenesLeaveRef.current;

    if (isOrdenes) {
      if (prev?.orderId && prev.orderId !== currentOrderId && !prev.skipPurge) {
        void purgeEmptyDineInTableDraftOnLeave(qc, prev.orderId);
      }
      if (currentOrderId) {
        ordenesLeaveRef.current = { orderId: currentOrderId, skipPurge };
      } else {
        if (prev?.orderId && !prev.skipPurge) {
          void purgeEmptyDineInTableDraftOnLeave(qc, prev.orderId);
        }
        ordenesLeaveRef.current = null;
      }
      return;
    }

    if (prev?.orderId && !prev.skipPurge) {
      void purgeEmptyDineInTableDraftOnLeave(qc, prev.orderId);
    }
    ordenesLeaveRef.current = null;
  }, [location.pathname, location.search, qc]);
  const { activeBranch, activeBranchId, branches, setActiveBranch, loading } = useBranch();
  const { isOnline } = useNetwork();
  const hubStatus = useHubRealtimeStatus(activeBranchId);
  const hubDegraded = isOnline && hubStatus !== "idle" && hubStatus !== "subscribed" && hubStatus !== "connecting";
  const { isDesktop } = useBreakpoint();
  const { isDark, toggle } = useTheme();
  const accountAlias = getUserDisplayName(profile);
  const accountRealName = getUserRealName(profile);

  return (
    <>
      <div className="min-h-dvh bg-transparent md:grid md:grid-cols-[248px_minmax(0,1fr)]">
        {isDesktop ? (
          <SidebarNav
            isDark={isDark}
            onToggleTheme={toggle}
            onOpenAccount={() => setUserMenuOpen(true)}
            onOpenAutopedidos={() => setAutopedidosOpen(true)}
          />
        ) : null}

        <div className="flex min-h-dvh min-w-0 flex-col">
          {!isDesktop && (
            <header className="sticky top-0 z-50 border-b border-orange-200/80 bg-white pt-safe dark:border-border dark:bg-card">
              <div className="flex h-14 items-center justify-between gap-2 px-2.5">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <MobileMenuSheet onOpenAccount={() => setUserMenuOpen(true)} />
                  <div className="flex min-w-0 items-center gap-2">
                    <img src="/logo.png" alt="Logo" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    <span className="truncate font-display text-sm font-black tracking-tight text-foreground sm:text-base">
                      POS El pulpo
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                  <AutopedidosQrBadgeButton onClick={() => setAutopedidosOpen(true)} />
                  {hubDegraded && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800 shadow-sm"
                      title="La sincronizacion en vivo no esta activa; se refresca cada ~25s"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span className="hidden xs:inline">Sync lenta</span>
                    </span>
                  )}
                  {!isOnline && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/20 bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-destructive shadow-sm">
                      <WifiOff className="h-3 w-3" />
                      <span className="hidden xs:inline">Sin conexion</span>
                    </span>
                  )}
                  {accountAlias ? (
                    <button
                      type="button"
                      onClick={() => setUserMenuOpen(true)}
                      className="ml-0.5 flex max-w-[9.5rem] items-center gap-1.5 rounded-full border border-orange-200/80 bg-orange-50/70 px-2.5 py-1.5 text-left transition-colors hover:bg-orange-50 sm:max-w-[12rem]"
                      aria-label={`Mi cuenta: ${accountAlias}`}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-[11px] font-black text-primary shadow-sm">
                        {profile?.avatar_url ? (
                          <img
                            src={profile.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          accountAlias[0]?.toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 truncate text-xs font-bold tracking-tight text-foreground sm:text-sm">
                        {accountAlias}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            </header>
          )}
          {isDesktop && hubDegraded && (
            <div className="sticky top-0 z-40 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs font-semibold text-amber-900">
              Sincronizacion en vivo interrumpida — las listas se refrescan cada ~25 s
            </div>
          )}
          {isDesktop && !isOnline && (
            <header className="sticky top-0 z-40 h-0 overflow-hidden bg-white dark:bg-card">
              {/* Desktop keeps its invisible placeholder or we just hide it */}
            </header>
          )}

          <main
            key={mainOutletKey}
            className="mb-safe min-h-0 flex-1 main-content-padding"
          >
            <Outlet />
          </main>
        </div>
      </div>

      <OrderReadyAlertCenter />
      <AutopedidosQrPanel open={autopedidosOpen} onOpenChange={setAutopedidosOpen} />
      {!isDesktop ? <BottomNav isDark={isDark} onToggleTheme={toggle} onOpenAccount={() => setUserMenuOpen(true)} /> : null}

      <Dialog open={userMenuOpen} onOpenChange={setUserMenuOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <UserRound className="h-5 w-5 text-primary" />
              Mi cuenta
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center gap-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/50 border border-orange-200">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={accountAlias}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-black tracking-wide text-primary">
                    {accountAlias ? accountAlias[0].toUpperCase() : <UserRound className="h-6 w-6" />}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-foreground">{accountAlias}</div>
                {accountRealName ? (
                  <div className="truncate text-xs font-medium text-muted-foreground">{accountRealName}</div>
                ) : null}
              </div>
            </div>

            {(activeBranch || branches.length > 1) && (
              <div className="rounded-2xl border border-orange-200 bg-white px-4 py-3 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
                  <Building2 className="h-4 w-4 text-primary" />
                  Sucursal
                </div>

                {branches.length > 1 ? (
                  <Select
                    value={activeBranchId ?? undefined}
                    onValueChange={(value) => {
                      const nextBranch = branches.find((branch) => branch.id === value) ?? null;
                      if (nextBranch) {
                        void setActiveBranch(nextBranch);
                      }
                    }}
                    disabled={loading}
                  >
                    <SelectTrigger className="h-11 w-full rounded-2xl border border-orange-200 bg-white px-3 text-left text-sm font-semibold text-foreground shadow-none [&>span]:truncate">
                      <SelectValue placeholder="Seleccionar sucursal" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : activeBranch ? (
                  <div className="inline-flex min-h-[42px] w-full items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                    <span className="truncate">{activeBranch.name}</span>
                  </div>
                ) : null}
              </div>
            )}

            <div className="grid gap-2">
              <ChangePasswordDialog
                trigger={
                  <Button variant="outline" className="h-11 justify-start rounded-2xl">
                    <KeyRound className="mr-2 h-4 w-4" />
                    Contrasena
                  </Button>
                }
              />

              <Button
                variant="outline"
                className="h-11 justify-start rounded-2xl border-red-200 text-destructive hover:bg-red-50 hover:text-destructive"
                onClick={signOut}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesion
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <CashReportViewer />
    </>
  );
};

export default AppLayout;
