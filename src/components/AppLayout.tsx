import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Fingerprint, KeyRound, LogOut, UserRound, WifiOff } from "lucide-react";
import BottomNav from "./BottomNav";
import SidebarNav from "./SidebarNav";
import ChangePasswordDialog from "./ChangePasswordDialog";
import PasskeyRegisterButton from "./PasskeyRegisterButton";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useTheme } from "@/hooks/useTheme";
import { OrderReadyAlertCenter } from "@/hooks/useMeseroOrderReadyNotification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const AppLayout = () => {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { signOut, profile } = useAuth();
  const { activeBranch, activeBranchId, branches, setActiveBranch, loading } = useBranch();
  const { isOnline } = useNetwork();
  const { isDesktop } = useBreakpoint();
  const { isDark, toggle } = useTheme();

  return (
    <>
      <div className="min-h-dvh bg-transparent md:grid md:grid-cols-[248px_minmax(0,1fr)]">
        {isDesktop ? <SidebarNav isDark={isDark} onToggleTheme={toggle} onOpenAccount={() => setUserMenuOpen(true)} /> : null}

        <div className="flex min-h-dvh min-w-0 flex-col">
          <header
            className={
              isDesktop
                ? "sticky top-0 z-40 h-0 overflow-hidden bg-white dark:bg-card"
                : "sticky top-0 z-40 border-b border-orange-200/80 bg-white px-2.5 py-2 sm:px-4 sm:py-2.5 dark:border-border dark:bg-card"
            }
          >
            {!isDesktop && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <img src="/logo.png" alt="El Pulpo" className="h-8 w-auto shrink-0 object-contain sm:h-11" />
                    {activeBranch && branches.length > 1 ? (
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
                        <SelectTrigger className="h-10 w-full min-w-0 rounded-2xl border border-orange-200 bg-white/88 px-3 text-xs font-semibold text-foreground shadow-sm sm:h-10 sm:w-[220px] sm:min-w-[220px] [&>span]:truncate">
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
                      <span className="ml-0 inline-flex min-h-[38px] max-w-full flex-1 items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm sm:flex-none">
                        <span className="truncate">{activeBranch.name}</span>
                      </span>
                    ) : null}
                  </div>

                  {!isOnline ? (
                    <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
                      <span className="hidden min-h-[38px] items-center gap-1 rounded-2xl border border-destructive/20 bg-rose-50 px-3 py-1 text-xs font-semibold text-destructive shadow-sm sm:flex">
                        <WifiOff className="h-3 w-3" /> Sin conexion
                      </span>
                    </div>
                  ) : null}
                </div>

                {!isOnline && (
                  <div className="mt-2 sm:hidden">
                    <span className="inline-flex min-h-[34px] items-center gap-1 rounded-2xl border border-destructive/20 bg-rose-50 px-3 py-1 text-[11px] font-semibold text-destructive shadow-sm">
                      <WifiOff className="h-3 w-3" /> Sin conexion
                    </span>
                  </div>
                )}
              </>
            )}
          </header>

          <main className="mb-safe min-h-0 flex-1 pb-[calc(60px+env(safe-area-inset-bottom,0px)+0.75rem)] md:pb-0">
            <Outlet />
          </main>
        </div>
      </div>

      <OrderReadyAlertCenter />
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
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
              <div className="text-sm font-bold text-foreground">{profile?.full_name || "Usuario"}</div>
              {profile?.username ? <div className="text-xs font-medium text-muted-foreground">@{profile.username}</div> : null}
            </div>

            <div className="grid gap-2">
              <ChangePasswordDialog
                trigger={
                  <Button variant="outline" className="h-11 justify-start rounded-2xl">
                    <KeyRound className="mr-2 h-4 w-4" />
                    Contrasena
                  </Button>
                }
              />
              <PasskeyRegisterButton
                trigger={
                  <Button variant="outline" className="h-11 justify-start rounded-2xl">
                    <Fingerprint className="mr-2 h-4 w-4" />
                    Biometrico
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
    </>
  );
};

export default AppLayout;
