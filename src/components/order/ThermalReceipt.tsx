import { forwardRef } from "react";

interface ReceiptItem {
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  total: number;
  tray_item_type?: "A" | "B" | "C" | null;
  modifiers: { description: string }[];
  item_note?: string | null;
}

interface ThermalReceiptProps {
  orderNumber: string | number;
  orderType: string;
  isSpecial?: boolean;
  isTrayOrder?: boolean;
  tableName?: string;
  items: ReceiptItem[];
  total: number;
  createdAt: string;
}

const ThermalReceipt = forwardRef<HTMLDivElement, ThermalReceiptProps>(
  ({ orderNumber, orderType, isSpecial = false, isTrayOrder = false, tableName, items, total, createdAt }, ref) => {
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
          padding: "1mm 2mm",
          margin: 0,
          color: "#000",
          background: "#fff",
          boxSizing: "border-box",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "8px" }}>
          <div style={{ fontSize: "16px", fontWeight: "bold" }}>ORDEN {orderNumber}</div>
          <div style={{ fontSize: "14px", fontWeight: "bold", marginTop: "4px" }}>
            {isTrayOrder ? "ORDEN BANDEJA" : isSpecial ? "ORDEN ESPECIAL" : orderType === "TAKEOUT" ? "PARA LLEVAR" : tableName ?? "MESA"}
          </div>
          <div style={{ fontSize: "11px", marginTop: "2px" }}>
            {dateStr} {timeStr}
          </div>
        </div>

        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

        {items.map((item, idx) => {
          const isBulkItem = item.tray_item_type === "C";
          const indentCh = isBulkItem ? "0ch" : `${String(item.quantity).length + 2}ch`;
          const trimmedItemNote = String(item.item_note ?? "").trim();
          const isDeliveryInstruction = trimmedItemNote.toLowerCase().startsWith("entregar:");

          return (
            <div key={idx} style={{ marginBottom: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  {isBulkItem ? item.description_snapshot : `${item.quantity}x ${item.description_snapshot}`}
                </span>
                <span>${item.total.toFixed(2)}</span>
              </div>
              {item.modifiers
                .filter((modifier) => String(modifier.description ?? "").trim().length > 0)
                .map((mod, midx) => (
                  <div key={midx} style={{ paddingLeft: indentCh, fontSize: "11px", color: "#dc2626" }}>
                    - {mod.description}
                  </div>
                ))}
              {trimmedItemNote && (
                <div style={{ paddingLeft: indentCh, fontSize: "11px", fontStyle: isDeliveryInstruction ? "normal" : "italic", fontWeight: isDeliveryInstruction ? 700 : 400 }}>
                  {isDeliveryInstruction ? trimmedItemNote : `Nota: ${trimmedItemNote}`}
                </div>
              )}
            </div>
          );
        })}

        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontWeight: "bold",
            fontSize: "14px",
          }}
        >
          <span>TOTAL</span>
          <span>${total.toFixed(2)}</span>
        </div>

        <div style={{ textAlign: "center", marginTop: "12px", fontSize: "11px" }}>
          Gracias por su compra
        </div>
      </div>
    );
  }
);

ThermalReceipt.displayName = "ThermalReceipt";

export default ThermalReceipt;


