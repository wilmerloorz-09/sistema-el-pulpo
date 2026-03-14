import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LogOut, WifiOff } from "lucide-react";
import ChangePasswordDialog from "./ChangePasswordDialog";
import PasskeyRegisterButton from "./PasskeyRegisterButton";

const AppLayout = () => {
  const { signOut, profile } = useAuth();
  const { activeBranch, activeBranchId, branches, setActiveBranch, isGlobalAdmin, loading } = useBranch();
  const { isOnline } = useNetwork();

  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <header className="sticky top-0 z-40 border-b border-orange-200/80 bg-white/78 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-2.5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                <SelectTrigger className="h-10 w-[220px] min-w-[220px] rounded-2xl border border-orange-200 bg-white/88 px-3 text-xs font-semibold text-foreground shadow-sm [&>span]:truncate">
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
            <span className="hidden rounded-2xl border border-white/70 bg-white/80 px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm lg:block">{profile?.full_name}</span>
            <PasskeyRegisterButton />
            <ChangePasswordDialog />
            <Button variant="outline" size="icon" onClick={signOut} className="h-10 w-10 rounded-2xl">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mb-safe flex-1 pb-20 md:pb-20">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
};

export default AppLayout;
