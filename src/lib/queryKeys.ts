/**
 * Query keys centralizadas (fase 2 Egress).
 * Prefijos estables para invalidaciones específicas y para el hub Realtime.
 */

export const qk = {
  orders: ["orders"] as const,
  order: (orderId: string) => ["order", orderId] as const,
  orderPrefix: ["order"] as const,

  payableOrders: ["payable-orders"] as const,
  completedPayments: ["completed-payments"] as const,
  cashRegisterMovements: ["cash-register-movements"] as const,
  currentShift: ["current-shift"] as const,
  openCashShift: ["open-cash-shift"] as const,
  branchShiftGate: ["branch-shift-gate"] as const,
  shiftEnabledUsers: (shiftId: string) => ["shift-enabled-users", shiftId] as const,

  dispatchOrders: ["dispatch-orders"] as const,
  servirOrders: ["servir-orders"] as const,
  packingOrders: ["packing-orders"] as const,
  /** Bundle RPC crudo compartido por Despacho/Servir (prefetch + cola). */
  dispatchServirQueueBundle: ["dispatch-servir-queue-bundle"] as const,
  kitchenOrders: ["kitchen-orders"] as const,

  expressOrders: ["express-orders"] as const,
  extraOrders: ["extra-orders"] as const,
  takeoutOrders: ["takeout-orders"] as const,
  specialOrders: ["special-orders"] as const,

  tablesWithStatus: ["tables-with-status"] as const,
  tableOrders: ["table-orders"] as const,
  tableOrdersFor: (tableId: string) => ["table-orders", tableId] as const,
  branchTableSettings: ["branch-table-settings"] as const,

  promocionesOrdenes: ["promociones-ordenes-elegibles"] as const,
  campanasActivas: ["campanas-promocionales-activas"] as const,
  autopedidosQr: ["autopedidos-qr-pendientes"] as const,

  paymentMethods: (branchId: string) => ["payment-methods", branchId] as const,
  denominations: ["denominations"] as const,

  reportsLocalOrders: ["reports-local-orders"] as const,
  reportsRemoteOrders: ["reports-remote-orders"] as const,
  syncPendingCount: ["sync-pending-count"] as const,
  reportesPagos: ["reportes-pagos"] as const,

  pendingPaymentCapture: ["pending-payment-capture-requests"] as const,
} as const;

/** Keys operativas típicas tras cobro/despacho/cambio de ítems. */
export const OPERATIONAL_ORDER_LIST_KEYS = [
  qk.orders,
  qk.payableOrders,
  qk.dispatchOrders,
  qk.servirOrders,
  qk.packingOrders,
  qk.dispatchServirQueueBundle,
  qk.kitchenOrders,
  qk.expressOrders,
  qk.extraOrders,
  qk.takeoutOrders,
  qk.specialOrders,
] as const;
