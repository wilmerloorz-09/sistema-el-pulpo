import { useCaja } from "@/hooks/useCaja";
import OpenShiftForm from "@/components/caja/OpenShiftForm";
import ShiftSummary from "@/components/caja/ShiftSummary";
import PayableOrdersList from "@/components/caja/PayableOrdersList";
import { Loader2, Banknote } from "lucide-react";

const Caja = () => {
  const {
    denominations,
    shift,
    isLoadingShift,
    payableOrders,
    paymentMethods,
    openShift,
    payOrder,
    closeShift,
  } = useCaja();

  if (isLoadingShift) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No open shift → show open form
  if (!shift) {
    return (
      <div className="p-4 pt-8">
        <OpenShiftForm
          denominations={denominations}
          onOpen={(counts) => openShift.mutate(counts)}
          opening={openShift.isPending}
        />
      </div>
    );
  }

  // Active shift → show summary + payable orders
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Banknote className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg font-bold text-foreground">Caja</h1>
      </div>

      <ShiftSummary
        shift={shift}
        onClose={(notes) => closeShift.mutate(notes)}
        closing={closeShift.isPending}
      />

      <div>
        <h2 className="font-display text-sm font-bold text-foreground mb-3">
          Órdenes por cobrar ({payableOrders.length})
        </h2>
        <PayableOrdersList
          orders={payableOrders}
          paymentMethods={paymentMethods}
          shiftDenoms={shift.denoms}
          onPay={(p) => payOrder.mutate(p)}
          paying={payOrder.isPending}
        />
      </div>
    </div>
  );
};

export default Caja;
