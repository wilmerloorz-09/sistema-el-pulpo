/**
 * Tipos para la lógica de cancelación de órdenes e ítems
 */

export type OrderItemStatus = 'DRAFT' | 'SENT' | 'DISPATCHED' | 'PAID' | 'CANCELLED';
export type OrderStatus = 'DRAFT' | 'SENT_TO_KITCHEN' | 'KITCHEN_DISPATCHED' | 'PAID' | 'CANCELLED';
export type CancellationReason = 
  | 'error_mesero'
  | 'cliente_cambio_opinion'
  | 'producto_no_disponible'
  | 'cliente_no_solicito'
  | 'otro';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'VOIDED';

// Cancelación
export interface CancellationData {
  reason?: CancellationReason;
  notes?: string;
  cancelledBy: string;
}

export interface OperationalLoss {
  id?: string;
  order_item_id: string;
  order_id: string;
  amount: number;
  reason: string;
  cancelled_by: string;
  created_at?: string;
}

// Órdenes
export interface Order {
  id: string;
  order_number: number;
  order_code: string | null;
  branch_id: string;
  created_by: string;
  table_id: string | null;
  split_id: string | null;
  order_type: 'DINE_IN' | 'TAKEOUT';
  status: OrderStatus;
  total: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: CancellationReason | null;
  cancelled_from_status: OrderStatus | null;
}

// Ítems de orden
export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  total: number;
  status: OrderItemStatus;
  dispatched_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: CancellationReason | null;
  cancelled_from_status: OrderItemStatus | null;
  created_at: string;
}

export interface OrderItemWithModifiers extends OrderItem {
  modifiers: {
    id: string;
    modifier_id: string;
    description: string;
  }[];
}

// Pagos
export interface Payment {
  id: string;
  order_id: string;
  payment_method_id: string;
  shift_id: string | null;
  amount: number;
  change_amount: number | null;
  status: PaymentStatus;
  notes: string | null;
  created_by: string;
  voided_at: string | null;
  voided_by: string | null;
  created_at: string;
}

// Perfiles
export interface Profile {
  id: string;
  full_name: string;
  username: string;
  role: string | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Constantes
export const CANCELLATION_REASONS: Record<CancellationReason, string> = {
  error_mesero: 'Error del mesero',
  cliente_cambio_opinion: 'El cliente cambió de opinión',
  producto_no_disponible: 'Producto no disponible',
  cliente_no_solicito: 'El cliente no lo solicitó',
  otro: 'Otro',
};

export const CANCELLABLE_ITEM_STATUSES: OrderItemStatus[] = ['DRAFT', 'SENT', 'DISPATCHED'];
export const REQUIRES_REASON_ITEM_STATUSES: OrderItemStatus[] = ['SENT', 'DISPATCHED'];
