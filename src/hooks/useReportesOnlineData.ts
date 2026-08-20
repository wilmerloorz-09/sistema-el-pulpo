import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getOrderRef } from '@/lib/orderPresentation';
import { getUserDisplayName } from '@/lib/userDisplay';

export interface ReportesFilters {
  branchId: string;
  desde: string | null; // ISOString
  hasta: string | null; // ISOString
  shiftId: string | null;
  cashierId: string | null;
  creatorId: string | null;
  productIds: string[] | null;
  orderTypes: string[] | null;
  supervisorId?: string | null; // legacy (anulaciones)
  /** Todos = válidos + anulados; por defecto todos. */
  recordStatus?: 'all' | 'valid' | 'voided';
  /** Criterio de orden (cada reporte interpreta el que aplica). */
  sortBy?: string | null;
  sortDir?: 'asc' | 'desc';
}

export type ReportesRecordStatus = NonNullable<ReportesFilters['recordStatus']>;

/** Pago anulado/reversado por status, notas o voided_at. */
export function isReportPaymentVoided(pay: {
  status?: string | null;
  notes?: string | null;
  voided_at?: string | null;
}): boolean {
  const st = String(pay.status ?? '').toLowerCase();
  if (st === 'voided' || st === 'reversed') return true;
  if (pay.voided_at) return true;
  const notes = String(pay.notes ?? '');
  return notes.includes('VOIDED:') || notes.includes('REVERSED:');
}

function compareText(a: string, b: string) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base' });
}

function applySortDir(cmp: number, dir: 'asc' | 'desc') {
  return dir === 'asc' ? cmp : -cmp;
}

/** Tope de seguridad: sin fechas el reporte no debe barrer toda la historia. */
const REPORTES_MAX_LOOKBACK_DAYS = 31;

function resolveReportesDateBounds(desde: string | null, hasta: string | null): { desde: string; hasta: string } {
  const now = new Date();
  const resolvedHasta = hasta ? new Date(hasta) : now;
  let resolvedDesde = desde ? new Date(desde) : new Date(resolvedHasta);

  if (!desde) {
    resolvedDesde.setDate(resolvedDesde.getDate() - REPORTES_MAX_LOOKBACK_DAYS);
  }

  // Evitar rangos invertidos o corruptos
  if (Number.isNaN(resolvedDesde.getTime()) || Number.isNaN(resolvedHasta.getTime()) || resolvedDesde > resolvedHasta) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    return { desde: start.toISOString(), hasta: end.toISOString() };
  }

  return { desde: resolvedDesde.toISOString(), hasta: resolvedHasta.toISOString() };
}

// Helper para redondear a 2 decimales de forma segura
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

// Resolver identificador operativo (alias) de perfiles en reportes
export function getProfileLabel(profile: any): string {
  return getUserDisplayName(profile);
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
        .select('id, alias, username, first_name, last_name, full_name')
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
    staleTime: 5 * 60_000,
  });
}

export type ReportesPagoItemRow = {
  rowKey: string;
  paymentId: string;
  orderId: string;
  orderCode: string | null;
  orderNumber: number | null;
  createdAt: string;
  cashierName: string;
  creatorName: string;
  methodName: string;
  amount: number;
  change: number;
  netApplied: number;
  orderType: string;
  branchName: string;
  itemId: string;
  itemProductCode: string;
  itemCategory: string;
  itemDescription: string;
  itemQuantity: number;
  itemUnitPrice: number;
  itemTotal: number;
};

function getProductCategoryLabel(item: {
  product?: {
    subcategory?: {
      description?: string | null;
      category?: { description?: string | null } | null;
    } | null;
  } | null;
} | null | undefined): string {
  return item?.product?.subcategory?.category?.description
    || item?.product?.subcategory?.description
    || 'Sin Categoría';
}

function getBranchName(order: {
  branch?: { name?: string | null } | null;
} | null | undefined): string {
  return String(order?.branch?.name ?? '').trim() || 'Sin Sucursal';
}

/**
 * Reporte 1: Pagos Realizados (Ingresos Reales)
 * Si itemBreakdown=true, también resuelve filas por ítem de cada orden cobrada.
 */
export function useReportesPagos(
  filters: ReportesFilters,
  options?: { itemBreakdown?: boolean },
) {
  const {
    branchId,
    desde,
    hasta,
    shiftId,
    cashierId,
    creatorId,
    productIds,
    orderTypes,
    recordStatus = 'all',
    sortBy = 'fecha',
    sortDir = 'asc',
  } = filters;
  const itemBreakdown = Boolean(options?.itemBreakdown);

  return useQuery({
    queryKey: [
      'reportes-pagos',
      branchId,
      desde,
      hasta,
      shiftId,
      cashierId,
      creatorId,
      productIds,
      orderTypes,
      recordStatus,
      sortBy,
      sortDir,
      itemBreakdown,
    ],
    queryFn: async () => {
      if (!branchId) {
        return {
          payments: [],
          itemRows: [] as ReportesPagoItemRow[],
          kpis: { totalNeto: 0, desglose: {}, ticketPromedio: 0, transacciones: 0 },
        };
      }

      const dateBounds = resolveReportesDateBounds(desde, hasta);

      // Si hay filtros de producto, primero obtenemos las órdenes que contienen esos productos
      // dentro del mismo rango de fechas (evita escanear order_items historicos completos).
      let orderIdsFilter: string[] | null = null;
      if (productIds && productIds.length > 0) {
        const { data: itemsData, error: itemsError } = await supabase
          .from('order_items')
          .select('order_id, order:orders!inner(id, branch_id, created_at)')
          .in('product_id', productIds)
          .gte('order.created_at', dateBounds.desde)
          .lte('order.created_at', dateBounds.hasta);
        
        if (itemsError) throw itemsError;
        let scoped = itemsData || [];
        if (branchId !== 'ALL') {
          scoped = scoped.filter((item: any) => item.order?.branch_id === branchId);
        }
        orderIdsFilter = Array.from(new Set(scoped.map((item: any) => item.order_id)));
        
        // Si no hay órdenes con estos productos, devolvemos resultado vacío inmediatamente
        if (orderIdsFilter.length === 0) {
          return {
            payments: [],
            itemRows: [] as ReportesPagoItemRow[],
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
          status,
          voided_at,
          payment_methods!inner (id, name, branch_id),
          cashier:profiles!payments_created_by_fkey (id, alias, username),
          order:orders!inner (
            id,
            order_code,
            order_number,
            created_by,
            order_type,
            is_special,
            branch_id,
            branch:branches (
              id,
              name
            ),
            creator:profiles!orders_created_by_fkey (id, alias, username)
          )
        `)
        .in('status', ['COMPLETED', 'active', 'voided', 'VOIDED', 'reversed', 'REVERSED']);

      if (branchId !== 'ALL') {
        query = query.eq('order.branch_id', branchId);
      }

      // Aplicar filtros de fecha/hora (siempre con tope de seguridad)
      query = query.gte('created_at', dateBounds.desde).lte('created_at', dateBounds.hasta);

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

      // Filtrar en memoria por orderType efectivo y estado válido/anulado
      const paymentsRaw = (data || []).filter((pay: any) => {
        if (orderTypes && orderTypes.length > 0) {
          const effectiveType = pay.order?.is_special ? 'SPECIAL' : (pay.order?.order_type || 'EXTRA');
          if (!orderTypes.includes(effectiveType)) return false;
        }
        const voided = isReportPaymentVoided(pay);
        if (recordStatus === 'valid') return !voided;
        if (recordStatus === 'voided') return voided;
        return true;
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
          branchName: getBranchName(pay.order),
          notes: pay.notes,
          status: pay.status ?? null,
          isVoided: isReportPaymentVoided(pay),
        };
      });

      const sortKey = String(sortBy || 'fecha');
      const dir = sortDir === 'asc' ? 'asc' : 'desc';
      processedPayments.sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'orden') {
          cmp = compareText(
            getOrderRef(a.orderCode, a.orderNumber),
            getOrderRef(b.orderCode, b.orderNumber),
          );
        } else if (sortKey === 'monto') {
          cmp = a.netApplied - b.netApplied;
        } else if (sortKey === 'cajero') {
          cmp = compareText(a.cashierName, b.cashierName);
        } else if (sortKey === 'creador') {
          cmp = compareText(a.creatorName, b.creatorName);
        } else if (sortKey === 'metodo') {
          cmp = compareText(a.methodName, b.methodName);
        } else {
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        return applySortDir(cmp, dir);
      });

      const transacciones = processedPayments.length;
      const ticketPromedio = uniqueOrderIds.size > 0 ? round2(totalNetoSum / uniqueOrderIds.size) : 0;

      let itemRows: ReportesPagoItemRow[] = [];
      if (itemBreakdown && uniqueOrderIds.size > 0) {
        const orderIds = Array.from(uniqueOrderIds);
        const itemsByOrderId = new Map<string, Array<{
          id: string;
          description_snapshot: string | null;
          quantity: number;
          unit_price: number;
          total: number;
          product_id: string | null;
          status: string | null;
          category: string;
        }>>();

        for (let index = 0; index < orderIds.length; index += 200) {
          const chunk = orderIds.slice(index, index + 200);
          let itemsQuery = supabase
            .from('order_items')
            .select(`
              id,
              order_id,
              product_id,
              description_snapshot,
              quantity,
              unit_price,
              total,
              status,
              cancelled_at,
              product:products (
                id,
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
            .in('order_id', chunk);

          if (recordStatus === 'valid') {
            itemsQuery = itemsQuery.is('cancelled_at', null).not('status', 'eq', 'CANCELLED');
          } else if (recordStatus === 'voided') {
            itemsQuery = itemsQuery.or('cancelled_at.not.is.null,status.eq.CANCELLED');
          }

          if (productIds && productIds.length > 0) {
            itemsQuery = itemsQuery.in('product_id', productIds);
          }

          const { data: itemsData, error: itemsError } = await itemsQuery;
          if (itemsError) throw itemsError;

          for (const item of itemsData || []) {
            const orderId = String((item as any).order_id ?? '');
            if (!orderId) continue;
            const bucket = itemsByOrderId.get(orderId) ?? [];
            bucket.push({
              id: String((item as any).id),
              description_snapshot: (item as any).description_snapshot ?? null,
              quantity: Number((item as any).quantity ?? 0),
              unit_price: Number((item as any).unit_price ?? 0),
              total: Number((item as any).total ?? 0),
              product_id: (item as any).product_id ?? null,
              status: (item as any).status ?? null,
              category: getProductCategoryLabel(item as any),
            });
            itemsByOrderId.set(orderId, bucket);
          }
        }

        // Una fila por ítem de cada orden (sin duplicar si la orden tiene varios pagos).
        const seenOrderIds = new Set<string>();
        for (const payment of processedPayments) {
          const orderId = String(payment.orderId ?? '');
          if (!orderId || seenOrderIds.has(orderId)) continue;
          seenOrderIds.add(orderId);

          const orderItems = itemsByOrderId.get(orderId) ?? [];
          for (const item of orderItems) {
            const qty = Math.max(0, Number(item.quantity ?? 0));
            if (qty <= 0) continue;
            const unitPrice = Number(item.unit_price ?? 0);
            const lineTotal = Number(item.total ?? 0) || round2(qty * unitPrice);
            const snapshotName = String(item.description_snapshot || 'Producto').trim() || 'Producto';
            itemRows.push({
              rowKey: `${payment.id}:${item.id}`,
              paymentId: payment.id,
              orderId,
              orderCode: payment.orderCode ?? null,
              orderNumber: payment.orderNumber ?? null,
              createdAt: payment.createdAt,
              cashierName: payment.cashierName,
              creatorName: payment.creatorName,
              methodName: payment.methodName,
              amount: payment.amount,
              change: payment.change,
              netApplied: payment.netApplied,
              orderType: payment.orderType,
              branchName: payment.branchName,
              itemId: item.id,
              itemProductCode: String(item.product_id ?? '').trim() || '—',
              itemCategory: item.category,
              itemDescription: snapshotName,
              itemQuantity: qty,
              itemUnitPrice: unitPrice,
              itemTotal: lineTotal,
            });
          }
        }

        itemRows.sort((a, b) => {
          let cmp = 0;
          if (sortKey === 'orden') {
            cmp = compareText(
              getOrderRef(a.orderCode, a.orderNumber),
              getOrderRef(b.orderCode, b.orderNumber),
            );
          } else if (sortKey === 'monto') {
            cmp = a.itemTotal - b.itemTotal;
          } else if (sortKey === 'cajero') {
            cmp = compareText(a.cashierName, b.cashierName);
          } else if (sortKey === 'creador') {
            cmp = compareText(a.creatorName, b.creatorName);
          } else if (sortKey === 'metodo') {
            cmp = compareText(a.methodName, b.methodName);
          } else {
            cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          }
          return applySortDir(cmp, dir);
        });
      }

      return {
        payments: processedPayments,
        itemRows,
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

      const dateBounds = resolveReportesDateBounds(desde, hasta);

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
          cashier:profiles!payment_void_requests_requested_by_user_id_fkey (id, alias, username),
          supervisor:profiles!payment_void_requests_approved_by_supervisor_id_fkey (id, alias, username),
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
      query = query.gte('created_at', dateBounds.desde).lte('created_at', dateBounds.hasta);
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
  const {
    branchId,
    desde,
    hasta,
    shiftId,
    creatorId,
    productIds,
    orderTypes,
    recordStatus = 'all',
    sortBy = 'cantidad',
    sortDir = 'desc',
  } = filters;

  return useQuery({
    queryKey: [
      'reportes-productos-vendidos',
      branchId,
      desde,
      hasta,
      shiftId,
      creatorId,
      productIds,
      orderTypes,
      recordStatus,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      if (!branchId) return { productsSold: [], kpis: { top3: [], totalUnidades: 0 }, rawTimeData: [] };

      const dateBounds = resolveReportesDateBounds(desde, hasta);

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
        .neq('order.status', 'DRAFT'); // Excluir borradores

      if (recordStatus === 'valid') {
        query = query.is('cancelled_at', null).not('status', 'eq', 'CANCELLED');
      } else if (recordStatus === 'voided') {
        query = query.or('cancelled_at.not.is.null,status.eq.CANCELLED');
      }

      if (branchId !== 'ALL') {
        query = query.eq('order.branch_id', branchId);
      }

      // Filtros de fecha en la orden (siempre con tope de seguridad)
      query = query.gte('order.created_at', dateBounds.desde).lte('order.created_at', dateBounds.hasta);

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

      // Anulaciones parciales (p.ej. bajar despachado 4→3): restar del reporte lo que ya no se cobra.
      // En "anulados" no restamos: el ítem ya es la línea cancelada.
      const itemIds = itemsRaw.map((item: any) => item.id).filter(Boolean);
      const cancelledQtyByItemId: Record<string, number> = {};
      if (recordStatus !== 'voided' && itemIds.length > 0) {
        const { data: itemCancellations, error: cancelItemsError } = await supabase
          .from('order_item_cancellations')
          .select('order_item_id, quantity_cancelled, order_cancellation_id')
          .in('order_item_id', itemIds);
        if (cancelItemsError) throw cancelItemsError;

        const cancellationIds = Array.from(
          new Set((itemCancellations ?? []).map((row: any) => row.order_cancellation_id).filter(Boolean)),
        );
        const appliedCancellationIds = new Set<string>();
        if (cancellationIds.length > 0) {
          const { data: cancellationHeaders, error: cancelHeadersError } = await supabase
            .from('order_cancellations')
            .select('id, status')
            .in('id', cancellationIds)
            .eq('status', 'APPLIED');
          if (cancelHeadersError) throw cancelHeadersError;
          for (const header of cancellationHeaders ?? []) {
            if (header?.id) appliedCancellationIds.add(header.id);
          }
        }

        for (const row of itemCancellations ?? []) {
          if (!appliedCancellationIds.has(row.order_cancellation_id)) continue;
          const itemId = String(row.order_item_id ?? '');
          if (!itemId) continue;
          cancelledQtyByItemId[itemId] =
            (cancelledQtyByItemId[itemId] ?? 0) + Math.max(0, Number(row.quantity_cancelled ?? 0));
        }
      }

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
        const orderedQty = Math.max(0, Number(item.quantity || 0));
        const cancelledQty = Math.max(0, Number(cancelledQtyByItemId[item.id] ?? 0));
        const qty = Math.max(0, orderedQty - cancelledQty);
        if (qty <= 0) return;

        const rawTotal = Number(item.total || 0);
        // Proporcional al neto activo (alineado con lo cobrable tras anulacion parcial).
        const itemTotal = orderedQty > 0
          ? round2(rawTotal * (qty / orderedQty))
          : 0;
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
      });

      const sortKey = String(sortBy || 'cantidad');
      const dir = sortDir === 'asc' ? 'asc' : 'desc';
      productsSold.sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'nombre' || sortKey === 'orden') {
          cmp = compareText(a.name, b.name);
        } else if (sortKey === 'total' || sortKey === 'monto') {
          cmp = a.totalRecaudado - b.totalRecaudado;
        } else if (sortKey === 'categoria') {
          cmp = compareText(a.category, b.category);
        } else {
          cmp = a.quantityTotal - b.quantityTotal;
        }
        return applySortDir(cmp, dir);
      });

      // Calcular Top 3 productos
      const top3Source = [...productsSold].sort((a, b) => b.quantityTotal - a.quantityTotal);
      const top3 = top3Source.slice(0, 3).map((p, idx) => ({
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
