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
import Login from "./pages/Login";
import Mesas from "./pages/Mesas";
import Ordenes from "./pages/Ordenes";
import Despacho from "./pages/Despacho";
import Caja from "./pages/Caja";
import Reportes from "./pages/Reportes";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const LoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <BranchProvider>
      <BranchGate>{children}</BranchGate>
    </BranchProvider>
  );
};

const BranchGate = ({ children }: { children: React.ReactNode }) => {
  const { branches, activeBranch, setActiveBranch, loading, isGlobalAdmin } = useBranch();

  if (loading) {
    return <LoadingScreen />;
  }

  if (branches.length === 0) {
    if (isGlobalAdmin) {
      return <>{children}</>;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-center">
        <div>
          <p className="font-display text-lg font-bold text-foreground">Sin sucursales asignadas</p>
          <p className="mt-1 text-sm text-muted-foreground">Contacta al administrador.</p>
        </div>
      </div>
    );
  }

  if (branches.length > 1 && !activeBranch) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-center font-display text-xl font-bold text-foreground">Selecciona sucursal</h1>
          <div className="grid gap-3">
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => void setActiveBranch(b)}
                className="rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-transform active:scale-95"
              >
                <span className="font-display text-sm font-semibold">{b.name}</span>
                {b.address && <p className="mt-0.5 text-xs text-muted-foreground">{b.address}</p>}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const HomeRedirect = () => {
  const { branches, isGlobalAdmin, loading } = useBranch();

  if (loading) {
    return <LoadingScreen />;
  }

  if (isGlobalAdmin && branches.length === 0) {
    return <Navigate to="/admin" replace />;
  }

  return <Navigate to="/mesas" replace />;
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
                <Route
                  path="/mesas"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }}>
                      <Mesas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/ordenes"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "ordenes", level: "VIEW" }}>
                      <Ordenes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/despacho"
                  element={
                    <ProtectedRoute allowedModules={["despacho_total", "despacho_mesa", "despacho_para_llevar"]}>
                      <Despacho />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/caja"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "caja", level: "VIEW" }}>
                      <Caja />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reportes"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "reportes_sucursal", level: "VIEW" }}>
                      <Reportes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute allowedModules={["admin_sucursal", "admin_global"]}>
                      <Admin />
                    </ProtectedRoute>
                  }
                />
                <Route path="/" element={<HomeRedirect />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </NetworkProvider>
  </QueryClientProvider>
);

export default App;
