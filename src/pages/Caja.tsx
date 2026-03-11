import { useState } from "react";
import { useCaja, type CompletedPaymentsFilters } from "@/hooks/useCaja";
import { useBranch } from "@/contexts/BranchContext";
import OpenShiftForm from "@/components/caja/OpenShiftForm";
import ShiftSummary from "@/components/caja/ShiftSummary";
import PayableOrdersList from "@/components/caja/PayableOrdersList";
import CompletedPaymentsList from "@/components/caja/CompletedPaymentsList";
import { Loader2, Banknote } from "lucide-react";
import { cn } from "@/lib/utils";
import { canOperate } from "@/lib/permissions";

const initialCompletedFilters: CompletedPaymentsFilters = {
  orderQuery: "",
  methodId: "ALL",
  fromDateTime: "",
  toDateTime: "",
  sortBy: "created_at",
  sortDir: "desc",
  page: 1,
  pageSize: 20,
};

const Caja = () => {
  const { permissions } = useBranch();
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
  const [completedFilters, setCompletedFilters] = useState<CompletedPaymentsFilters>(initialCompletedFilters);
  const canOperateCaja = canOperate(permissions, "caja");

  const {
    denominations,
    shift,
    isLoadingShift,
    payableOrders,
    paymentMethods,
    completedPayments,
    completedPaymentsTotal,
    completedPaymentsMethodSummary,
    completedPaymentsCollectedTotal,
    isLoadingCompletedPayments,
    cashierReverseWindowMinutes,
    openShift,
    payOrder,
    requestPaymentReversal,
    reversePayment,
    approvePaymentReversal,
    closeShift,
  } = useCaja(completedFilters);

  if (isLoadingShift) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="p-4 pt-8">
        <OpenShiftForm
          denominations={denominations}
          onOpen={(counts) => openShift.mutate(counts)}
          opening={openShift.isPending}
          readOnly={!canOperateCaja}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Banknote className="h-5 w-5 text-primary" />
        <h1 className="font-display text-lg font-bold text-foreground">Caja</h1>
        {!canOperateCaja && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Solo consulta
          </span>
        )}
      </div>

      <ShiftSummary
        shift={shift}
        onClose={(notes) => closeShift.mutate(notes)}
        closing={closeShift.isPending}
        readOnly={!canOperateCaja}
      />

      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border p-1">
        <button
          onClick={() => setActiveTab("pending")}
          className={cn(
            "h-9 rounded-lg text-sm font-medium transition-colors",
            activeTab === "pending" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
        >
          Por cobrar ({payableOrders.length})
        </button>
        <button
          onClick={() => setActiveTab("completed")}
          className={cn(
            "h-9 rounded-lg text-sm font-medium transition-colors",
            activeTab === "completed" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50",
          )}
        >
          Pagos realizados ({completedPaymentsTotal})
        </button>
      </div>

      {activeTab === "pending" ? (
        <div>
          <h2 className="mb-3 font-display text-sm font-bold text-foreground">Ordenes por cobrar ({payableOrders.length})</h2>
          <PayableOrdersList
            orders={payableOrders}
            paymentMethods={paymentMethods}
            shiftDenoms={shift.denoms}
            onPay={(params) => payOrder.mutate(params)}
            paying={payOrder.isPending}
            readOnly={!canOperateCaja}
          />
        </div>
      ) : (
        <div>
          <h2 className="mb-3 font-display text-sm font-bold text-foreground">Pagos realizados ({completedPaymentsTotal})</h2>
          <CompletedPaymentsList
            payments={completedPayments}
            total={completedPaymentsTotal}
            methodSummary={completedPaymentsMethodSummary}
            collectedTotal={completedPaymentsCollectedTotal}
            paymentMethods={paymentMethods}
            loading={isLoadingCompletedPayments}
            filters={completedFilters}
            permissions={permissions}
            cashierReverseWindowMinutes={cashierReverseWindowMinutes}
            actionLoading={requestPaymentReversal.isPending || reversePayment.isPending || approvePaymentReversal.isPending}
            onFiltersChange={setCompletedFilters}
            onRequestReversal={(paymentId, reason, paymentEntryIds) =>
              requestPaymentReversal.mutateAsync({ paymentId, reason, paymentEntryIds })
            }
            onReversePayment={(paymentId, reason, paymentEntryIds) =>
              reversePayment.mutateAsync({ paymentId, reason, paymentEntryIds })
            }
            onApproveReversal={(paymentId, approve, reason, paymentEntryIds) =>
              approvePaymentReversal.mutateAsync({ paymentId, approved: approve, reason, paymentEntryIds })
            }
          />
        </div>
      )}
    </div>
  );
};

export default Caja;
