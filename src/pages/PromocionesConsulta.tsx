import { useState, useEffect } from 'react';
import { useBranch } from '@/contexts/BranchContext';
import { useBranchShiftGate } from '@/hooks/useBranchShiftGate';
import { hasPermission } from '@/lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Search,
  Filter,
  FileDown,
  Printer,
  Gift,
  Ticket,
  Calendar,
  Lock,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  Receipt,
  UserCheck,
  Tag,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getOrderRef } from '@/lib/orderPresentation';
import {
  usePromocionesFiltrosCatalogos,
  usePromocionesConsultaData,
  type PromocionesConsultaFilters,
} from '@/hooks/usePromocionesConsultaData';

export default function PromocionesConsulta() {
  const { permissions, isGlobalAdmin, activeBranchId, branches } = useBranch();
  const { data: sg, isLoading: sgLoading } = useBranchShiftGate();

  // Rango de fechas por defecto: Hoy
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // Estados de Filtros
  const [localBranchId, setLocalBranchId] = useState<string>(activeBranchId || 'ALL');
  const [rangeType, setRangeType] = useState<string>('HOY');
  const [desde, setDesde] = useState<string>(format(startOfToday, "yyyy-MM-dd'T'HH:mm"));
  const [hasta, setHasta] = useState<string>(format(endOfToday, "yyyy-MM-dd'T'HH:mm"));
  const [campanaId, setCampanaId] = useState<string>('ALL');
  const [shiftId, setShiftId] = useState<string>('ALL');
  const [estadoPrediccion, setEstadoPrediccion] = useState<string>('ALL');
  const [estadoCupon, setEstadoCupon] = useState<string>('ALL');
  const [creatorId, setCreatorId] = useState<string>('ALL');
  const [busquedaCliente, setBusquedaCliente] = useState<string>('');
  const [busquedaOrden, setBusquedaOrden] = useState<string>('');

  // Sincronizar branch activo del contexto
  useEffect(() => {
    if (activeBranchId) {
      setLocalBranchId(activeBranchId);
    }
  }, [activeBranchId]);

  // Cargar Catálogos para los filtros
  const { data: catalogos, isLoading: catalogosLoading } = usePromocionesFiltrosCatalogos(localBranchId);

  // Manejar el rango rápido de tiempo
  useEffect(() => {
    const today = new Date();
    let dStr = '';
    let hStr = '';

    if (rangeType === 'TURNO_ACTUAL') {
      const currentShiftId = sg?.shiftId;
      const openedAtStr = currentShiftId
        ? catalogos?.shifts?.find((s: any) => s.id === currentShiftId)?.opened_at
        : null;

      if (openedAtStr) {
        dStr = format(new Date(openedAtStr), "yyyy-MM-dd'T'HH:mm");
        hStr = format(today, "yyyy-MM-dd'T'HH:mm");
        if (currentShiftId) setShiftId(currentShiftId);
      } else {
        // Fallback al turno más reciente
        const mostRecentShift = catalogos?.shifts?.[0];
        if (mostRecentShift) {
          dStr = format(new Date(mostRecentShift.opened_at), "yyyy-MM-dd'T'HH:mm");
          hStr = mostRecentShift.closed_at
            ? format(new Date(mostRecentShift.closed_at), "yyyy-MM-dd'T'HH:mm")
            : format(today, "yyyy-MM-dd'T'HH:mm");
          setShiftId(mostRecentShift.id);
        } else {
          // Fallback a hoy
          const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
          dStr = format(startToday, "yyyy-MM-dd'T'HH:mm");
          hStr = format(today, "yyyy-MM-dd'T'HH:mm");
        }
      }
    } else if (rangeType === 'HOY') {
      const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
      dStr = format(startToday, "yyyy-MM-dd'T'HH:mm");
      hStr = format(endToday, "yyyy-MM-dd'T'HH:mm");
      setShiftId('ALL');
    } else if (rangeType === 'AYER') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const startYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
      const endYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      dStr = format(startYesterday, "yyyy-MM-dd'T'HH:mm");
      hStr = format(endYesterday, "yyyy-MM-dd'T'HH:mm");
      setShiftId('ALL');
    } else if (rangeType === 'ULTIMOS_7_DIAS') {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 7);
      const startRange = new Date(sevenDaysAgo.getFullYear(), sevenDaysAgo.getMonth(), sevenDaysAgo.getDate(), 0, 0, 0);
      dStr = format(startRange, "yyyy-MM-dd'T'HH:mm");
      hStr = format(today, "yyyy-MM-dd'T'HH:mm");
      setShiftId('ALL');
    }

    if (rangeType !== 'PERSONALIZADO' && dStr && hStr) {
      setDesde(dStr);
      setHasta(hStr);
    }
  }, [rangeType, catalogos?.shifts, sg]);

  // Si se selecciona un turno de forma manual, autocompletamos las fechas
  const handleShiftChange = (val: string) => {
    setShiftId(val);
    if (val !== 'ALL') {
      const selected = catalogos?.shifts?.find((s: any) => s.id === val);
      if (selected) {
        setDesde(format(new Date(selected.opened_at), "yyyy-MM-dd'T'HH:mm"));
        setHasta(
          selected.closed_at
            ? format(new Date(selected.closed_at), "yyyy-MM-dd'T'HH:mm")
            : format(new Date(), "yyyy-MM-dd'T'HH:mm")
        );
        setRangeType('PERSONALIZADO');
      }
    }
  };

  // Estado que se le pasa al query final (gatillado al hacer click en Aplicar)
  const [activeFilters, setActiveFilters] = useState<PromocionesConsultaFilters>({
    branchId: localBranchId,
    campanaId: 'ALL',
    estadoPrediccion: 'ALL',
    estadoCupon: 'ALL',
    desde: startOfToday.toISOString(),
    hasta: endOfToday.toISOString(),
    shiftId: null,
    creatorId: null,
    busquedaCliente: '',
    busquedaOrden: '',
  });

  const handleApplyFilters = () => {
    const desdeISO = desde ? new Date(desde).toISOString() : null;
    const hastaISO = hasta ? new Date(hasta).toISOString() : null;

    setActiveFilters({
      branchId: localBranchId,
      campanaId,
      estadoPrediccion,
      estadoCupon,
      desde: desdeISO,
      hasta: hastaISO,
      shiftId: shiftId === 'ALL' ? null : shiftId,
      creatorId: creatorId === 'ALL' ? null : creatorId,
      busquedaCliente,
      busquedaOrden,
    });
  };

  const handleClearFilters = () => {
    setLocalBranchId(activeBranchId || 'ALL');
    setRangeType('HOY');
    setCampanaId('ALL');
    setShiftId('ALL');
    setEstadoPrediccion('ALL');
    setEstadoCupon('ALL');
    setCreatorId('ALL');
    setBusquedaCliente('');
    setBusquedaOrden('');

    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

    setDesde(format(startToday, "yyyy-MM-dd'T'HH:mm"));
    setHasta(format(endToday, "yyyy-MM-dd'T'HH:mm"));

    setActiveFilters({
      branchId: activeBranchId || 'ALL',
      campanaId: 'ALL',
      estadoPrediccion: 'ALL',
      estadoCupon: 'ALL',
      desde: startToday.toISOString(),
      hasta: endToday.toISOString(),
      shiftId: null,
      creatorId: null,
      busquedaCliente: '',
      busquedaOrden: '',
    });
  };

  // Consultar datos de promociones/predicciones
  const { data: consultaData, isLoading: queryLoading, error, refetch } = usePromocionesConsultaData(activeFilters);

  const records = consultaData?.records || [];
  const kpis = consultaData?.kpis || {
    totalParticipaciones: 0,
    ganadasCount: 0,
    pendientesCount: 0,
    perdidasCount: 0,
    totalMontoDescuento: 0,
    cuponesUsadosCount: 0,
  };

  // Validaciones de Acceso
  const puedeGestionarCampanas = isGlobalAdmin || hasPermission(permissions, "admin_global", "VIEW");
  const puedeRegistrarPromociones = Boolean(sg?.puedeRegistrarPromociones);
  const hasAccess = puedeGestionarCampanas || puedeRegistrarPromociones || isGlobalAdmin;

  if (sgLoading || catalogosLoading) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Card className="w-full max-w-md rounded-[28px] border border-destructive/20 bg-destructive/5 text-center p-6 shadow-sm">
          <Lock className="w-10 h-10 text-destructive mx-auto mb-3" />
          <h2 className="font-display text-lg font-black text-destructive">Acceso Restringido</h2>
          <p className="text-xs text-muted-foreground mt-2">
            El módulo de consultas de promociones requiere credenciales autorizadas o permisos de administrador global.
          </p>
        </Card>
      </div>
    );
  }

  const getOfertaDescripcion = (campana: any, ofertaId: string) => {
    if (!campana || !campana.cartelera_ofertas) return ofertaId;
    const oferta = campana.cartelera_ofertas.find(
      (o: any) => o.id_oferta === ofertaId || o.id === ofertaId
    );
    return oferta ? oferta.descripcion : ofertaId;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(amount);
  };

  // Exportar a CSV UTF-8 con BOM
  const handleExportCSV = () => {
    if (records.length === 0) return;

    const headers = [
      'Fecha y Hora',
      'Orden Code',
      'Orden Nro',
      'Referencia Orden',
      'Cliente Cedula',
      'Cliente Nombre',
      'Campaña',
      'Oferta Seleccionada',
      'Estado Predicción',
      'Código Cupón',
      'Estado Cupón',
      'Monto Descuento ($)',
      'Fecha Caducidad Cupón',
      'Fecha Uso Cupón',
      'Registrado Por'
    ];

    const rows = records.map((r: any) => {
      const fecha = format(new Date(r.creado_el), 'dd/MM/yyyy HH:mm:ss');
      const ref = getOrderRef(r.orden?.order_code, r.orden?.order_number);
      const cedula = r.cliente?.cedula || '';
      const nombre = r.cliente ? `${r.cliente.nombres} ${r.cliente.apellidos}` : '';
      const campana = r.campana?.titulo || '';
      const oferta = getOfertaDescripcion(r.campana, r.oferta_seleccionada_id);
      const estado = r.estado_prediccion;
      const cupon = r.codigo_cupon || '';
      
      let estCupon = 'Ninguno';
      const nowTime = new Date().getTime();
      if (r.codigo_cupon) {
        if (r.cupon_usado_el) {
          estCupon = 'Usado';
        } else if (r.fecha_caducidad_cupon && new Date(r.fecha_caducidad_cupon).getTime() < nowTime) {
          estCupon = 'Expirado';
        } else {
          estCupon = 'Vigente';
        }
      }

      const desc = r.monto_descuento_ganado ? Number(r.monto_descuento_ganado).toFixed(2) : '0.00';
      const caducidad = r.fecha_caducidad_cupon ? format(new Date(r.fecha_caducidad_cupon), 'dd/MM/yyyy') : '';
      const uso = r.cupon_usado_el ? format(new Date(r.cupon_usado_el), 'dd/MM/yyyy HH:mm:ss') : '';
      
      const registradorName = r.registrador
        ? (r.registrador.first_name || r.registrador.full_name || r.registrador.username)
        : 'Sistema';

      return [
        fecha,
        r.orden?.order_code || '',
        r.orden?.order_number || '',
        ref,
        cedula,
        nombre,
        campana,
        oferta,
        estado,
        cupon,
        estCupon,
        desc,
        caducidad,
        uso,
        registradorName
      ];
    });

    const csvRows = [headers.join(';'), ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(';'))];
    const csvContent = '\uFEFF' + csvRows.join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `consulta_promociones_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Calcular porcentajes para KPIs
  const ganadasPct = kpis.totalParticipaciones > 0
    ? Math.round((kpis.ganadasCount / kpis.totalParticipaciones) * 100)
    : 0;

  const cuponesUsadosPct = kpis.ganadasCount > 0
    ? Math.round((kpis.cuponesUsadosCount / kpis.ganadasCount) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto print:p-0 print:m-0 print:max-w-none">
      {/* CSS Impresión */}
      <style>{`
        @media print {
          aside, nav, header, footer, 
          .print\\:hidden, 
          [role="tablist"], 
          button {
            display: none !important;
          }
          
          body, html, main, #root {
            background: white !important;
            color: black !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .card, tr, table {
            page-break-inside: avoid !important;
          }

          table {
            width: 100% !important;
          }
        }
      `}</style>

      {/* Header */}
      <div className="flex justify-between items-start print:mb-6">
        <div>
          <h1 className="font-display text-2xl font-black text-foreground">
            Consulta de Promociones
          </h1>
          <p className="text-xs text-muted-foreground mt-1 print:hidden">
            Consulta histórica, auditoría de cupones y seguimiento de participaciones de comensales.
          </p>
          <p className="text-xs font-bold text-foreground mt-1 hidden print:block">
            Sucursal: {branches.find(b => b.id === activeBranchId)?.name || activeBranchId} | Generado el: {new Date().toLocaleString('es-EC')}
          </p>
        </div>
      </div>

      {/* Panel de Filtros */}
      <div className="rounded-3xl border border-border/80 bg-card/60 p-5 shadow-sm backdrop-blur-md transition-all print:hidden">
        <div className="flex items-center gap-2 border-b border-border/60 pb-3 mb-4">
          <Filter className="h-5 w-5 text-primary" />
          <h3 className="font-display text-sm font-bold text-foreground">Filtros de Búsqueda</h3>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Sucursal (Solo para Admin Global) */}
          {isGlobalAdmin && (
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Sucursal</Label>
              <Select value={localBranchId} onValueChange={setLocalBranchId}>
                <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                  <SelectValue placeholder="Seleccionar sucursal" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" className="font-bold text-primary">🏢 Todas las sucursales</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Rango de Tiempo Rápido */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Rango de Tiempo</Label>
            <Select value={rangeType} onValueChange={setRangeType}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Seleccionar rango" />
              </SelectTrigger>
              <SelectContent>
                {sg?.shiftId && <SelectItem value="TURNO_ACTUAL">🚀 Turno Actual</SelectItem>}
                <SelectItem value="HOY">📅 Hoy</SelectItem>
                <SelectItem value="AYER">📅 Ayer</SelectItem>
                <SelectItem value="ULTIMOS_7_DIAS">🗓️ Últimos 7 días</SelectItem>
                <SelectItem value="PERSONALIZADO">⚙️ Rango Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Fecha Desde */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Desde</Label>
            <Input
              type="datetime-local"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                setRangeType('PERSONALIZADO');
              }}
              className="h-10 rounded-xl bg-background/80 border-border/80 pr-10 font-medium text-xs"
            />
          </div>

          {/* Fecha Hasta */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Hasta</Label>
            <Input
              type="datetime-local"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value);
                setRangeType('PERSONALIZADO');
              }}
              className="h-10 rounded-xl bg-background/80 border-border/80 pr-10 font-medium text-xs"
            />
          </div>

          {/* Campaña */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Campaña</Label>
            <Select value={campanaId} onValueChange={setCampanaId}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todas las campañas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas las campañas</SelectItem>
                {(catalogos?.campaigns || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.titulo} {!c.activa && '(Inactiva)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Turno */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Turno de Caja</Label>
            <Select value={shiftId} onValueChange={handleShiftChange}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todos los turnos" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="ALL">Todos los turnos</SelectItem>
                {(catalogos?.shifts || []).map((s: any) => {
                  const isCurrent = s.id === sg?.shiftId;
                  const formattedDate = format(new Date(s.opened_at), 'dd/MM/yy HH:mm');
                  return (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {isCurrent ? '🌟 ' : ''}Turno #{s.shift_number || s.id.substring(0, 5)} ({formattedDate})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Estado de Predicción */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Estado de Predicción</Label>
            <Select value={estadoPrediccion} onValueChange={setEstadoPrediccion}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="PENDIENTE">⏳ Pendientes</SelectItem>
                <SelectItem value="GANADA">✅ Ganadoras</SelectItem>
                <SelectItem value="PERDIDA">❌ Perdedoras</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Estado del Cupón */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Estado del Cupón</Label>
            <Select value={estadoCupon} onValueChange={setEstadoCupon}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos</SelectItem>
                <SelectItem value="CON_CUPON">🎟️ Con Código de Cupón</SelectItem>
                <SelectItem value="VIGENTE">🟢 Vigentes (Sin usar / No expirados)</SelectItem>
                <SelectItem value="USADO">🟣 Usados</SelectItem>
                <SelectItem value="EXPIRADO">🔴 Expirados</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Cajero / Registrador */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Registrado Por</Label>
            <Select value={creatorId} onValueChange={setCreatorId}>
              <SelectTrigger className="h-10 rounded-xl bg-background/80 border-border/80 text-xs">
                <SelectValue placeholder="Todos los usuarios" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="ALL">Todos los usuarios</SelectItem>
                {(catalogos?.profiles || []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.first_name || p.username} {p.last_name || ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Búsqueda de Comensal */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Comensal (Cédula o Nombre)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={busquedaCliente}
                onChange={(e) => setBusquedaCliente(e.target.value)}
                className="h-10 pl-9 rounded-xl bg-background/80 border-border/80 text-xs font-medium"
              />
            </div>
          </div>

          {/* Búsqueda de Orden */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-muted-foreground">Orden (Código o Número)</Label>
            <div className="relative">
              <Receipt className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar orden..."
                value={busquedaOrden}
                onChange={(e) => setBusquedaOrden(e.target.value)}
                className="h-10 pl-9 rounded-xl bg-background/80 border-border/80 text-xs font-medium"
              />
            </div>
          </div>
        </div>

        {/* Botones Acciones Filtro */}
        <div className="flex justify-end gap-2 border-t border-border/60 mt-5 pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClearFilters}
            className="rounded-xl h-10 px-4 text-xs font-bold"
          >
            Limpiar Filtros
          </Button>
          <Button
            type="button"
            onClick={handleApplyFilters}
            className="rounded-xl h-10 px-5 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/95"
          >
            Aplicar Filtros
          </Button>
        </div>
      </div>

      {/* KPIs Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4">
        {/* Total Participaciones */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-indigo-500/10 to-violet-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-indigo-500/15 p-2.5 text-indigo-600 dark:text-indigo-400">
                <Gift className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-500/10 rounded-full px-2 py-0.5">
                Participaciones
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Registradas</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {kpis.totalParticipaciones} <span className="text-xs font-normal text-muted-foreground">comensales</span>
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* Predicciones Ganadoras */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-500/10 rounded-full px-2 py-0.5">
                {ganadasPct}% Acierto
              </div>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Predicciones Ganadas</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {kpis.ganadasCount} <span className="text-xs font-normal text-muted-foreground">aciertos</span>
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* Descuento Otorgado */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-blue-500/10 to-sky-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-blue-500/15 p-2.5 text-blue-600 dark:text-blue-400">
                <Tag className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-bold text-blue-600 bg-blue-500/10 rounded-full px-2 py-0.5">
                Descuentos
              </span>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Ahorro Otorgado</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {formatCurrency(kpis.totalMontoDescuento)}
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* Cupones Usados */}
        <Card className="overflow-hidden rounded-3xl border border-border/80 bg-gradient-to-br from-fuchsia-500/10 to-pink-500/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="rounded-2xl bg-fuchsia-500/15 p-2.5 text-fuchsia-600 dark:text-fuchsia-400">
                <Ticket className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold text-fuchsia-600 bg-fuchsia-500/10 rounded-full px-2 py-0.5">
                {cuponesUsadosPct}% Redención
              </div>
            </div>
            <div className="mt-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cupones Redimidos</span>
              <h3 className="font-display text-2xl font-black text-foreground mt-0.5">
                {kpis.cuponesUsadosCount} <span className="text-xs font-normal text-muted-foreground">usados</span>
              </h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resultados y Tabla */}
      <div className="space-y-4">
        <div className="flex justify-between items-center print:hidden">
          <h4 className="font-display text-sm font-bold text-foreground">Listado de Participaciones</h4>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={records.length === 0}
              className="rounded-xl h-9 text-xs font-bold gap-1.5"
            >
              <FileDown className="h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {queryLoading ? (
          <div className="flex flex-col justify-center items-center p-12 space-y-4">
            <RefreshCw className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-medium">Cargando registros...</p>
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-destructive/20 bg-destructive/10 p-6 text-center max-w-lg mx-auto my-8">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <h3 className="font-display text-base font-bold text-destructive">Error al cargar datos</h3>
            <p className="text-xs text-muted-foreground mt-1">{(error as any)?.message || 'Ha ocurrido un error inesperado al consultar Supabase.'}</p>
            <Button onClick={() => refetch()} variant="outline" className="mt-4 rounded-xl text-xs font-bold border-destructive/20 hover:bg-destructive/10">
              Reintentar consulta
            </Button>
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center">
            <Gift className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
            <h4 className="font-display text-sm font-bold text-foreground">No se encontraron participaciones</h4>
            <p className="text-xs text-muted-foreground mt-1">Ajusta los criterios de búsqueda en el panel de filtros superior.</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-border/80 bg-card overflow-hidden shadow-none">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="font-bold text-foreground py-3 text-xs">Fecha y Hora</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs">Orden</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs">Cliente</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs">Campaña</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs">Predicción Elegida</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs text-center">Estado</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs text-center">Cupón / Estado</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs text-right">Monto Descuento</TableHead>
                  <TableHead className="font-bold text-foreground py-3 text-xs">Registrado Por</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r: any) => {
                  const ref = getOrderRef(r.orden?.order_code, r.orden?.order_number);
                  const isCurrentTime = new Date().getTime();

                  // Determinar estado de cupón para mostrar en badge
                  let couponBadge = null;
                  if (r.codigo_cupon) {
                    if (r.cupon_usado_el) {
                      couponBadge = (
                        <div className="flex flex-col items-center">
                          <Badge className="bg-purple-600 text-white rounded-lg text-[9px] font-bold py-0.5">
                            🟣 USADO
                          </Badge>
                          <span className="text-[9px] text-muted-foreground font-mono mt-0.5" title="Fecha de uso">
                            {format(new Date(r.cupon_usado_el), 'dd/MM/yy HH:mm')}
                          </span>
                        </div>
                      );
                    } else if (r.fecha_caducidad_cupon && new Date(r.fecha_caducidad_cupon).getTime() < isCurrentTime) {
                      couponBadge = (
                        <div className="flex flex-col items-center">
                          <Badge className="bg-destructive text-white rounded-lg text-[9px] font-bold py-0.5">
                            🔴 EXPIRADO
                          </Badge>
                          <span className="text-[9px] text-muted-foreground font-mono mt-0.5" title="Fecha de expiración">
                            Exp: {format(new Date(r.fecha_caducidad_cupon), 'dd/MM/yy')}
                          </span>
                        </div>
                      );
                    } else {
                      couponBadge = (
                        <div className="flex flex-col items-center">
                          <Badge className="bg-emerald-600 text-white rounded-lg text-[9px] font-bold py-0.5">
                            🟢 VIGENTE
                          </Badge>
                          {r.fecha_caducidad_cupon && (
                            <span className="text-[9px] text-muted-foreground font-mono mt-0.5" title="Fecha de expiración">
                              Exp: {format(new Date(r.fecha_caducidad_cupon), 'dd/MM/yy')}
                            </span>
                          )}
                        </div>
                      );
                    }
                  }

                  return (
                    <TableRow key={r.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(r.creado_el), 'dd/MM/yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="font-mono font-bold text-xs">
                        <div className="flex flex-col">
                          <span>{ref}</span>
                          <span className="text-[10px] font-medium text-muted-foreground">
                            Total: {formatCurrency(r.orden?.total || 0)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.cliente ? (
                          <div className="flex flex-col min-w-[120px]">
                            <span className="font-semibold text-foreground">
                              {r.cliente.nombres} {r.cliente.apellidos}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              C.I.: {r.cliente.cedula}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic text-[11px]">Sin cliente</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-foreground max-w-[150px] truncate" title={r.campana?.titulo}>
                        {r.campana?.titulo || 'Campaña Eliminada'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" title={getOfertaDescripcion(r.campana, r.oferta_seleccionada_id)}>
                        {getOfertaDescripcion(r.campana, r.oferta_seleccionada_id)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          className={`rounded-lg text-[9px] font-bold py-0.5 border-none shadow-none ${
                            r.estado_prediccion === 'GANADA'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : r.estado_prediccion === 'PENDIENTE'
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : 'bg-red-500/10 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {r.estado_prediccion}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {r.codigo_cupon ? (
                          <div className="flex flex-col items-center space-y-1">
                            <span className="font-mono font-bold text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/40">
                              {r.codigo_cupon}
                            </span>
                            {couponBadge}
                          </div>
                        ) : (
                          <span className="text-muted-foreground/60 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right font-bold text-foreground">
                        {r.estado_prediccion === 'GANADA' && r.monto_descuento_ganado
                          ? formatCurrency(r.monto_descuento_ganado)
                          : formatCurrency(0)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.registrador ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">
                              {r.registrador.first_name || r.registrador.username}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {r.registrador.last_name || ''}
                            </span>
                          </div>
                        ) : (
                          <span className="italic">Sistema</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
