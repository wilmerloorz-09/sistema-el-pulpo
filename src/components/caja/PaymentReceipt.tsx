import { forwardRef } from "react";
import { roundMoney } from "@/lib/paymentQuantity";

interface ReceiptItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface PaymentMethodDetail {
  methodName: string;
  appliedAmount: number;
}

interface PaymentReceiptProps {
  orderNumber: string | number;
  tableName?: string;
  orderType?: string;
  isSpecial?: boolean;
  isTrayOrder?: boolean;
  items: ReceiptItem[];
  payments: PaymentMethodDetail[];
  totalAmount: number;
  totalReceived: number;
  changeAmount: number;
  createdAt: string;
  branchName?: string;
}

const PaymentReceipt = forwardRef<HTMLDivElement, PaymentReceiptProps>(
  (
    {
      orderNumber,
      tableName,
      orderType,
      isSpecial = false,
      isTrayOrder = false,
      items,
      payments,
      totalAmount,
      totalReceived,
      changeAmount,
      createdAt,
      branchName,
    },
    ref,
  ) => {
    const receiptItems = items ?? [];
    const receiptPayments = payments ?? [];
    const date = new Date(createdAt);
    const dateStr = date.toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const timeStr = date.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const formatCurrency = (amount: number) => `$${roundMoney(amount).toFixed(2)}`;

    return (
      <div
        ref={ref}
        id="print-receipt"
        className="hidden print:block"
        style={{
          width: "80mm",
          fontFamily: "monospace",
          fontSize: "12px",
          padding: "4mm",
          color: "#000",
          background: "#fff",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <div style={{ fontSize: "16px", fontWeight: "bold" }}>COMPROBANTE DE PAGO</div>
          {branchName && <div style={{ fontSize: "12px", marginTop: "2px" }}>{branchName}</div>}
          <div style={{ fontSize: "14px", fontWeight: "bold", marginTop: "4px" }}>
            ORDEN {orderNumber}
          </div>
          <div style={{ fontSize: "12px", marginTop: "2px" }}>
            {isTrayOrder
              ? "ORDEN BANDEJA"
              : isSpecial
                ? "ORDEN ESPECIAL"
                : orderType === "TAKEOUT"
                  ? "PARA LLEVAR"
                  : tableName ?? "MESA"}
          </div>
          <div style={{ fontSize: "11px", marginTop: "2px" }}>
            {dateStr} {timeStr}
          </div>
        </div>

        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

        {/* Detalle de Items Pagados */}
        {!isSpecial ? (
          <>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>PRODUCTOS PAGADOS:</div>
            {receiptItems.map((item, idx) => (
              <div key={idx} style={{ marginBottom: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>
                    {item.quantity}x {item.description}
                  </span>
                  <span>{formatCurrency(item.amount)}</span>
                </div>
                <div style={{ fontSize: "10px", color: "#666" }}>
                  P.U. {formatCurrency(item.unitPrice)}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontWeight: "bold" }}>CARGO ESPECIAL</span>
              <span>{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        )}

        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

        {/* Desglose de Pago */}
        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: "bold",
              fontSize: "13px",
              marginBottom: "4px",
            }}
          >
            <span>TOTAL A PAGAR</span>
            <span>{formatCurrency(totalAmount)}</span>
          </div>

          {receiptPayments.map((p, idx) => (
            <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
              <span>{p.methodName}</span>
              <span>{formatCurrency(p.appliedAmount)}</span>
            </div>
          ))}

          <div style={{ borderTop: "1px dotted #000", margin: "4px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>RECIBIDO</span>
            <span>{formatCurrency(totalReceived)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold" }}>
            <span>CAMBIO</span>
            <span>{formatCurrency(changeAmount)}</span>
          </div>
        </div>

        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

        <div style={{ textAlign: "center", marginTop: "12px", fontSize: "11px" }}>
          ¡GRACIAS POR SU PREFERENCIA!
          <br />
          Sistema El Pulpo
        </div>
      </div>
    );
  },
);

PaymentReceipt.displayName = "PaymentReceipt";

export default PaymentReceipt;
