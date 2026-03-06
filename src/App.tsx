import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchProvider, useBranch } from "@/contexts/BranchContext";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { useEffect } from "react";
import { initSyncListeners } from "@/services/SyncService";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import RoleSelector from "@/components/RoleSelector";
import Login from "./pages/Login";
import Mesas from "./pages/Mesas";
import Ordenes from "./pages/Ordenes";
import Despacho from "./pages/Despacho";
import Caja from "./pages/Caja";
import Reportes from "./pages/Reportes";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const { user, loading, activeRole, roles } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (roles.length > 1 && !activeRole) return <RoleSelector />;
  if (roles.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-center">
        <div>
          <p className="font-display text-lg font-bold text-foreground">Sin roles asignados</p>
          <p className="text-sm text-muted-foreground mt-1">Contacta al administrador.</p>
        </div>
      </div>
    );
  }

  return (
    <BranchProvider>
      <BranchGate>{children}</BranchGate>
    </BranchProvider>
  );
};

const BranchGate = ({ children }: { children: React.ReactNode }) => {
  const { branches, activeBranch, setActiveBranch, loading } = useBranch();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-center">
        <div>
          <p className="font-display text-lg font-bold text-foreground">Sin sucursales asignadas</p>
          <p className="text-sm text-muted-foreground mt-1">Contacta al administrador.</p>
        </div>
      </div>
    );
  }

  if (branches.length > 1 && !activeBranch) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="font-display text-xl font-bold text-foreground text-center">Selecciona sucursal</h1>
          <div className="grid gap-3">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => setActiveBranch(b)}
                className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm active:scale-95 transition-transform"
              >
                <span className="font-display text-sm font-semibold">{b.name}</span>
                {b.address && <p className="text-xs text-muted-foreground mt-0.5">{b.address}</p>}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const SyncInit = () => {
  useEffect(() => {
    initSyncListeners();
  }, []);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <NetworkProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <SyncInit />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                element={
                  <AuthGate>
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  </AuthGate>
                }
              >
                <Route path="/mesas" element={<Mesas />} />
                <Route path="/ordenes" element={<Ordenes />} />
                <Route path="/despacho" element={<Despacho />} />
                <Route path="/caja" element={<Caja />} />
                <Route path="/reportes" element={<Reportes />} />
                <Route path="/admin" element={<Admin />} />
              </Route>
              <Route path="/" element={<Navigate to="/mesas" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </NetworkProvider>
  </QueryClientProvider>
);

export default App;
