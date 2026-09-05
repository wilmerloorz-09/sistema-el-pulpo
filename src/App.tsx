import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from "@/components/ui/alert-dialog";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import {
  ensureOnlineForAction,
  isNetworkLikeError,
  notifyOfflineActionBlocked,
  asOfflineActionErrorIfNeeded,
} from "@/lib/offlineAction";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { BranchProvider, useBranch } from "@/contexts/BranchContext";
import { usePreferredHomePath } from "@/hooks/usePreferredHomePath";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { setAppOnline } from "@/lib/networkStatus";
import { useEffect, useState, useRef } from "react";
import { initSyncListeners } from "@/services/SyncService";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useAuxiliaryCashAssignment } from "@/hooks/useAuxiliaryCash";
import { useOpenCashRegister } from "@/hooks/useOpenCashRegister";
import { Download, Share2, X, AlertTriangle } from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import Mesas from "./pages/Mesas";
import MesasV2 from "./pages/MesasV2";
import Ordenes from "./pages/Ordenes";
import EditarOrden from "./pages/EditarOrden";
import ParaLlevar from "./pages/ParaLlevar";
import Express from "./pages/Express";
import Extra from "./pages/Extra";
import OrdenEspecial from "./pages/OrdenEspecial";
import Clientes from "./pages/Clientes";
import Promociones from "./pages/Promociones";
import PromocionesConsulta from "./pages/PromocionesConsulta";
import PromocionRegistro from "./pages/PromocionRegistro";
import QrPedido from "./pages/QrPedido";
import Campanas from "./pages/Campanas";
import CampanaDetalle from "./pages/CampanaDetalle";
import Despacho from "./pages/Despacho";
import Servir from "./pages/Servir";
import Empaquetador from "./pages/Empaquetador";
import Productos from "./pages/Productos";
import Caja from "./pages/Caja";
import CambioMonedasBilletes from "./pages/CambioMonedasBilletes";
import CierresCaja from "./pages/CierresCaja";
import Reportes from "./pages/Reportes";
import Admin from "./pages/Admin";
import Turno from "./pages/Turno";
import ForzarCierreTurno from "./pages/ForzarCierreTurno";
import Inventario from "./pages/Inventario";
import InventarioProductos from "./pages/InventarioProductos";
import InventarioMovimientos from "./pages/InventarioMovimientos";
import InventarioHistorial from "./pages/InventarioHistorial";
import MonitoreoGlobal from "./pages/MonitoreoGlobal";
import NotFound from "./pages/NotFound";
import PrintCashReport from "./pages/PrintCashReport";

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onMutate: async () => {
      ensureOnlineForAction();
    },
    onError: (error) => {
      const normalized = asOfflineActionErrorIfNeeded(error);
      if (isNetworkLikeError(normalized)) {
        notifyOfflineActionBlocked();
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Evita refetch automático masivo (staleTime 0 por defecto de React Query).
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      // Reintentar una mutación cuando no hay red suele empeorar la UX.
      retry: false,
    },
  },
});

// Alinear el flag global con el navegador al arrancar.
setAppOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

const GlobalSystemAlert = () => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = (e: any) => {
      setTitle(e.detail.title ?? "Sistema El Pulpo");
      setMessage(e.detail.message);
      setOpen(true);
    };
    window.addEventListener("global-alert", handler);
    return () => window.removeEventListener("global-alert", handler);
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line text-sm text-foreground/90 font-medium">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setOpen(false)}>Aceptar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const LoadingScreen = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

const CajaAutoOpener = () => {
  const { data: shiftGate } = useBranchShiftGate();
  const auxiliaryAssignmentQuery = useAuxiliaryCashAssignment();
  const auxiliaryAssignment = auxiliaryAssignmentQuery.data;
  // Hook liviano: no monta payable-orders ni Realtime de cobros en toda la app.
  const openCashRegister = useOpenCashRegister({ silent: true });
  const openingRef = useRef(false);

  useEffect(() => {
    if (
      shiftGate?.shiftOpen &&
      shiftGate?.userEnabled &&
      shiftGate?.canUseCaja &&
      auxiliaryAssignmentQuery.isFetched &&
      !auxiliaryAssignment?.isAssigned &&
      shiftGate?.cajaStatus === "UNOPENED" &&
      !openingRef.current &&
      !openCashRegister.isPending
    ) {
      openingRef.current = true;
      void openCashRegister
        .mutateAsync({ counts: [] })
        .then(() => {
          console.log("[CajaAutoOpener] Caja abierta automáticamente.");
        })
        .catch((err) => {
          console.error("[CajaAutoOpener] Error al abrir la caja automáticamente:", err);
        })
        .finally(() => {
          openingRef.current = false;
        });
    }
  }, [
    shiftGate?.shiftOpen,
    shiftGate?.userEnabled,
    shiftGate?.canUseCaja,
    auxiliaryAssignmentQuery.isFetched,
    auxiliaryAssignment?.isAssigned,
    shiftGate?.cajaStatus,
    openCashRegister.isPending,
    openCashRegister.mutateAsync,
  ]);

  return null;
};

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
  const { signOut } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (branches.length === 0) {
    if (isGlobalAdmin) {
      return <>{children}</>;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-center">
        <div className="space-y-4">
          <p className="font-display text-lg font-bold text-foreground">Sin sucursales asignadas</p>
          <p className="mt-1 text-sm text-muted-foreground">Contacta al administrador.</p>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => void signOut()}
          >
            Ingresar con otro usuario
          </Button>
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

  return (
    <>
      <CajaAutoOpener />
      {children}
    </>
  );
};

const HomeRedirect = () => {
  const { loading } = useBranch();
  const { preferredPath, firstVisiblePath, canAccessAdmin, isLoading } = usePreferredHomePath();

  if (loading || isLoading) {
    return <LoadingScreen />;
  }

  return <Navigate to={preferredPath ?? firstVisiblePath ?? (canAccessAdmin ? "/admin" : "/mesas")} replace />;
};

const SyncInit = () => {
  useEffect(() => {
    initSyncListeners();
  }, []);
  return null;
};

const InstallPrompt = () => {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (window.location.pathname.startsWith("/promociones/registro")) {
    return null;
  }
  if (window.location.pathname.startsWith("/qr-pedido")) {
    return null;
  }

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (standalone) return;

    const userAgent = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(userAgent);
    const isSafari = /safari/i.test(userAgent) && !/crios|fxios|edgios/i.test(userAgent);

    if (isIos && isSafari) {
      setShowIosHint(true);
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShowIosHint(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  if (!import.meta.env.PROD || dismissed) {
    return null;
  }

  if (installEvent) {
    return (
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-primary/20 bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Download className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-foreground">Instalar El Pulpo</p>
            <p className="mt-1 text-xs text-muted-foreground">Agrega la app a tu pantalla de inicio o escritorio.</p>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="h-10 rounded-xl"
                onClick={async () => {
                  await installEvent.prompt();
                  const choice = await installEvent.userChoice;
                  if (choice.outcome === "accepted") {
                    setDismissed(true);
                  }
                  setInstallEvent(null);
                }}
              >
                Instalar
              </Button>
              <Button size="sm" variant="ghost" className="h-10 rounded-xl" onClick={() => setDismissed(true)}>
                Ahora no
              </Button>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-4 z-50 max-w-[calc(100vw-2rem)] rounded-2xl border border-primary/20 bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Share2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-foreground">Instalar en iPhone</p>
            <p className="mt-1 text-xs text-muted-foreground">En Safari usa Compartir y luego Agregar a pantalla de inicio.</p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <NetworkProvider>
      <TooltipProvider>
        <Toaster />
        <GlobalSystemAlert />
        <InstallPrompt />
        <SyncInit />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/promociones/registro" element={<PromocionRegistro />} />
              <Route path="/qr-pedido/:token" element={<QrPedido />} />
              <Route path="/imprimir-reporte-caja" element={<PrintCashReport />} />
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
                  path="/mesas-v2"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables"]} blockedShiftRoles={["canPackOrders"]}>
                      <MesasV2 />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/mesas"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables"]} blockedShiftRoles={["canPackOrders"]}>
                      <Mesas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/para-llevar"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables"]} blockedShiftRoles={["canPackOrders"]}>
                      <ParaLlevar />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/express"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables"]} blockedShiftRoles={["canPackOrders"]}>
                      <Express />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/extra"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables", "canPackOrders"]}>
                      <Extra />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/orden-especial"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables"]} blockedShiftRoles={["canPackOrders"]}>
                      <OrdenEspecial />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/clientes"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "mesas", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables"]} blockedShiftRoles={["canPackOrders"]}>
                      <Clientes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/promociones"
                  element={
                    <ProtectedRoute requiresOpenShift requiredShiftRoles={["puedeRegistrarPromociones"]}>
                      <Promociones />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/promociones/consulta"
                  element={
                    <ProtectedRoute>
                      <PromocionesConsulta />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/ordenes"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "ordenes", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canServeTables", "canAccessOrders", "canPackOrders"]}>
                      <Ordenes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/editar-orden"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "ordenes", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canEditOrders"]}>
                      <EditarOrden />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/despacho"
                  element={
                    <ProtectedRoute requiresOpenShift requiredShiftRoles={["canDispatchOrders"]}>
                      <Despacho />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/servir"
                  element={
                    <ProtectedRoute requiresOpenShift requiredShiftRoles={["canServePlates"]}>
                      <Servir />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/empaquetador"
                  element={
                    <ProtectedRoute requiresOpenShift requiredShiftRoles={["canPackOrders"]}>
                      <Empaquetador />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/productos"
                  element={
                    <ProtectedRoute allowedModules={["ordenes", "despacho_total", "despacho_mesa", "despacho_para_llevar"]} requiresOpenShift requiredShiftRoles={["canServeTables", "canAccessOrders", "canDispatchOrders", "canManageProducts"]}>
                      <Productos />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/caja"
                  element={
                    <ProtectedRoute requiredPermission={{ module: "caja", level: "VIEW" }} requiresOpenShift requiredShiftRoles={["canUseCaja"]}>
                      <Caja />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/cambio-monedas"
                  element={
                    <ProtectedRoute requiresOpenShift>
                      <CambioMonedasBilletes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/cierres-caja"
                  element={
                    <ProtectedRoute allowedModules={["admin_sucursal", "admin_global"]}>
                      <CierresCaja />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reportes"
                  element={
                    <ProtectedRoute>
                      <Reportes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/turno"
                  element={
                    <ProtectedRoute allowedModules={["turno", "admin_sucursal", "admin_global"]}>
                      <Turno />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/forzar-cierre-turno"
                  element={
                    <ProtectedRoute allowedModules={["turno", "admin_sucursal", "admin_global"]}>
                      <ForzarCierreTurno />
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
                <Route path="/inventario" element={<Inventario />} />
                <Route
                  path="/inventario/productos"
                  element={
                    <ProtectedRoute allowedModules={["admin_sucursal", "admin_global"]}>
                      <InventarioProductos />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/inventario/movimientos"
                  element={
                    <ProtectedRoute allowedModules={["inventario_movimientos", "admin_sucursal", "admin_global"]}>
                      <InventarioMovimientos />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/inventario/historial"
                  element={
                    <ProtectedRoute allowedModules={["inventario_movimientos", "admin_sucursal", "admin_global"]}>
                      <InventarioHistorial />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campanas"
                  element={
                    <ProtectedRoute allowedModules={["admin_global"]}>
                      <Campanas />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/campanas/:campanaId"
                  element={
                    <ProtectedRoute allowedModules={["admin_global"]}>
                      <CampanaDetalle />
                    </ProtectedRoute>
                  }
                />
                <Route path="/admin/campanas" element={<Navigate to="/campanas?origin=campanas" replace />} />
                <Route
                  path="/monitoreo-global"
                  element={
                    <ProtectedRoute allowedModules={["admin_global"]}>
                      <MonitoreoGlobal />
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
