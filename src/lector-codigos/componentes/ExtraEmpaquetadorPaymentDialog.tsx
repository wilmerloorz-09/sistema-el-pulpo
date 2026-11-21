import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import PaymentDialogV2 from "@/components/caja/PaymentDialogV2";
import { useCaja, type PayableOrder } from "@/hooks/useCaja";

type Props = {
  order: PayableOrder | null;
  open: boolean;
  preparing?: boolean;
  onClose: () => void;
  onPaid?: () => void;
};

/** Ventana de cobro (misma UI de Caja) sobre Extra Empaquetador. */
export default function ExtraEmpaquetadorPaymentDialog({
  order,
  open,
  preparing = false,
  onClose,
  onPaid,
}: Props) {
  // Siempre montado (aunque cerrado) para precachear denominaciones / turno / métodos.
  const { denominations, shift, paymentMethods, payOrder } = useCaja({
    loadCompletedPayments: false,
  });

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [open]);

  if (!open) return null;

  if (preparing || !order) {
    return (
      <div
        role="dialog"
        aria-busy="true"
        aria-label="Preparando cobro"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 80,
          display: "grid",
          placeItems: "center",
          background: "rgba(15, 23, 42, 0.45)",
          padding: 16,
        }}
      >
        <div
          style={{
            width: "min(360px, 92vw)",
            borderRadius: 16,
            background: "#fff",
            padding: "22px 18px",
            boxShadow: "0 18px 40px rgba(0,0,0,.2)",
            textAlign: "center",
          }}
        >
          <Loader2
            className="mx-auto mb-3 h-8 w-8 animate-spin text-emerald-600"
            aria-hidden
          />
          <p style={{ margin: 0, fontWeight: 800, color: "#0f172a" }}>Preparando cobro…</p>
          <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 13 }}>
            Creando la orden y abriendo la ventana.
          </p>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginTop: 14,
              width: "100%",
              height: 40,
              borderRadius: 10,
              border: "1px solid #d5e0d4",
              background: "#f8faf8",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <PaymentDialogV2
      order={order}
      denominations={denominations}
      shiftDenoms={shift?.denoms ?? []}
      paymentMethods={paymentMethods}
      paying={payOrder.isPending}
      onPay={async (params) => {
        await payOrder.mutateAsync(params);
        onPaid?.();
      }}
      open={open}
      onClose={onClose}
    />
  );
}
