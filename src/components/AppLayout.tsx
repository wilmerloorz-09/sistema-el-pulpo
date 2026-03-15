import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Fingerprint, KeyRound, LogOut, UserRound, WifiOff } from "lucide-react";
import ChangePasswordDialog from "./ChangePasswordDialog";
import PasskeyRegisterButton from "./PasskeyRegisterButton";

const AppLayout = () => {
  const { signOut, profile } = useAuth();
  const { activeBranch, activeBranchId, branches, setActiveBranch, isGlobalAdmin, loading } = useBranch();
  const { isOnline } = useNetwork();

  return (
    <div className="flex min-h-dvh flex-col bg-transparent">
      <header className="sticky top-0 z-40 border-b border-orange-200/80 bg-white/82 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-2.5">
        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <img src="/logo.png" alt="El Pulpo" className="h-10 w-auto shrink-0 object-contain sm:h-11" />
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
                <SelectTrigger className="h-11 w-full min-w-0 rounded-2xl border border-orange-200 bg-white/88 px-3 text-xs font-semibold text-foreground shadow-sm sm:h-10 sm:w-[220px] sm:min-w-[220px] [&>span]:truncate">
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
              <span className="ml-0 inline-flex min-h-[38px] max-w-full items-center rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
                <span className="truncate">{activeBranch.name}</span>
              </span>
            ) : null}
            {isGlobalAdmin && (
              <span className="inline-flex min-h-[38px] items-center rounded-2xl border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-primary shadow-sm">
                Admin global
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {!isOnline && (
              <span className="flex min-h-[38px] items-center gap-1 rounded-2xl border border-destructive/20 bg-rose-50 px-3 py-1 text-xs font-semibold text-destructive shadow-sm">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-2xl">
                  <UserRound className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 rounded-2xl border-orange-200 bg-white/95 p-2 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.22)]">
                <DropdownMenuLabel className="rounded-xl bg-orange-50 px-3 py-2.5">
                  <div className="text-sm font-bold text-foreground">{profile?.full_name || "Usuario"}</div>
                  {profile?.username ? (
                    <div className="text-xs font-medium text-muted-foreground">@{profile.username}</div>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ChangePasswordDialog
                  trigger={
                    <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2.5" onSelect={(event) => event.preventDefault()}>
                      <KeyRound className="mr-2 h-4 w-4" />
                      Contrasena
                    </DropdownMenuItem>
                  }
                />
                <PasskeyRegisterButton
                  trigger={
                    <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2.5" onSelect={(event) => event.preventDefault()}>
                      <Fingerprint className="mr-2 h-4 w-4" />
                      Biometrico
                    </DropdownMenuItem>
                  }
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer rounded-xl px-3 py-2.5 text-destructive focus:text-destructive" onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesion
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mb-safe flex-1 pb-24 md:pb-20">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
};

export default AppLayout;
