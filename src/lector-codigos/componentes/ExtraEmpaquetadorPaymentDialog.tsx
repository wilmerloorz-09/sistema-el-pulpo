import { useEffect, useState } from "react";
import PaymentDialogV2 from "@/components/caja/PaymentDialogV2";
import { useBranch } from "@/contexts/BranchContext";
import {
  buildPayableOrderById,
  useCaja,
  type PayableOrder,
} from "@/hooks/useCaja";

type Props = {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  onPaid?: () => void;
};

/** Ventana de cobro (misma UI de Caja) sobre Extra Empaquetador. */
export default function ExtraEmpaquetadorPaymentDialog({
  orderId,
  open,
  onClose,
  onPaid,
}: Props) {
  const { activeBranchId, activeBranch } = useBranch();
  const { denominations, shift, paymentMethods, payOrder } = useCaja({
    loadCompletedPayments: false,
  });
  const [order, setOrder] = useState<PayableOrder | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orderId || !activeBranchId) {
      setOrder(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    const workflowMode = activeBranch?.workflow_mode ?? "CASH_THEN_DISPATCH";

    const load = async (attempt = 0): Promise<void> => {
      try {
        const built = await buildPayableOrderById({
          orderId,
          branchId: activeBranchId,
          workflowMode,
        });
        if (cancelled) return;
        if (!built) {
          if (attempt < 4) {
            window.setTimeout(() => {
              void load(attempt + 1);
            }, 250);
            return;
          }
          setLoadError("No se pudo preparar la orden para cobrar.");
          setOrder(null);
          return;
        }
        setLoadError(null);
        setOrder(built);
      } catch (e: any) {
        if (cancelled) return;
        setLoadError(e?.message || "Error al cargar la orden para cobrar.");
        setOrder(null);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, orderId, activeBranchId, activeBranch?.workflow_mode]);

  if (open && loadError && !order) {
    return (
      <div
        role="alertdialog"
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
            width: "min(420px, 94vw)",
            borderRadius: 16,
            background: "#fff",
            padding: 18,
            boxShadow: "0 18px 40px rgba(0,0,0,.2)",
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, color: "#0f172a" }}>No se pudo abrir el cobro</p>
          <p style={{ margin: "8px 0 14px", color: "#64748b", fontSize: 14 }}>{loadError}</p>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: "100%",
              height: 42,
              borderRadius: 10,
              border: "1px solid #d5e0d4",
              background: "#f8faf8",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cerrar
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
      open={open && Boolean(order)}
      onClose={onClose}
    />
  );
}
