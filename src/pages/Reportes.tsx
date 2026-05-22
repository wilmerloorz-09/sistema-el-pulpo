import { useState, useEffect } from 'react';
import { useBranch } from '@/contexts/BranchContext';
import { useBranchShiftGate } from '@/hooks/useBranchShiftGate';
import { hasPermission } from '@/lib/permissions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Wallet, ShieldAlert, Soup, BarChart4, Lock, AlertCircle } from 'lucide-react';

// Componentes del Módulo
import FiltrosPanel from '@/components/reportes/FiltrosPanel';
import ReportePagos from '@/components/reportes/ReportePagos';
import ReporteAnulaciones from '@/components/reportes/ReporteAnulaciones';
import ReporteProductos from '@/components/reportes/ReporteProductos';
import type { ReportesFilters } from '@/hooks/useReportesOnlineData';

const Reportes = () => {
  const { permissions, isGlobalAdmin, activeBranchId, branches } = useBranch();
  const { data: sg, isLoading: sgLoading } = useBranchShiftGate();
  
  const [activeTab, setActiveTab] = useState<string>('payments');

  // Rango de fechas por defecto: Hoy de 00:00:00 a 23:59:59
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const [filters, setFilters] = useState<ReportesFilters>({
    branchId: activeBranchId || '',
    desde: startOfToday.toISOString(),
    hasta: endOfToday.toISOString(),
    shiftId: null,
    cashierId: null,
    creatorId: null,
    productIds: null,
    orderTypes: ['DINE_IN', 'TAKEOUT', 'EXPRESS', 'EXTRA']
  });

  // Mantener sincronizado el branchId del filtro con el branch activo del contexto
  useEffect(() => {
    if (activeBranchId) {
      setFilters(prev => ({
        ...prev,
        branchId: activeBranchId
      }));
    }
  }, [activeBranchId]);

  // Validaciones de Acceso
  const canAccessAdmin = isGlobalAdmin
    || hasPermission(permissions, "admin_sucursal", "VIEW")
    || hasPermission(permissions, "admin_global", "VIEW");

  const isSupervisor = Boolean(sg?.isSupervisor);
  const canAuthorizeOrderCancel = Boolean(sg?.canAuthorizeOrderCancel);

  // Tiene acceso si es Administrador, Supervisor o si tiene capacidad de autorizar cancelaciones
  const hasAccess = canAccessAdmin || isSupervisor || canAuthorizeOrderCancel;

  if (sgLoading) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!activeBranchId) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border-border/80 text-center p-6 shadow-sm">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-display text-base font-bold text-foreground">Sucursal no seleccionada</h3>
          <p className="text-xs text-muted-foreground mt-1">Por favor selecciona una sucursal activa en la barra superior para poder consultar los reportes del negocio.</p>
        </Card>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 text-center p-6 shadow-[0_22px_55px_-42px_rgba(239,68,68,0.25)]">
          <Lock className="w-10 h-10 text-destructive mx-auto mb-3" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso Restringido</h2>
          <p className="text-xs text-muted-foreground mt-2">
            El módulo de reportes históricos e informes dinámicos requiere privilegios de **Administrador**, **Supervisor** o credenciales autorizadas del turno operativo.
          </p>
        </Card>
      </div>
    );
  }

  const handleFilterChange = (newFilters: ReportesFilters) => {
    setFilters(newFilters);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto print:p-0 print:m-0 print:max-w-none">
      {/* Estilos CSS específicos para Impresión */}
      <style>{`
        @media print {
          /* Ocultar barra lateral, barra de navegación, panel de filtros y pestañas */
          aside, nav, header, footer, 
          .print\\:hidden, 
          [role="tablist"], 
          button {
            display: none !important;
          }
          
          /* Forzar fondo blanco y texto oscuro */
          body, html, main, #root {
            background: white !important;
            color: black !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          /* Evitar saltos de página a mitad de tablas o gráficos */
          .card, tr, table {
            page-break-inside: avoid !important;
          }

          /* Asegurar que las tablas ocupen el ancho completo */
          table {
            width: 100% !important;
          }
        }
      `}</style>

      {/* Header */}
      <div className="flex justify-between items-start print:mb-6">
        <div>
          <h1 className="font-display text-2xl font-black text-foreground">
            Reportes Parametrizables
          </h1>
          <p className="text-xs text-muted-foreground mt-1 print:hidden">
            Consultas, auditoría de flujo financiero y métricas operativas directas de Supabase.
          </p>
          <p className="text-xs font-bold text-foreground mt-1 hidden print:block">
            Sucursal: {branches.find(b => b.id === activeBranchId)?.name || activeBranchId} | Generado el: {new Date().toLocaleString('es-EC')}
          </p>
        </div>

        {/* Roles Badge */}
        <div className="flex items-center gap-2 print:hidden">
          {canAccessAdmin && <Badge className="bg-violet-600 rounded-lg text-[10px] font-bold">🛠️ Administrador</Badge>}
          {!canAccessAdmin && isSupervisor && <Badge className="bg-indigo-600 rounded-lg text-[10px] font-bold">🛡️ Supervisor</Badge>}
          {!canAccessAdmin && !isSupervisor && canAuthorizeOrderCancel && <Badge className="bg-amber-600 rounded-lg text-[10px] font-bold">🔑 Autorizante</Badge>}
        </div>
      </div>

      {/* Panel de Filtros Global */}
      <FiltrosPanel 
        branchId={filters.branchId} 
        onFilterChange={handleFilterChange} 
        activeTab={activeTab}
      />

      {/* Tabs de Reportes */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-muted/60 p-1 rounded-2xl print:hidden">
          <TabsTrigger value="payments" className="flex items-center gap-2 rounded-xl text-xs font-bold py-2.5">
            <Wallet className="h-4 w-4" />
            Pagos Realizados
          </TabsTrigger>
          <TabsTrigger value="voids" className="flex items-center gap-2 rounded-xl text-xs font-bold py-2.5">
            <ShieldAlert className="h-4 w-4" />
            Anulación de Pagos
          </TabsTrigger>
          <TabsTrigger value="products" className="flex items-center gap-2 rounded-xl text-xs font-bold py-2.5">
            <Soup className="h-4 w-4" />
            Productos Vendidos
          </TabsTrigger>
        </TabsList>

        {/* Contenido: Pagos */}
        <TabsContent value="payments" className="mt-6 border-none p-0 outline-none">
          <ReportePagos filters={filters} />
        </TabsContent>

        {/* Contenido: Anulaciones */}
        <TabsContent value="voids" className="mt-6 border-none p-0 outline-none">
          <ReporteAnulaciones filters={filters} />
        </TabsContent>

        {/* Contenido: Productos Vendidos */}
        <TabsContent value="products" className="mt-6 border-none p-0 outline-none">
          <ReporteProductos filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reportes;
