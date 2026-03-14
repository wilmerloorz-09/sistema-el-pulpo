import { forwardRef } from "react";

interface ReceiptItem {
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  total: number;
  modifiers: { description: string }[];
  item_note?: string | null;
}

interface ThermalReceiptProps {
  orderNumber: string | number;
  orderType: string;
  tableName?: string;
  items: ReceiptItem[];
  total: number;
  createdAt: string;
}

const ThermalReceipt = forwardRef<HTMLDivElement, ThermalReceiptProps>(
  ({ orderNumber, orderType, tableName, items, total, createdAt }, ref) => {
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
          <div style={{ fontSize: "16px", fontWeight: "bold" }}>ORDEN {orderNumber}</div>
          <div style={{ fontSize: "14px", fontWeight: "bold", marginTop: "4px" }}>
            {orderType === "TAKEOUT" ? "PARA LLEVAR" : tableName ?? "MESA"}
          </div>
          <div style={{ fontSize: "11px", marginTop: "2px" }}>
            {dateStr} {timeStr}
          </div>
        </div>

        <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

        {items.map((item, idx) => {
          const indentCh = `${String(item.quantity).length + 2}ch`;

          return (
            <div key={idx} style={{ marginBottom: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>
                  {item.quantity}x {item.description_snapshot}
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
              {item.item_note && (
                <div style={{ paddingLeft: indentCh, fontSize: "11px", fontStyle: "italic" }}>
                  Nota: {item.item_note}
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


