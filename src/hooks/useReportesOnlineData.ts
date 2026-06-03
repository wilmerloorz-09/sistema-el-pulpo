import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getOrderRef } from '@/lib/orderPresentation';

export interface ReportesFilters {
  branchId: string;
  desde: string | null; // ISOString
  hasta: string | null; // ISOString
  shiftId: string | null;
  cashierId: string | null;
  creatorId: string | null;
  productIds: string[] | null;
  orderTypes: string[] | null;
  supervisorId?: string | null; // Usado en anulaciones
}

// Helper para redondear a 2 decimales de forma segura
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

// Resolver nombres de usuarios creadores
export function getProfileLabel(profile: any): string {
  if (!profile) return 'Usuario';
  return (
    profile.first_name ||
    profile.full_name ||
    profile.username ||
    (profile.last_name ? `${profile.first_name} ${profile.last_name}` : '') ||
    'Usuario'
  ).trim();
}

/**
 * Carga inicial de datos para filtros (turnos, perfiles de cajeros/usuarios, productos)
 */
export function useReportesFiltros(branchId: string) {
  return useQuery({
    queryKey: ['reportes-filtros-data', branchId, 'v2'],
    queryFn: async () => {
      if (!branchId) return { shifts: [], profiles: [], products: [] };

      // 1. Cargar turnos de la sucursal (últimos 100)
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

      // 2. Cargar perfiles asociados a la sucursal (o globales)
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, full_name, username')
        .eq('is_active', true);

      if (profilesError) throw profilesError;

      // 3. Cargar el árbol de menú (categorías y productos)
      let menuQuery = supabase
        .from('menu_nodes')
        .select('id, parent_id, name, node_type, legacy_product_id, is_active, menu_scope')
        .order('depth', { ascending: true })
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (branchId !== 'ALL') {
        menuQuery = menuQuery.eq('branch_id', branchId);
      }

      const { data: menuNodesData, error: menuNodesError } = await menuQuery;

      if (menuNodesError) throw menuNodesError;

      // 4. Cargar productos legacy para fallback de nombres
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('id, description')
        .order('description', { ascending: true });

      if (productsError) throw productsError;

      return {
        shifts: shiftsData || [],
        profiles: profilesData || [],
        menuNodes: menuNodesData || [],
        products: productsData || [],
      };
    },
    enabled: !!branchId,
  });
}

/**
 * Reporte 1: Pagos Realizados (Ingresos Reales)
 */
export function useReportesPagos(filters: ReportesFilters) {
  const { branchId, desde, hasta, shiftId, cashierId, creatorId, productIds, orderTypes } = filters;

  return useQuery({
    queryKey: ['reportes-pagos', branchId, desde, hasta, shiftId, cashierId, creatorId, productIds, orderTypes],
    queryFn: async () => {
      if (!branchId) return { payments: [], kpis: { totalNeto: 0, desglose: {}, ticketPromedio: 0, transacciones: 0 } };

      // Si hay filtros de producto, primero obtenemos las órdenes que contienen esos productos
      let orderIdsFilter: string[] | null = null;
      if (productIds && productIds.length > 0) {
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select('order_id')
          .in('product_id', productIds);
        
        if (itemsError) throw itemsError;
        orderIdsFilter = Array.from(new Set((itemsData || []).map((item) => item.order_id)));
        
        // Si no hay órdenes con estos productos, devolvemos resultado vacío inmediatamente
        if (orderIdsFilter.length === 0) {
          return {
            payments: [],
            kpis: { totalNeto: 0, desglose: { Efectivo: 0, Transferencia: 0, Tarjeta: 0 }, ticketPromedio: 0, transacciones: 0 }
          };
        }
      }

      // Consulta base a payments
      let query = supabase
        .from('payments')
        .select(`
          id,
          amount,
          change_amount,
          created_at,
          created_by,
          payment_method_id,
          shift_id,
          notes,
          payment_methods!inner (id, name, branch_id),
          cashier:profiles!payments_created_by_fkey (id, first_name, last_name, full_name, username),
          order:orders!inner (
            id,
            order_code,
            order_number,
            created_by,
            order_type,
            is_special,
            branch_id,
            creator:profiles!orders_created_by_fkey (id, first_name, last_name, full_name, username)
          )
        `)
        .in('status', ['COMPLETED', 'active']); // Solo pagos válidos/pagados (excluyendo anulados que tienen otro status)

      if (branchId !== 'ALL') {
        query = query.eq('order.branch_id', branchId);
      }

      // Aplicar filtros de fecha/hora
      if (desde) query = query.gte('created_at', desde);
      if (hasta) query = query.lte('created_at', hasta);

      // Aplicar turno
      if (shiftId) query = query.eq('shift_id', shiftId);

      // Aplicar cajero (quien cobró el pago)
      if (cashierId) query = query.eq('created_by', cashierId);

      // Aplicar usuario creador de la orden
      if (creatorId) query = query.eq('order.created_by', creatorId);

      // Aplicar tipos de orden en DB (excluyendo SPECIAL que no es enum válido en DB)
      if (orderTypes && orderTypes.length > 0) {
        const dbTypes = orderTypes.filter(t => t !== 'SPECIAL');
        if (dbTypes.length > 0) {
          query = query.in('order.order_type', dbTypes);
        }
      }

      // Aplicar filtro de productos resuelto anteriormente
      if (orderIdsFilter) {
        query = query.in('order_id', orderIdsFilter);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      // Filtrar en memoria por orderType efectivo para abarcar SPECIAL
      const paymentsRaw = (data || []).filter((pay: any) => {
        if (!orderTypes || orderTypes.length === 0) return true;
        const effectiveType = pay.order?.is_special ? 'SPECIAL' : (pay.order?.order_type || 'EXTRA');
        return orderTypes.includes(effectiveType);
      });

      // Procesar datos y calcular KPIs
      let totalNetoSum = 0;
      const desgloseMap: Record<string, number> = {};
      const uniqueOrderIds = new Set<string>();

      const processedPayments = paymentsRaw.map((pay: any) => {
        let dbAmount = Number(pay.amount || 0);
        let change = Number(pay.change_amount || 0);
        let tenderedAmount = dbAmount;
        let netApplied = round2(Math.max(0, dbAmount - change));

        if (pay.notes) {
          const match = pay.notes.match(/TENDERED:([0-9.]+)/);
          if (match && match[1]) {
            tenderedAmount = Number(match[1]);
            // En el flujo actual, dbAmount es el monto aplicado, y tendered es el recibido
            change = Math.max(0, tenderedAmount - dbAmount);
            netApplied = dbAmount;
          }
        }

        totalNetoSum = round2(totalNetoSum + netApplied);

        const methodName = pay.payment_methods?.name || 'Otro';
        desgloseMap[methodName] = round2((desgloseMap[methodName] || 0) + netApplied);

        if (pay.order?.id) {
          uniqueOrderIds.add(pay.order.id);
        }

        return {
          id: pay.id,
          orderId: pay.order?.id,
          orderCode: pay.order?.order_code,
          orderNumber: pay.order?.order_number,
          createdAt: pay.created_at,
          cashierName: getProfileLabel(pay.cashier),
          creatorName: getProfileLabel(pay.order?.creator),
          methodName,
          amount: tenderedAmount,
          change,
          netApplied,
          orderType: pay.order?.is_special ? 'SPECIAL' : (pay.order?.order_type || 'EXTRA'),
          notes: pay.notes
        };
      });

      const transacciones = processedPayments.length;
      const ticketPromedio = uniqueOrderIds.size > 0 ? round2(totalNetoSum / uniqueOrderIds.size) : 0;

      return {
        payments: processedPayments,
        kpis: {
          totalNeto: round2(totalNetoSum),
          desglose: desgloseMap,
          ticketPromedio,
          transacciones
        }
      };
    },
    enabled: !!branchId,
  });
}

/**
 * Reporte 2: Anulación de Pagos (Trazabilidad y Auditoría)
 */
export function useReportesAnulaciones(filters: ReportesFilters) {
  const { branchId, desde, hasta, shiftId, cashierId, supervisorId } = filters;

  return useQuery({
    queryKey: ['reportes-anulaciones', branchId, desde, hasta, shiftId, cashierId, supervisorId],
    queryFn: async () => {
      if (!branchId) return { voids: [], kpis: { totalAnulado: 0, incidentes: 0, topSupervisor: 'Ninguno' } };

      let query = supabase
        .from('payment_void_requests')
        .select(`
          id,
          created_at,
          approved_at,
          reason,
          refund_amount,
          replacement_payment_id,
          status,
          requested_by_user_id,
          approved_by_supervisor_id,
          shift_id,
          cashier:profiles!payment_void_requests_requested_by_user_id_fkey (id, first_name, last_name, full_name, username),
          supervisor:profiles!payment_void_requests_approved_by_supervisor_id_fkey (id, first_name, last_name, full_name, username),
          order:orders!inner (
            id,
            order_code,
            order_number,
            branch_id,
            notes
          )
        `)
        .in('status', ['approved', 'executed']);

      if (branchId !== 'ALL') {
        query = query.eq('order.branch_id', branchId);
      }

      // Filtros
      if (desde) query = query.gte('created_at', desde);
      if (hasta) query = query.lte('created_at', hasta);
      if (shiftId) query = query.eq('shift_id', shiftId);
      if (cashierId) query = query.eq('requested_by_user_id', cashierId);
      if (supervisorId) query = query.eq('approved_by_supervisor_id', supervisorId);

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;

      const voidsRaw = data || [];

      // Paso extra: Extraer IDs de sucesoras a partir de las notas de la orden histórica
      const successorOrderIds: string[] = [];
      const voidIdToSuccessorIdMap: Record<string, string> = {};

      voidsRaw.forEach((v: any) => {
        const notes = v.order?.notes || '';
        const match = notes.match(/VOID_SUCCESSOR_ORDER:([a-f0-9-]{36})/i);
        if (match && match[1]) {
          const succId = match[1];
          successorOrderIds.push(succId);
          voidIdToSuccessorIdMap[v.id] = succId;
        }
      });

      // Consultar por lotes las órdenes sucesoras para traer sus códigos
      const successorMap: Record<string, { code: string | null; number: number | null }> = {};
      if (successorOrderIds.length > 0) {
        const { data: succOrders, error: succError } = await supabase
          .from('orders')
          .select('id, order_code, order_number')
          .in('id', successorOrderIds);

        if (!succError && succOrders) {
          succOrders.forEach((o) => {
            successorMap[o.id] = { code: o.order_code, number: o.order_number };
          });
        }
      }

      // Procesar filas y calcular KPIs
      let totalAnuladoSum = 0;
      const supervisorCounts: Record<string, number> = {};

      const processedVoids = voidsRaw.map((v: any) => {
        const refund = Number(v.refund_amount || 0);
        totalAnuladoSum = round2(totalAnuladoSum + refund);

        const supervisorName = getProfileLabel(v.supervisor);
        if (v.approved_by_supervisor_id) {
          supervisorCounts[supervisorName] = (supervisorCounts[supervisorName] || 0) + 1;
        }

        const succId = voidIdToSuccessorIdMap[v.id];
        const succInfo = succId ? successorMap[succId] : null;

        return {
          id: v.id,
          orderId: v.order?.id,
          orderCode: succInfo
            ? getOrderRef(succInfo.code, succInfo.number)
            : getOrderRef(v.order?.order_code, v.order?.order_number),
          orderNumber: succInfo?.number ?? v.order?.order_number,
          successorId: succId || null,
          successorCode: succInfo?.code || null,
          successorNumber: succInfo?.number || null,
          createdAt: v.created_at,
          approvedAt: v.approved_at,
          cashierName: getProfileLabel(v.cashier),
          supervisorName,
          reason: v.reason || 'Sin motivo especificado',
          refundAmount: refund,
          replacementPaymentId: v.replacement_payment_id
        };
      });

      // Encontrar supervisor con más autorizaciones
      let topSupervisor = 'Ninguno';
      let maxAuths = 0;
      Object.entries(supervisorCounts).forEach(([name, count]) => {
        if (count > maxAuths) {
          maxAuths = count;
          topSupervisor = name;
        }
      });

      return {
        voids: processedVoids,
        kpis: {
          totalAnulado: round2(totalAnuladoSum),
          incidentes: processedVoids.length,
          topSupervisor
        }
      };
    },
    enabled: !!branchId,
  });
}

/**
 * Reporte 3: Productos Vendidos (Métricas de Cocina/Venta)
 */
export function useReportesProductos(filters: ReportesFilters) {
  const { branchId, desde, hasta, shiftId, creatorId, productIds, orderTypes } = filters;

  return useQuery({
    queryKey: ['reportes-productos-vendidos', branchId, desde, hasta, shiftId, creatorId, productIds, orderTypes],
    queryFn: async () => {
      if (!branchId) return { productsSold: [], kpis: { top3: [], totalUnidades: 0 }, rawTimeData: [] };

      // Consulta de order_items con joins
      let query = supabase
        .from('order_items')
        .select(`
          id,
          product_id,
          quantity,
          unit_price,
          total,
          status,
          cancelled_at,
          description_snapshot,
          created_at,
          order:orders!inner (
            id,
            order_code,
            order_number,
            branch_id,
            created_at,
            order_type,
            is_special,
            status,
            cash_shift_id
          ),
          product:products (
            id,
            description,
            subcategory:subcategories (
              id,
              description,
              category:categories (
                id,
                description
              )
            )
          )
        `)
        .neq('order.status', 'DRAFT') // Excluir borradores
        .is('cancelled_at', null) // Excluir anulaciones directas de ítems
        .not('status', 'eq', 'CANCELLED'); // Excluir ítems con estado cancelado

      if (branchId !== 'ALL') {
        query = query.eq('order.branch_id', branchId);
      }

      // Filtros de fecha en la orden
      if (desde) query = query.gte('order.created_at', desde);
      if (hasta) query = query.lte('order.created_at', hasta);

      // Filtro de turno
      if (shiftId) query = query.eq('order.cash_shift_id', shiftId);

      // Filtro de creador de la orden
      if (creatorId) query = query.eq('order.created_by', creatorId);

      // Filtro de producto
      if (productIds && productIds.length > 0) {
        query = query.in('product_id', productIds);
      }

      // Filtro de tipos de orden en DB
      if (orderTypes && orderTypes.length > 0) {
        const dbTypes = orderTypes.filter(t => t !== 'SPECIAL');
        if (dbTypes.length > 0) {
          query = query.in('order.order_type', dbTypes);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filtrar en memoria por orderType efectivo para abarcar SPECIAL
      const itemsRaw = (data || []).filter((item: any) => {
        if (!orderTypes || orderTypes.length === 0) return true;
        const effectiveType = item.order?.is_special ? 'SPECIAL' : (item.order?.order_type || 'EXTRA');
        return orderTypes.includes(effectiveType);
      });

      // Agrupamiento en cliente por product_id + unit_price (y fallback a description_snapshot si no hay product)
      const groupedMap = new Map<string, {
        productId: string;
        name: string;
        category: string;
        quantityTotal: number;
        unitPrice: number;
        totalRecaudado: number;
        orderTypesCount: Record<string, number>;
      }>();

      let totalUnidadesSum = 0;

      // Dataset para el gráfico de tendencias por hora/fecha
      // Estructuraremos los datos por hora (si es rango corto) o por día (si es rango largo)
      const timeDataMap: Record<string, { dateStr: string; ventas: number; ordersCount: number }> = {};

      itemsRaw.forEach((item: any) => {
        const qty = Number(item.quantity || 0);
        const itemTotal = round2(Number(item.total || 0));
        const price = Number(item.unit_price || 0);

        totalUnidadesSum += qty;

        // Clave de agrupación
        const prodId = item.product_id || 'legacy-product';
        const prodName = item.product?.description || item.description_snapshot || 'Producto Sin Nombre';
        
        // Obtener categoría
        const categoryName = item.product?.subcategory?.category?.description || 
                             item.product?.subcategory?.description || 
                             'Sin Categoría';

        const groupKey = `${prodId}-${price}`;

        const existing = groupedMap.get(groupKey);
        if (existing) {
          existing.quantityTotal += qty;
          existing.totalRecaudado = round2(existing.totalRecaudado + itemTotal);
          const type = item.order?.is_special ? 'SPECIAL' : (item.order?.order_type || 'EXTRA');
          existing.orderTypesCount[type] = (existing.orderTypesCount[type] || 0) + qty;
        } else {
          const type = item.order?.is_special ? 'SPECIAL' : (item.order?.order_type || 'EXTRA');
          groupedMap.set(groupKey, {
            productId: prodId,
            name: prodName,
            category: categoryName,
            quantityTotal: qty,
            unitPrice: price,
            totalRecaudado: itemTotal,
            orderTypesCount: { [type]: qty }
          });
        }

        // Procesar tendencias de ventas en el tiempo (por ejemplo, agrupar por hora o fecha)
        const orderDate = new Date(item.order?.created_at || item.created_at);
        // Formato: AAAA-MM-DD HH:00
        const isRangoCorto = !desde || (new Date(hasta || new Date()).getTime() - new Date(desde).getTime() < 3 * 24 * 60 * 60 * 1000); // menos de 3 días
        
        const dateKey = isRangoCorto
          ? `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${String(orderDate.getDate()).padStart(2, '0')} ${String(orderDate.getHours()).padStart(2, '0')}:00`
          : `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${String(orderDate.getDate()).padStart(2, '0')}`;

        if (!timeDataMap[dateKey]) {
          timeDataMap[dateKey] = {
            dateStr: isRangoCorto ? `${String(orderDate.getHours()).padStart(2, '0')}:00` : `${String(orderDate.getDate()).padStart(2, '0')}/${String(orderDate.getMonth() + 1).padStart(2, '0')}`,
            ventas: 0,
            ordersCount: 0
          };
        }
        timeDataMap[dateKey].ventas = round2(timeDataMap[dateKey].ventas + itemTotal);
        timeDataMap[dateKey].ordersCount += 1;
      });

      // Convertir mapa de agrupados a array
      const productsSold = Array.from(groupedMap.values()).map((p) => {
        // Obtener el tipo de orden predominante
        let orderTypePredominante = 'EXTRA';
        let maxQty = 0;
        Object.entries(p.orderTypesCount).forEach(([type, q]) => {
          if (q > maxQty) {
            maxQty = q;
            orderTypePredominante = type;
          }
        });

        return {
          productId: p.productId,
          name: p.name,
          category: p.category,
          quantityTotal: p.quantityTotal,
          unitPriceAverage: p.unitPrice, // Ya que se agrupa por precio, el promedio es el mismo precio unitario
          totalRecaudado: round2(p.totalRecaudado),
          orderTypePredominante
        };
      }).sort((a, b) => b.quantityTotal - a.quantityTotal);

      // Calcular Top 3 productos
      const top3 = productsSold.slice(0, 3).map((p, idx) => ({
        pos: idx + 1,
        name: p.name,
        qty: p.quantityTotal,
        total: p.totalRecaudado
      }));

      // Convertir tendencias a array ordenado por tiempo
      const rawTimeData = Object.entries(timeDataMap).map(([key, val]) => ({
        timestamp: key,
        label: val.dateStr,
        ventas: val.ventas,
        ordenes: val.ordersCount
      })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      return {
        productsSold,
        kpis: {
          top3,
          totalUnidades: totalUnidadesSum
        },
        rawTimeData
      };
    },
    enabled: !!branchId,
  });
}
