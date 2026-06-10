/** Datos del comprobante de pago (HTML y ESC/POS). */
export interface PaymentReceiptData {
  orderNumber: string | number;
  tableName?: string;
  orderType?: string;
  isSpecial?: boolean;
  isTrayOrder?: boolean;
  items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>;
  payments: Array<{ methodName: string; appliedAmount: number }>;
  totalAmount: number;
  totalReceived: number;
  changeAmount: number;
  createdAt: string;
  branchName?: string;
  clienteCedula?: string;
  clienteNombre?: string;
  token_promocion?: string | null;
}

export function datosClienteEnRecibo(cliente: { cedula: string; nombres: string; apellidos: string } | null | undefined): {
  clienteCedula?: string;
  clienteNombre?: string;
} {
  if (!cliente) return {};
  const nombre = `${cliente.nombres} ${cliente.apellidos}`.trim();
  return {
    clienteCedula: cliente.cedula,
    clienteNombre: nombre || undefined,
  };
}
