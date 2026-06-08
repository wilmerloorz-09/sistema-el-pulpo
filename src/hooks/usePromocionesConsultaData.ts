import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PromocionesConsultaFilters {
  branchId: string;
  campanaId: string | 'ALL';
  estadoPrediccion: string | 'ALL';
  estadoCupon: string | 'ALL';
  desde: string | null; // ISOString
  hasta: string | null; // ISOString
  shiftId: string | null;
  creatorId: string | null;
  busquedaCliente: string;
  busquedaOrden: string;
}

export function usePromocionesFiltrosCatalogos(branchId: string) {
  return useQuery({
    queryKey: ['promociones-filtros-catalogos', branchId],
    queryFn: async () => {
      if (!branchId) return { campaigns: [], profiles: [], shifts: [] };

      // 1. Cargar todas las campañas promocionales
      const { data: campaignsData, error: campaignsError } = await supabase
        .from('campanas_promocionales')
        .select('id, titulo, activa, cartelera_ofertas')
        .order('creado_el', { ascending: false });

      if (campaignsError) throw campaignsError;

      // 2. Cargar perfiles activos de usuarios (para cajeros / registradores)
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, full_name, username')
        .eq('is_active', true);

      if (profilesError) throw profilesError;

      // 3. Cargar últimos 100 turnos de caja
      let shiftsQuery = supabase
        .from('cash_shifts')
        .select('id, opened_at, closed_at, shift_number, shift_code')
        .order('opened_at', { ascending: false })
        .limit(100);

      if (branchId !== 'ALL') {
        shiftsQuery = shiftsQuery.eq('branch_id', branchId);
      }

      const { data: shiftsData, error: shiftsError } = await shiftsQuery;
      if (shiftsError) throw shiftsError;

      return {
        campaigns: campaignsData || [],
        profiles: profilesData || [],
        shifts: shiftsData || [],
      };
    },
    enabled: !!branchId,
  });
}

export function usePromocionesConsultaData(filters: PromocionesConsultaFilters) {
  const {
    branchId,
    campanaId,
    estadoPrediccion,
    estadoCupon,
    desde,
    hasta,
    shiftId,
    creatorId,
    busquedaCliente,
    busquedaOrden,
  } = filters;

  return useQuery({
    queryKey: [
      'promociones-consulta-data',
      branchId,
      campanaId,
      estadoPrediccion,
      estadoCupon,
      desde,
      hasta,
      shiftId,
      creatorId,
      busquedaCliente,
      busquedaOrden,
    ],
    queryFn: async () => {
      if (!branchId) {
        return {
          records: [],
          kpis: {
            totalParticipaciones: 0,
            ganadasCount: 0,
            pendientesCount: 0,
            perdidasCount: 0,
            totalMontoDescuento: 0,
            cuponesUsadosCount: 0,
          },
        };
      }

      // Consulta base a predicciones_clientes con joins
      let query = supabase
        .from('predicciones_clientes')
        .select(`
          id,
          campana_id,
          orden_id,
          cliente_id,
          oferta_seleccionada_id,
          estado_prediccion,
          monto_descuento_ganado,
          codigo_cupon,
          cupon_usado_el,
          fecha_caducidad_cupon,
          registrado_por,
          creado_el,
          campana:campanas_promocionales (id, titulo, consumo_minimo, porcentaje_descuento, activa, cartelera_ofertas),
          orden:orders!inner (
            id,
            order_code,
            order_number,
            order_type,
            total,
            status,
            branch_id,
            cash_shift_id
          ),
          cliente:clientes (id, cedula, nombres, apellidos),
          registrador:profiles!predicciones_clientes_registrado_por_fkey (id, first_name, last_name, full_name, username)
        `);

      // Filtrar por sucursal
      if (branchId !== 'ALL') {
        query = query.eq('orden.branch_id', branchId);
      }

      // Filtrar por campaña
      if (campanaId && campanaId !== 'ALL') {
        query = query.eq('campana_id', campanaId);
      }

      // Filtrar por estado de la predicción
      if (estadoPrediccion && estadoPrediccion !== 'ALL') {
        query = query.eq('estado_prediccion', estadoPrediccion);
      }

      // Filtrar por cajero/registrador de la participación
      if (creatorId && creatorId !== 'ALL') {
        query = query.eq('registrado_por', creatorId);
      }

      // Filtrar por turno operativo de la orden
      if (shiftId && shiftId !== 'ALL') {
        query = query.eq('orden.cash_shift_id', shiftId);
      }

      // Filtrar por fechas
      if (desde) {
        query = query.gte('creado_el', desde);
      }
      if (hasta) {
        query = query.lte('creado_el', hasta);
      }

      // Filtrar por estado del cupón
      const now = new Date().toISOString();
      if (estadoCupon && estadoCupon !== 'ALL') {
        if (estadoCupon === 'CON_CUPON') {
          query = query.not('codigo_cupon', 'is', null);
        } else if (estadoCupon === 'USADO') {
          query = query.not('cupon_usado_el', 'is', null);
        } else if (estadoCupon === 'VIGENTE') {
          query = query
            .is('cupon_usado_el', null)
            .not('codigo_cupon', 'is', null)
            .or(`fecha_caducidad_cupon.gte.${now},fecha_caducidad_cupon.is.null`);
        } else if (estadoCupon === 'EXPIRADO') {
          query = query
            .is('cupon_usado_el', null)
            .not('codigo_cupon', 'is', null)
            .lt('fecha_caducidad_cupon', now);
        }
      }

      const { data, error } = await query.order('creado_el', { ascending: false });
      if (error) throw error;

      let records = data || [];

      // Filtrar por comensal (nombre o cédula)
      if (busquedaCliente && busquedaCliente.trim() !== '') {
        const queryClean = busquedaCliente.toLowerCase().trim();
        records = records.filter((r: any) => {
          if (!r.cliente) return false;
          const cedulaMatch = String(r.cliente.cedula || '').toLowerCase().includes(queryClean);
          const nombresMatch = String(r.cliente.nombres || '').toLowerCase().includes(queryClean);
          const apellidosMatch = String(r.cliente.apellidos || '').toLowerCase().includes(queryClean);
          const nombreCompleto = `${r.cliente.nombres || ''} ${r.cliente.apellidos || ''}`.toLowerCase();
          return cedulaMatch || nombresMatch || apellidosMatch || nombreCompleto.includes(queryClean);
        });
      }

      // Filtrar por orden (código o número)
      if (busquedaOrden && busquedaOrden.trim() !== '') {
        const queryClean = busquedaOrden.toLowerCase().trim();
        records = records.filter((r: any) => {
          if (!r.orden) return false;
          const codeMatch = String(r.orden.order_code || '').toLowerCase().includes(queryClean);
          const numMatch = String(r.orden.order_number || '').toLowerCase().includes(queryClean);
          return codeMatch || numMatch;
        });
      }

      // Calcular KPIs
      const totalParticipaciones = records.length;
      const ganadasCount = records.filter((r: any) => r.estado_prediccion === 'GANADA').length;
      const pendientesCount = records.filter((r: any) => r.estado_prediccion === 'PENDIENTE').length;
      const perdidasCount = records.filter((r: any) => r.estado_prediccion === 'PERDIDA').length;

      const totalMontoDescuento = records.reduce((sum: number, r: any) => {
        if (r.estado_prediccion === 'GANADA' && r.monto_descuento_ganado) {
          return sum + Number(r.monto_descuento_ganado);
        }
        return sum;
      }, 0);

      const cuponesUsadosCount = records.filter((r: any) => r.cupon_usado_el).length;

      return {
        records,
        kpis: {
          totalParticipaciones,
          ganadasCount,
          pendientesCount,
          perdidasCount,
          totalMontoDescuento,
          cuponesUsadosCount,
        },
      };
    },
    enabled: !!branchId,
  });
}
