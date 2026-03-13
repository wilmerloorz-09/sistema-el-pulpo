import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { Button } from "@/components/ui/button";
import { LogOut, RefreshCw, WifiOff } from "lucide-react";
import ChangePasswordDialog from "./ChangePasswordDialog";
import PasskeyRegisterButton from "./PasskeyRegisterButton";

const AppLayout = () => {
  const { signOut, profile } = useAuth();
  const { activeBranch, branches, setActiveBranch, isGlobalAdmin } = useBranch();
  const { isOnline } = useNetwork();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 px-3 py-2 backdrop-blur-md sm:px-4 sm:py-2.5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-lg">Pulpo</span>
            <span className="font-display text-sm font-bold text-foreground">El Pulpo</span>
            {activeBranch && branches.length > 1 ? (
              <button
                onClick={() => setActiveBranch(null)}
                className="ml-0 inline-flex min-h-[36px] max-w-full items-center gap-1 rounded-lg bg-accent/20 px-2 py-1 text-left text-xs font-medium text-accent-foreground"
              >
                <span className="truncate">{activeBranch.name}</span>
                <RefreshCw className="h-3 w-3 shrink-0" />
              </button>
            ) : activeBranch ? (
              <span className="ml-0 inline-flex min-h-[36px] max-w-full items-center rounded-lg bg-accent/20 px-2 py-1 text-xs font-medium text-accent-foreground">
                <span className="truncate">{activeBranch.name}</span>
              </span>
            ) : null}
            {isGlobalAdmin && (
              <span className="inline-flex min-h-[36px] items-center rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                Admin global
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            {!isOnline && (
              <span className="flex min-h-[36px] items-center gap-1 rounded-lg bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
            <span className="hidden text-xs text-muted-foreground lg:block">{profile?.full_name}</span>
            <PasskeyRegisterButton />
            <ChangePasswordDialog />
            <Button variant="ghost" size="icon" onClick={signOut} className="h-9 w-9 rounded-xl">
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
