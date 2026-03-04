import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { Button } from "@/components/ui/button";
import { LogOut, RefreshCw, WifiOff } from "lucide-react";

const AppLayout = () => {
  const { signOut, profile, activeRole, setActiveRole, roles } = useAuth();
  const { activeBranch, branches, setActiveBranch } = useBranch();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 backdrop-blur-md px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐙</span>
          <span className="font-display text-sm font-bold text-foreground">El Pulpo</span>
          {activeBranch && branches.length > 1 ? (
            <button
              onClick={() => setActiveBranch(null as any)}
              className="ml-1 rounded-lg bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent-foreground flex items-center gap-1"
            >
              📍 {activeBranch.name}
              <RefreshCw className="h-3 w-3" />
            </button>
          ) : activeBranch ? (
            <span className="ml-1 rounded-lg bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent-foreground">
              📍 {activeBranch.name}
            </span>
          ) : null}
          {activeRole && (
            <button
              onClick={() => setActiveRole(null as any)}
              className="rounded-lg bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary flex items-center gap-1"
            >
              {activeRole}
              {roles.length > 1 && <RefreshCw className="h-3 w-3" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:block">
            {profile?.full_name}
          </span>
          <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 pb-20">
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
};

export default AppLayout;
