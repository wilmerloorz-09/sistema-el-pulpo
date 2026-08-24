import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getOrderRef } from '@/lib/orderPresentation';
import { getUserDisplayName, getUserRealName } from '@/lib/userDisplay';

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
  /** Todos = válidos + anulados; por defecto válidos (alineado a cobrado neto / cierre). */
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

/** PostgREST/Supabase trunca en 1000 filas por request si no se pagina. */
const REPORTES_FETCH_PAGE_SIZE = 1000;
/** Tope duro de páginas (evita bucles infinitos / rangos absurdos). */
const REPORTES_FETCH_MAX_PAGES = 50;
/**
 * .in(col, ids) va en la URL de PostgREST. Muchos UUID (p.ej. categoría BEBIDAS
 * expandida a todo el catálogo) provocan HTTP 400 Bad Request.
 */
const REPORTES_IN_FILTER_CHUNK = 80;

type ReportesPageResult<T> = {
  data: T[] | null;
  error: { message?: string; details?: string; hint?: string; code?: string } | null;
};

function chunkIds<T>(ids: T[], size = REPORTES_IN_FILTER_CHUNK): T[][] {
  if (!ids.length) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

function throwReportesQueryError(error: ReportesPageResult<unknown>['error']): never {
  const parts = [error?.message, error?.details, error?.hint].filter(Boolean);
  throw new Error(parts.join(' — ') || 'Error al consultar Supabase');
}

/**
 * Trae todas las filas de un query Supabase paginando con .range().
 * Sin esto, rangos de varios días (p.ej. Pagos) quedan truncados en 1000
 * y los KPIs (total, ticket promedio, conteo) quedan incorrectos.
 *
 * Importante: `runPage` debe construir un query NUEVO en cada llamada
 * (no reutilizar el mismo builder entre páginas).
 */
async function fetchAllReportRows<T>(
  runPage: (from: number, to: number) => PromiseLike<ReportesPageResult<T>>,
  pageSize = REPORTES_FETCH_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (let page = 0; page < REPORTES_FETCH_MAX_PAGES; page += 1) {
    const to = from + pageSize - 1;
    const { data, error } = await runPage(from, to);
    if (error) throwReportesQueryError(error);
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

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
export type ReportesFiltroProfile = {
  id: string;
  alias?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
};

function mergeProfilesById(
  ...lists: Array<ReportesFiltroProfile[] | null | undefined>
): ReportesFiltroProfile[] {
  const byId = new Map<string, ReportesFiltroProfile>();
  for (const list of lists) {
    for (const profile of list ?? []) {
      if (!profile?.id || byId.has(profile.id)) continue;
      byId.set(profile.id, profile);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    getUserDisplayName(a).localeCompare(getUserDisplayName(b), 'es', { sensitivity: 'base' }),
  );
}

export function useReportesFiltros(
  branchId: string,
  desde?: string | null,
  hasta?: string | null,
) {
  const dateBounds = resolveReportesDateBounds(desde ?? null, hasta ?? null);

  return useQuery({
    queryKey: ['reportes-filtros-data', branchId, dateBounds.desde, dateBounds.hasta, 'v4'],
    queryFn: async () => {
      if (!branchId) {
        return {
          shifts: [],
          profiles: [],
          shiftUsers: [],
          cashiersInRange: [] as ReportesFiltroProfile[],
          menuNodes: [],
          products: [],
        };
      }

      // 1. Turnos que se solapan con el rango de fechas del reporte
      let shiftsQuery = supabase
        .from('cash_shifts')
        .select('id, opened_at, closed_at, shift_number, shift_code, branch_id')
        .lte('opened_at', dateBounds.hasta)
        .or(`closed_at.is.null,closed_at.gte.${dateBounds.desde}`)
        .order('opened_at', { ascending: false })
        .limit(200);

      if (branchId !== 'ALL') {
        shiftsQuery = shiftsQuery.eq('branch_id', branchId);
      }

      const { data: shiftsData, error: shiftsError } = await shiftsQuery;
      if (shiftsError) throw shiftsError;

      const fromMs = new Date(dateBounds.desde).getTime();
      const toMs = new Date(dateBounds.hasta).getTime();
      const shifts = (shiftsData || []).filter((shift: any) => {
        const opened = new Date(shift.opened_at).getTime();
        const closed = shift.closed_at ? new Date(shift.closed_at).getTime() : Number.POSITIVE_INFINITY;
        return opened <= toMs && closed >= fromMs;
      });

      // 2. Perfiles activos (creadores / fallbacks)
      let profilesData: ReportesFiltroProfile[] = [];
      const { data: profilesRaw, error: profilesError } = await supabase
        .from('profiles')
        .select('id, alias, username, first_name, last_name, full_name')
        .eq('is_active', true)
        .order('alias', { ascending: true });
      if (!profilesError) {
        profilesData = (profilesRaw || []) as ReportesFiltroProfile[];
      }

      // 3. Usuarios de turnos en el rango + cajeros (can_use_caja / aperturas de caja)
      let shiftUsersData: ReportesFiltroProfile[] = [];
      let cashiersInRange: ReportesFiltroProfile[] = [];
      const shiftIds = shifts.map((s) => s.id).filter(Boolean);

      if (shiftIds.length > 0) {
        const cashierProfiles: ReportesFiltroProfile[] = [];
        const shiftUserProfiles: ReportesFiltroProfile[] = [];

        for (const idChunk of chunkIds(shiftIds)) {
          const { data: shiftUserRows, error: shiftUsersError } = await supabase
            .from('cash_shift_users')
            .select(
              'user_id, can_use_caja, profiles(id, alias, username, first_name, last_name, full_name)',
            )
            .in('shift_id', idChunk);
          if (!shiftUsersError) {
            for (const row of shiftUserRows || []) {
              const profile = Array.isArray((row as any).profiles)
                ? (row as any).profiles[0]
                : (row as any).profiles;
              const resolved: ReportesFiltroProfile | null = profile?.id
                ? (profile as ReportesFiltroProfile)
                : row.user_id
                  ? {
                      id: row.user_id as string,
                      alias: null,
                      username: null,
                      first_name: null,
                      last_name: null,
                      full_name: null,
                    }
                  : null;
              if (!resolved) continue;
              shiftUserProfiles.push(resolved);
              if ((row as any).can_use_caja) {
                cashierProfiles.push(resolved);
              }
            }
          }

          const { data: openingRows, error: openingsError } = await supabase
            .from('cash_register_openings')
            .select(
              'cashier_id, cashier:profiles!cash_register_openings_cashier_id_fkey(id, alias, username, first_name, last_name, full_name)',
            )
            .in('shift_id', idChunk)
            .neq('status', 'anulada');
          if (!openingsError) {
            for (const row of openingRows || []) {
              const profile = Array.isArray((row as any).cashier)
                ? (row as any).cashier[0]
                : (row as any).cashier;
              if (profile?.id) {
                cashierProfiles.push(profile as ReportesFiltroProfile);
              } else if (row.cashier_id) {
                cashierProfiles.push({
                  id: row.cashier_id as string,
                  alias: null,
                  username: null,
                  first_name: null,
                  last_name: null,
                  full_name: null,
                });
              }
            }
          }
        }

        shiftUsersData = mergeProfilesById(shiftUserProfiles);
        cashiersInRange = mergeProfilesById(cashierProfiles);
      }

      // 4. Árbol de menú (opcional para filtros de productos)
      let menuNodesData: any[] = [];
      let menuQuery = supabase
        .from('menu_nodes')
        .select('id, parent_id, name, node_type, legacy_product_id, is_active, menu_scope')
        .order('depth', { ascending: true })
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (branchId !== 'ALL') {
        menuQuery = menuQuery.eq('branch_id', branchId);
      }

      const { data: menuRaw, error: menuNodesError } = await menuQuery;
      if (!menuNodesError) {
        menuNodesData = menuRaw || [];
      }

      // 5. Productos legacy (opcional)
      let productsData: any[] = [];
      const { data: productsRaw, error: productsError } = await supabase
        .from('products')
        .select('id, description')
        .order('description', { ascending: true });
      if (!productsError) {
        productsData = productsRaw || [];
      }

      const profiles = mergeProfilesById(profilesData, shiftUsersData);

      return {
        shifts,
        profiles,
        shiftUsers: shiftUsersData,
        cashiersInRange,
        menuNodes: menuNodesData,
        products: productsData,
      };
    },
    enabled: !!branchId,
    staleTime: 60_000,
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
  itemSubcategory: string;
  itemDescription: string;
  itemQuantity: number;
  itemUnitPrice: number;
  itemTotal: number;
};

type ProductCatalogItemShape = {
  product?: {
    subcategory?: {
      description?: string | null;
      category?: { description?: string | null } | null;
    } | null;
  } | null;
} | null | undefined;

function getProductCategoryLabel(item: ProductCatalogItemShape): string {
  return String(item?.product?.subcategory?.category?.description ?? '').trim() || 'Sin categoría';
}

function getProductSubcategoryLabel(item: ProductCatalogItemShape): string {
  return String(item?.product?.subcategory?.description ?? '').trim() || 'Sin subcategoría';
}

type ReportesOrderItemBucket = {
  id: string;
  description_snapshot: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  product_id: string | null;
  status: string | null;
  category: string;
  subcategory: string;
};

function lineTotalFromOrderItem(item: Pick<ReportesOrderItemBucket, 'quantity' | 'unit_price' | 'total'>): number {
  const qty = Math.max(0, Number(item.quantity ?? 0));
  const unitPrice = Number(item.unit_price ?? 0);
  const raw = Number(item.total ?? 0);
  return raw || round2(qty * unitPrice);
}

/**
 * Prorratea el total de ítems filtrados entre los pagos de una orden
 * según el peso de cada pago (netApplied).
 */
function allocateFilteredTotalAcrossPayments(
  payments: Array<{ id: string; netApplied: number }>,
  filteredItemsTotal: number,
): Map<string, number> {
  const attributed = new Map<string, number>();
  if (payments.length === 0 || filteredItemsTotal <= 0) {
    for (const pay of payments) attributed.set(pay.id, 0);
    return attributed;
  }

  const weightSum = round2(payments.reduce((acc, pay) => acc + Math.max(0, pay.netApplied), 0));
  if (weightSum <= 0) {
    // Sin pesos: todo al primer pago
    attributed.set(payments[0].id, round2(filteredItemsTotal));
    for (let i = 1; i < payments.length; i += 1) attributed.set(payments[i].id, 0);
    return attributed;
  }

  let allocated = 0;
  for (let i = 0; i < payments.length; i += 1) {
    const pay = payments[i];
    const isLast = i === payments.length - 1;
    const share = isLast
      ? round2(filteredItemsTotal - allocated)
      : round2(filteredItemsTotal * (Math.max(0, pay.netApplied) / weightSum));
    attributed.set(pay.id, Math.max(0, share));
    allocated = round2(allocated + Math.max(0, share));
  }
  return attributed;
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
    recordStatus = 'valid',
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
        const itemsData: Array<{ order_id: string; order?: { branch_id?: string } | null }> = [];
        for (const productChunk of chunkIds(productIds)) {
          const chunkRows = await fetchAllReportRows((from, to) =>
            supabase
              .from('order_items')
              .select('order_id, order:orders!inner(id, branch_id, created_at)')
              .in('product_id', productChunk)
              .gte('order.created_at', dateBounds.desde)
              .lte('order.created_at', dateBounds.hasta)
              .order('id', { ascending: true })
              .range(from, to),
          );
          itemsData.push(...chunkRows);
        }
        let scoped = itemsData;
        if (branchId !== 'ALL') {
          scoped = scoped.filter((item) => item.order?.branch_id === branchId);
        }
        orderIdsFilter = Array.from(new Set(scoped.map((item) => item.order_id)));
        
        // Si no hay órdenes con estos productos, devolvemos resultado vacío inmediatamente
        if (orderIdsFilter.length === 0) {
          return {
            payments: [],
            itemRows: [] as ReportesPagoItemRow[],
            kpis: { totalNeto: 0, desglose: { Efectivo: 0, Transferencia: 0, Tarjeta: 0 }, ticketPromedio: 0, transacciones: 0 }
          };
        }
      }

      // Consulta base a payments (builder nuevo por página: evita corrupción de Range/URL)
      const data = await fetchAllReportRows((from, to) => {
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
          .in('status', ['COMPLETED', 'active', 'voided', 'VOIDED', 'reversed', 'REVERSED'])
          .gte('created_at', dateBounds.desde)
          .lte('created_at', dateBounds.hasta);

        if (branchId !== 'ALL') {
          query = query.eq('order.branch_id', branchId);
        }
        if (shiftId) query = query.eq('shift_id', shiftId);
        if (cashierId) query = query.eq('created_by', cashierId);
        if (creatorId) query = query.eq('order.created_by', creatorId);
        if (orderTypes && orderTypes.length > 0) {
          const dbTypes = orderTypes.filter((t) => t !== 'SPECIAL');
          if (dbTypes.length > 0) {
            query = query.in('order.order_type', dbTypes);
          }
        }

        return query
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
      });

      // Filtro de productos: ya resolvimos order_ids; aplicamos en memoria para no
      // saturar la URL con .in(...) enorme ni encadenar filtros en el builder.
      let paymentsScoped = data;
      if (orderIdsFilter) {
        const allowedOrderIds = new Set(orderIdsFilter);
        paymentsScoped = data.filter((pay: any) => allowedOrderIds.has(pay.order?.id));
      }

      // Filtrar en memoria por orderType efectivo y estado válido/anulado
      const paymentsRaw = (paymentsScoped || []).filter((pay: any) => {
        if (orderTypes && orderTypes.length > 0) {
          const effectiveType = pay.order?.is_special ? 'SPECIAL' : (pay.order?.order_type || 'EXTRA');
          if (!orderTypes.includes(effectiveType)) return false;
        }
        const voided = isReportPaymentVoided(pay);
        if (recordStatus === 'valid') return !voided;
        if (recordStatus === 'voided') return voided;
        return true;
      });

      // Procesar pagos (montos brutos de cobro). Si hay filtro de producto, los KPIs
      // se recalculan después solo con la parte de esos ítems.
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

        const methodName = pay.payment_methods?.name || 'Otro';

        return {
          id: pay.id,
          orderId: pay.order?.id as string | undefined,
          orderCode: pay.order?.order_code,
          orderNumber: pay.order?.order_number,
          createdAt: pay.created_at as string,
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

      const uniqueOrderIds = new Set(
        processedPayments.map((p) => p.orderId).filter((id): id is string => Boolean(id)),
      );

      const allowedProductIds =
        productIds && productIds.length > 0 ? new Set(productIds) : null;
      const productFilterActive = Boolean(allowedProductIds);
      // Con filtro de producto siempre cargamos ítems (KPIs por parte de producto).
      // Con desglose, también.
      const shouldLoadItems = (itemBreakdown || productFilterActive) && uniqueOrderIds.size > 0;

      const itemsByOrderId = new Map<string, ReportesOrderItemBucket[]>();
      if (shouldLoadItems) {
        const orderIds = Array.from(uniqueOrderIds);
        for (const orderChunk of chunkIds(orderIds, REPORTES_IN_FILTER_CHUNK)) {
          const itemsData = await fetchAllReportRows((from, to) => {
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
              .in('order_id', orderChunk);

            if (recordStatus === 'valid') {
              itemsQuery = itemsQuery.is('cancelled_at', null).not('status', 'eq', 'CANCELLED');
            } else if (recordStatus === 'voided') {
              itemsQuery = itemsQuery.or('cancelled_at.not.is.null,status.eq.CANCELLED');
            }

            return itemsQuery.order('id', { ascending: true }).range(from, to);
          });

          for (const item of itemsData) {
            const orderId = String((item as any).order_id ?? '');
            if (!orderId) continue;
            const productId = (item as any).product_id ?? null;
            if (allowedProductIds && (!productId || !allowedProductIds.has(productId))) {
              continue;
            }
            const bucket = itemsByOrderId.get(orderId) ?? [];
            bucket.push({
              id: String((item as any).id),
              description_snapshot: (item as any).description_snapshot ?? null,
              quantity: Number((item as any).quantity ?? 0),
              unit_price: Number((item as any).unit_price ?? 0),
              total: Number((item as any).total ?? 0),
              product_id: productId,
              status: (item as any).status ?? null,
              category: getProductCategoryLabel(item as any),
              subcategory: getProductSubcategoryLabel(item as any),
            });
            itemsByOrderId.set(orderId, bucket);
          }
        }
      }

      let totalNetoSum = 0;
      const desgloseMap: Record<string, number> = {};
      let paymentsForReport = processedPayments;

      if (productFilterActive) {
        const filteredTotalByOrder = new Map<string, number>();
        for (const [orderId, items] of itemsByOrderId.entries()) {
          const orderTotal = round2(
            items.reduce((acc, item) => acc + lineTotalFromOrderItem(item), 0),
          );
          if (orderTotal > 0) filteredTotalByOrder.set(orderId, orderTotal);
        }

        const paymentsByOrder = new Map<string, typeof processedPayments>();
        for (const pay of processedPayments) {
          const orderId = String(pay.orderId ?? '');
          if (!orderId || !filteredTotalByOrder.has(orderId)) continue;
          const bucket = paymentsByOrder.get(orderId) ?? [];
          bucket.push(pay);
          paymentsByOrder.set(orderId, bucket);
        }

        const attributedByPaymentId = new Map<string, number>();
        for (const [orderId, orderPayments] of paymentsByOrder.entries()) {
          const filteredTotal = filteredTotalByOrder.get(orderId) ?? 0;
          const shares = allocateFilteredTotalAcrossPayments(orderPayments, filteredTotal);
          for (const [payId, share] of shares.entries()) {
            attributedByPaymentId.set(payId, share);
          }
        }

        paymentsForReport = processedPayments
          .map((pay) => {
            const attributed = attributedByPaymentId.get(pay.id);
            if (attributed == null || attributed <= 0) return null;
            return {
              ...pay,
              // Con filtro de producto, el listado refleja la parte atribuida a esos ítems.
              amount: attributed,
              change: 0,
              netApplied: attributed,
            };
          })
          .filter((pay): pay is NonNullable<typeof pay> => pay != null);

        for (const pay of paymentsForReport) {
          totalNetoSum = round2(totalNetoSum + pay.netApplied);
          desgloseMap[pay.methodName] = round2((desgloseMap[pay.methodName] || 0) + pay.netApplied);
        }
      } else {
        for (const pay of paymentsForReport) {
          totalNetoSum = round2(totalNetoSum + pay.netApplied);
          desgloseMap[pay.methodName] = round2((desgloseMap[pay.methodName] || 0) + pay.netApplied);
        }
      }

      const ordersInReport = new Set(
        paymentsForReport.map((p) => p.orderId).filter((id): id is string => Boolean(id)),
      );
      const transacciones = paymentsForReport.length;
      const ticketPromedio = ordersInReport.size > 0 ? round2(totalNetoSum / ordersInReport.size) : 0;

      let itemRows: ReportesPagoItemRow[] = [];
      if (itemBreakdown && ordersInReport.size > 0) {
        // Una fila por ítem de cada orden (sin duplicar si la orden tiene varios pagos).
        const seenOrderIds = new Set<string>();
        for (const payment of paymentsForReport) {
          const orderId = String(payment.orderId ?? '');
          if (!orderId || seenOrderIds.has(orderId)) continue;
          seenOrderIds.add(orderId);

          const orderItems = itemsByOrderId.get(orderId) ?? [];
          for (const item of orderItems) {
            const qty = Math.max(0, Number(item.quantity ?? 0));
            if (qty <= 0) continue;
            const unitPrice = Number(item.unit_price ?? 0);
            const lineTotal = lineTotalFromOrderItem(item);
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
              itemSubcategory: item.subcategory,
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
        payments: paymentsForReport,
        itemRows,
        kpis: {
          totalNeto: round2(totalNetoSum),
          desglose: desgloseMap,
          ticketPromedio,
          transacciones,
          productScoped: productFilterActive,
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

      const voidsRaw = await fetchAllReportRows((from, to) => {
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
          .in('status', ['approved', 'executed'])
          .gte('created_at', dateBounds.desde)
          .lte('created_at', dateBounds.hasta);

        if (branchId !== 'ALL') {
          query = query.eq('order.branch_id', branchId);
        }
        if (shiftId) query = query.eq('shift_id', shiftId);
        if (cashierId) query = query.eq('requested_by_user_id', cashierId);
        if (supervisorId) query = query.eq('approved_by_supervisor_id', supervisorId);

        return query
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
      });

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
        for (const idChunk of chunkIds(successorOrderIds)) {
          const { data: succOrders, error: succError } = await supabase
            .from('orders')
            .select('id, order_code, order_number')
            .in('id', idChunk);

          if (!succError && succOrders) {
            succOrders.forEach((o) => {
              successorMap[o.id] = { code: o.order_code, number: o.order_number };
            });
          }
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
    recordStatus = 'valid',
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

      const productIdChunks =
        productIds && productIds.length > 0 ? chunkIds(productIds) : [null as string[] | null];

      const data: any[] = [];
      for (const productChunk of productIdChunks) {
        const chunkRows = await fetchAllReportRows((from, to) => {
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
            .neq('order.status', 'DRAFT')
            .gte('order.created_at', dateBounds.desde)
            .lte('order.created_at', dateBounds.hasta);

          if (recordStatus === 'valid') {
            query = query.is('cancelled_at', null).not('status', 'eq', 'CANCELLED');
          } else if (recordStatus === 'voided') {
            query = query.or('cancelled_at.not.is.null,status.eq.CANCELLED');
          }

          if (branchId !== 'ALL') {
            query = query.eq('order.branch_id', branchId);
          }
          if (shiftId) query = query.eq('order.cash_shift_id', shiftId);
          if (creatorId) query = query.eq('order.created_by', creatorId);
          if (productChunk) {
            query = query.in('product_id', productChunk);
          }
          if (orderTypes && orderTypes.length > 0) {
            const dbTypes = orderTypes.filter((t) => t !== 'SPECIAL');
            if (dbTypes.length > 0) {
              query = query.in('order.order_type', dbTypes);
            }
          }

          return query.order('id', { ascending: true }).range(from, to);
        });
        data.push(...chunkRows);
      }

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
        const itemCancellations: Array<{
          order_item_id: string;
          quantity_cancelled: number;
          order_cancellation_id: string;
        }> = [];
        for (let index = 0; index < itemIds.length; index += 200) {
          const chunk = itemIds.slice(index, index + 200);
          const { data: cancelChunk, error: cancelItemsError } = await supabase
            .from('order_item_cancellations')
            .select('order_item_id, quantity_cancelled, order_cancellation_id')
            .in('order_item_id', chunk);
          if (cancelItemsError) throw cancelItemsError;
          itemCancellations.push(...(cancelChunk ?? []));
        }

        const cancellationIds = Array.from(
          new Set(itemCancellations.map((row) => row.order_cancellation_id).filter(Boolean)),
        );
        const appliedCancellationIds = new Set<string>();
        if (cancellationIds.length > 0) {
          for (let index = 0; index < cancellationIds.length; index += 200) {
            const chunk = cancellationIds.slice(index, index + 200);
            const { data: cancellationHeaders, error: cancelHeadersError } = await supabase
              .from('order_cancellations')
              .select('id, status')
              .in('id', chunk)
              .eq('status', 'APPLIED');
            if (cancelHeadersError) throw cancelHeadersError;
            for (const header of cancellationHeaders ?? []) {
              if (header?.id) appliedCancellationIds.add(header.id);
            }
          }
        }

        for (const row of itemCancellations) {
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

export type ReportesPersonalRoleKey =
  | 'supervisor'
  | 'mesas'
  | 'ordenes'
  | 'despacho'
  | 'caja'
  | 'empaque'
  | 'servir'
  | 'productos'
  | 'autoriza_anulaciones';

export type ReportesPersonalRow = {
  rowKey: string;
  dayKey: string;
  dayLabel: string;
  shiftId: string;
  shiftNumber: number | null;
  shiftCode: string | null;
  shiftOpenedAt: string;
  shiftClosedAt: string | null;
  shiftStatus: string;
  branchId: string;
  branchName: string;
  userId: string;
  userAlias: string;
  userRealName: string;
  isEnabled: boolean;
  roles: string[];
  roleKeys: ReportesPersonalRoleKey[];
  cajaOpenedAt: string | null;
  cajaClosedAt: string | null;
  cajaStatus: string | null;
};

function buildPersonalRoles(row: {
  is_supervisor?: boolean | null;
  can_serve_tables?: boolean | null;
  can_access_orders?: boolean | null;
  can_dispatch_orders?: boolean | null;
  can_use_caja?: boolean | null;
  can_pack_orders?: boolean | null;
  can_serve_plates?: boolean | null;
  can_manage_products?: boolean | null;
  can_authorize_order_cancel?: boolean | null;
}): { roles: string[]; roleKeys: ReportesPersonalRoleKey[] } {
  const roles: string[] = [];
  const roleKeys: ReportesPersonalRoleKey[] = [];
  const push = (key: ReportesPersonalRoleKey, label: string, enabled: boolean) => {
    if (!enabled) return;
    roleKeys.push(key);
    roles.push(label);
  };
  push('supervisor', 'Supervisor', Boolean(row.is_supervisor));
  push('mesas', 'Mesas', Boolean(row.can_serve_tables));
  push('ordenes', 'Órdenes', Boolean(row.can_access_orders));
  push('despacho', 'Despacho', Boolean(row.can_dispatch_orders));
  push('caja', 'Caja', Boolean(row.can_use_caja));
  push('empaque', 'Empaque', Boolean(row.can_pack_orders));
  push('servir', 'Servir', Boolean(row.can_serve_plates));
  push('productos', 'Productos', Boolean(row.can_manage_products));
  push('autoriza_anulaciones', 'Autoriza anulaciones', Boolean(row.can_authorize_order_cancel));
  return { roles, roleKeys };
}

function formatPersonalDayKey(iso: string): { dayKey: string; dayLabel: string } {
  const d = new Date(iso);
  const dayKey = formatLocalDayKey(d);
  const dayLabel = new Intl.DateTimeFormat('es-EC', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  return { dayKey, dayLabel };
}

function formatLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Personal asignado a turnos en el rango (por día operativo del turno).
 * Fuente: cash_shifts + cash_shift_users (+ aperturas de caja si existen).
 */
export function useReportesPersonal(filters: ReportesFilters) {
  const {
    branchId,
    desde,
    hasta,
    shiftId,
    creatorId,
    sortBy,
    sortDir,
  } = filters;

  return useQuery({
    queryKey: ['reportes-personal', filters],
    queryFn: async () => {
      if (!branchId) {
        return {
          rows: [] as ReportesPersonalRow[],
          kpis: { personas: 0, turnos: 0, dias: 0, habilitados: 0 },
        };
      }

      const bounds = resolveReportesDateBounds(desde, hasta);

      let shiftsQuery = supabase
        .from('cash_shifts')
        .select('id, branch_id, opened_at, closed_at, status, shift_number, shift_code, branches(name)')
        .lte('opened_at', bounds.hasta)
        .or(`closed_at.is.null,closed_at.gte.${bounds.desde}`)
        .order('opened_at', { ascending: false })
        .limit(200);

      if (branchId !== 'ALL') {
        shiftsQuery = shiftsQuery.eq('branch_id', branchId);
      }
      if (shiftId) {
        shiftsQuery = shiftsQuery.eq('id', shiftId);
      }

      const { data: shiftsData, error: shiftsError } = await shiftsQuery;
      if (shiftsError) throw shiftsError;

      const shifts = (shiftsData ?? []).filter((shift: any) => {
        const opened = new Date(shift.opened_at).getTime();
        const closed = shift.closed_at ? new Date(shift.closed_at).getTime() : Number.POSITIVE_INFINITY;
        const from = new Date(bounds.desde).getTime();
        const to = new Date(bounds.hasta).getTime();
        return opened <= to && closed >= from;
      });

      if (shifts.length === 0) {
        return {
          rows: [] as ReportesPersonalRow[],
          kpis: { personas: 0, turnos: 0, dias: 0, habilitados: 0 },
        };
      }

      const shiftIds = shifts.map((s: any) => s.id as string);
      const shiftById = new Map(shifts.map((s: any) => [s.id as string, s]));

      const { data: shiftUsers, error: usersError } = await supabase
        .from('cash_shift_users')
        .select(
          'id, shift_id, user_id, is_enabled, is_supervisor, can_serve_tables, can_access_orders, can_dispatch_orders, can_use_caja, can_pack_orders, can_serve_plates, can_manage_products, can_authorize_order_cancel, profiles(id, alias, username, first_name, last_name, full_name)',
        )
        .in('shift_id', shiftIds);

      if (usersError) throw usersError;

      const { data: openings, error: openingsError } = await supabase
        .from('cash_register_openings')
        .select('id, shift_id, cashier_id, opened_at, closed_at, status')
        .in('shift_id', shiftIds)
        .neq('status', 'anulada');

      if (openingsError) throw openingsError;

      const openingByShiftUser = new Map<string, { opened_at: string; closed_at: string | null; status: string }>();
      for (const opening of openings ?? []) {
        const key = `${opening.shift_id}:${opening.cashier_id}`;
        const current = openingByShiftUser.get(key);
        if (!current || new Date(opening.opened_at).getTime() > new Date(current.opened_at).getTime()) {
          openingByShiftUser.set(key, {
            opened_at: opening.opened_at,
            closed_at: opening.closed_at,
            status: opening.status,
          });
        }
      }

      let rows: ReportesPersonalRow[] = (shiftUsers ?? [])
        .filter((row: any) => (creatorId ? row.user_id === creatorId : true))
        .map((row: any) => {
          const shift = shiftById.get(row.shift_id);
          if (!shift) return null;
          const { dayKey, dayLabel } = formatPersonalDayKey(shift.opened_at);
          const { roles, roleKeys } = buildPersonalRoles(row);
          const profile = row.profiles;
          const caja = openingByShiftUser.get(`${row.shift_id}:${row.user_id}`) ?? null;
          const branchName = Array.isArray(shift.branches)
            ? shift.branches[0]?.name
            : shift.branches?.name;

          return {
            rowKey: `${row.shift_id}:${row.user_id}`,
            dayKey,
            dayLabel,
            shiftId: row.shift_id,
            shiftNumber: shift.shift_number ?? null,
            shiftCode: shift.shift_code ?? null,
            shiftOpenedAt: shift.opened_at,
            shiftClosedAt: shift.closed_at ?? null,
            shiftStatus: shift.status,
            branchId: shift.branch_id,
            branchName: branchName || 'Sucursal',
            userId: row.user_id,
            userAlias: getProfileLabel(profile),
            userRealName: getUserRealName(profile) || getProfileLabel(profile),
            isEnabled: Boolean(row.is_enabled),
            roles,
            roleKeys,
            cajaOpenedAt: caja?.opened_at ?? null,
            cajaClosedAt: caja?.closed_at ?? null,
            cajaStatus: caja?.status ?? null,
          } satisfies ReportesPersonalRow;
        })
        .filter(Boolean) as ReportesPersonalRow[];

      const dir = sortDir === 'asc' ? 'asc' : 'desc';
      const sortKey = String(sortBy ?? 'dia');
      rows.sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'usuario' || sortKey === 'creador') {
          cmp = compareText(a.userAlias, b.userAlias);
        } else if (sortKey === 'turno') {
          cmp = compareText(
            String(a.shiftNumber ?? a.shiftCode ?? a.shiftId),
            String(b.shiftNumber ?? b.shiftCode ?? b.shiftId),
          );
        } else if (sortKey === 'habilitado') {
          cmp = Number(a.isEnabled) - Number(b.isEnabled);
        } else {
          cmp = compareText(a.dayKey, b.dayKey);
          if (cmp === 0) {
            cmp = new Date(a.shiftOpenedAt).getTime() - new Date(b.shiftOpenedAt).getTime();
          }
          if (cmp === 0) {
            cmp = compareText(a.userAlias, b.userAlias);
          }
        }
        return applySortDir(cmp, dir);
      });

      const personas = new Set(rows.map((r) => r.userId)).size;
      const turnos = new Set(rows.map((r) => r.shiftId)).size;
      const dias = new Set(rows.map((r) => r.dayKey)).size;
      const habilitados = rows.filter((r) => r.isEnabled).length;

      return {
        rows,
        kpis: { personas, turnos, dias, habilitados },
      };
    },
    enabled: !!branchId,
  });
}
