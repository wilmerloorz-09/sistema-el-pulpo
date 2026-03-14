import { useState } from "react";
import { useCaja, type CompletedPaymentsFilters } from "@/hooks/useCaja";
import { useBranch } from "@/contexts/BranchContext";
import OpenShiftForm from "@/components/caja/OpenShiftForm";
import ShiftSummary from "@/components/caja/ShiftSummary";
import PayableOrdersList from "@/components/caja/PayableOrdersList";
import CompletedPaymentsList from "@/components/caja/CompletedPaymentsList";
import { Loader2, Banknote, CreditCard, History } from "lucide-react";
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
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] xl:items-stretch">
        <div className="relative overflow-hidden rounded-[28px] border border-orange-200 bg-gradient-to-r from-orange-50 via-white to-amber-50 px-5 py-4 shadow-[0_20px_60px_-40px_rgba(249,115,22,0.55)]">
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-orange-200/35 blur-2xl" />
          <div className="pointer-events-none absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-amber-200/30 blur-2xl" />
          <div className="relative mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-orange-300 bg-white/90 text-primary shadow-sm">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-black text-foreground">Caja</h1>
              <p className="text-sm text-muted-foreground">Control de cobros, turno y movimientos del dia.</p>
            </div>
          </div>
          {!canOperateCaja && (
            <span className="relative inline-flex rounded-full border border-border bg-white/80 px-3 py-1 text-[11px] text-muted-foreground shadow-sm">
              Solo consulta
            </span>
          )}
        </div>

        <ShiftSummary
          shift={shift}
          methodSummary={completedPaymentsMethodSummary}
          onClose={(notes) => closeShift.mutate(notes)}
          closing={closeShift.isPending}
          readOnly={!canOperateCaja}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[112px_minmax(0,1fr)]">
        <div className="rounded-[24px] border border-orange-200 bg-gradient-to-b from-orange-50 via-white to-amber-50 p-2 shadow-[0_16px_45px_-38px_rgba(249,115,22,0.7)] xl:self-start">
          <div className="grid grid-cols-2 gap-2 xl:w-[96px] xl:grid-cols-1">
          <button
            onClick={() => setActiveTab("pending")}
            className={cn(
              "group relative overflow-hidden rounded-2xl border px-3 text-sm font-semibold text-left transition-all xl:flex xl:h-48 xl:w-full xl:items-center xl:justify-center xl:px-0 xl:text-center",
              activeTab === "pending"
                ? "border-orange-400 bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-[0_18px_35px_-24px_rgba(249,115,22,0.95)]"
                : "border-orange-200 bg-white/85 text-muted-foreground hover:border-orange-300 hover:bg-orange-50",
            )}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-white/10 xl:h-16" />
            <div className="relative flex items-center gap-2 xl:flex-col xl:gap-3">
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-xl border xl:h-10 xl:w-10",
                activeTab === "pending" ? "border-white/40 bg-white/15" : "border-orange-200 bg-orange-50 text-primary",
              )}>
                <CreditCard className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
              </div>
              <span className="xl:max-h-[180px] xl:text-[13px] xl:leading-tight xl:[writing-mode:vertical-rl] xl:rotate-180 xl:[text-orientation:mixed]">
              Por cobrar ({payableOrders.length})
              </span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={cn(
              "group relative overflow-hidden rounded-2xl border px-3 text-sm font-semibold text-left transition-all xl:flex xl:h-48 xl:w-full xl:items-center xl:justify-center xl:px-0 xl:text-center",
              activeTab === "completed"
                ? "border-violet-400 bg-gradient-to-b from-violet-500 to-fuchsia-600 text-white shadow-[0_18px_35px_-24px_rgba(139,92,246,0.95)]"
                : "border-orange-200 bg-white/85 text-muted-foreground hover:border-violet-300 hover:bg-violet-50",
            )}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-white/10 xl:h-16" />
            <div className="relative flex items-center gap-2 xl:flex-col xl:gap-3">
              <div className={cn(
                "flex h-7 w-7 items-center justify-center rounded-xl border xl:h-10 xl:w-10",
                activeTab === "completed" ? "border-white/40 bg-white/15" : "border-violet-200 bg-violet-50 text-violet-600",
              )}>
                <History className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
              </div>
              <span className="xl:max-h-[180px] xl:text-[13px] xl:leading-tight xl:[writing-mode:vertical-rl] xl:rotate-180 xl:[text-orientation:mixed]">
              Pagos realizados ({completedPaymentsTotal})
              </span>
            </div>
          </button>
        </div>
        </div>

        {activeTab === "pending" ? (
          <div className="rounded-[28px] border border-orange-200 bg-gradient-to-br from-white via-orange-50/55 to-white p-4 shadow-[0_22px_55px_-42px_rgba(249,115,22,0.65)]">
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
          <div className="rounded-[28px] border border-violet-200 bg-gradient-to-br from-white via-violet-50/55 to-white p-4 shadow-[0_22px_55px_-42px_rgba(139,92,246,0.55)]">
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
    </div>
  );
};

export default Caja;
