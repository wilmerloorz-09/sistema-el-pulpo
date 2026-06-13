import { forwardRef } from "react";
import { roundMoney } from "@/lib/paymentQuantity";
import type { PaymentReceiptData } from "@/lib/paymentReceiptData";

interface PaymentReceiptProps extends PaymentReceiptData {}

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
      clienteCedula,
      clienteNombre,
      token_promocion,
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
          width: "76mm",
          maxWidth: "76mm",
          fontFamily: "monospace",
          fontSize: "11px",
          lineHeight: 1.25,
          padding: "0mm 2mm",
          margin: 0,
          color: "#000",
          background: "#fff",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: "0px", gap: "10px" }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{
              width: "80px",
              height: "auto",
              display: "block",
            }}
          />
          <div style={{ flex: 1, textAlign: "left", display: "flex", flexDirection: "column", gap: "2px" }}>
            {branchName && <div style={{ fontSize: "11px" }}>{branchName}</div>}
            <div style={{ fontSize: "14px", fontWeight: "bold" }}>ORDEN</div>
            <div style={{ fontSize: "14px", fontWeight: "bold" }}>{orderNumber}</div>
            <div style={{ fontSize: "11px" }}>
              {isTrayOrder
                ? "ORDEN BANDEJA"
                : isSpecial
                  ? "ORDEN ESPECIAL"
                  : orderType === "TAKEOUT"
                    ? "PARA LLEVAR"
                    : tableName ?? "MESA"}
            </div>
            <div style={{ fontSize: "10px" }}>
              {dateStr} {timeStr}
            </div>
            {clienteNombre ? (
              <div style={{ fontSize: "10px", marginTop: "2px" }}>
                <div>Cliente: {clienteNombre}</div>
                {clienteCedula ? <div>Cédula: {clienteCedula}</div> : null}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ borderTop: "1px dashed #000", margin: "2px 0" }} />

        {/* Detalle de Items Pagados */}
        {!isSpecial ? (
          <>
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>PRODUCTOS:</div>
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

        {token_promocion ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", margin: "10px 0" }}>
            <div style={{ borderTop: "1px dashed #000", width: "100%", margin: "4px 0" }} />
            <div style={{ fontWeight: "bold", fontSize: "11px", color: "#000" }}>¡OFERTA MUNDIALISTA!</div>
            <div style={{ fontSize: "9px", color: "#333", textAlign: "center" }}>Escanea el QR para registrar tu predicción</div>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(
                `https://sistema-el-pulpo.vercel.app/promociones/registro?t=${token_promocion}`
              )}`}
              alt="QR Promoción"
              style={{ width: "120px", height: "120px", display: "block", margin: "4px 0" }}
            />
            <div style={{ fontWeight: "bold", fontSize: "11px", fontFamily: "monospace" }}>CÓDIGO: {token_promocion}</div>
            <div style={{ borderTop: "1px dashed #000", width: "100%", margin: "4px 0" }} />
          </div>
        ) : null}

        <div style={{ textAlign: "center", marginTop: "12px", fontSize: "11px" }}>
          ¡GRACIAS POR SU PREFERENCIA!
        </div>
      </div>
    );
  },
);

PaymentReceipt.displayName = "PaymentReceipt";

export default PaymentReceipt;
