import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCaja, type CompletedPaymentsFilters } from "@/hooks/useCaja";
import { useBranch } from "@/contexts/BranchContext";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import OpenShiftForm from "@/components/caja/OpenShiftForm";
import ShiftSummary from "@/components/caja/ShiftSummary";
import PayableOrdersList from "@/components/caja/PayableOrdersList";
import CompletedPaymentsList from "@/components/caja/CompletedPaymentsList";
import { CreditCard, History, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { canManage, canOperate } from "@/lib/permissions";

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

const formatElapsed = (openedAt: string) => {
  const opened = new Date(openedAt);
  const elapsed = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 60000));
  const hours = Math.floor(elapsed / 60);
  const minutes = elapsed % 60;
  return `${hours}h ${minutes}m`;
};

const Caja = () => {
  const { permissions, isGlobalAdmin, activeBranch } = useBranch();
  const { isDesktop } = useBreakpoint();
  const [searchParams, setSearchParams] = useSearchParams();
  const [completedFilters, setCompletedFilters] = useState<CompletedPaymentsFilters>(initialCompletedFilters);
  const activeTab = searchParams.get("tab") === "completed" ? "completed" : "pending";

  const setActiveTab = (tab: "pending" | "completed") => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "pending") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", "completed");
    }
    setSearchParams(nextParams, { replace: true });
  };
  const canOperateCaja =
    canOperate(permissions, "caja")
    || isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");
  const canAnnulOpening =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");

  const {
    denominations,
    shift,
    isLoadingShift,
    cashRegisterMovements,
    isLoadingCashRegisterMovements,
    branchReferenceTableCount,
    payableOrders,
    paymentMethods,
    completedPayments,
    completedPaymentsTotal,
    completedPaymentsMethodSummary,
    completedPaymentsCollectedTotal,
    isLoadingCompletedPayments,
    cashierReverseWindowMinutes,
    openCashRegister,
    payOrder,
    requestPaymentReversal,
    reversePayment,
    approvePaymentReversal,
    closeCashRegister,
    annulCashOpening,
    registerCashMovement,
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
      <div className="bg-slate-50 px-4 py-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-md rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
          <h2 className="font-display text-xl font-black text-foreground">No hay turno abierto</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            La apertura del turno ahora se realiza desde Administracion en la pestana Turno.
          </p>
        </div>
      </div>
    );
  }

  if (shift.caja_status !== "OPEN") {
    return (
      <div className="bg-slate-50 px-4 py-2 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="border-b border-slate-200 pb-4">
            <h1 className="text-[2.2rem] font-semibold tracking-[-0.04em] text-slate-950">
              Caja · {activeBranch?.name ?? "Sucursal"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              La jornada ya esta abierta. Falta preparar la caja para cobrar.
            </p>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
            {shift.caja_status === "UNOPENED" ? (
              <OpenShiftForm
                denominations={denominations}
                onOpen={({ counts }) => openCashRegister.mutate({ counts })}
                opening={openCashRegister.isPending}
                readOnly={!canOperateCaja}
                title="Abrir Caja"
                description={`Ingresa el conteo inicial de caja. El turno tiene ${branchReferenceTableCount} mesa(s) de referencia en esta sucursal.`}
                openingHistory={shift.openingHistory}
              />
            ) : (
              <div className="mx-auto max-w-md text-center">
                <h2 className="font-display text-xl font-bold text-foreground">Caja cerrada</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  La caja de este turno ya fue cerrada. Para volver a cobrar necesitas abrir una nueva jornada desde Administracion.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const shiftElapsed = formatElapsed(shift.opened_at);

  return (
    <div className="min-h-full bg-slate-50 px-4 pt-3 pb-0 sm:px-6 sm:pt-4 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="border-b border-slate-200 pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-[1.72rem] font-semibold tracking-[-0.035em] text-slate-950 sm:text-[1.95rem]">
                Caja · {activeBranch?.name ?? "Sucursal"}
              </h1>
              <div className="mt-3 space-y-1">
                <p className="text-sm text-slate-500">
                  Turno abierto hace {shiftElapsed}
                </p>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#0f766e]" />
                  <span className="text-sm text-slate-700">Caja abierta</span>
                  {!canOperateCaja && (
                    <span className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-500">
                      Solo consulta
                    </span>
                  )}
                </div>
              </div>
            </div>

            <ShiftSummary
              shift={shift}
              methodSummary={completedPaymentsMethodSummary}
              movements={cashRegisterMovements}
              movementsLoading={isLoadingCashRegisterMovements}
              onClose={(notes) => closeCashRegister.mutateAsync(notes)}
              onAnnulOpen={(reason) => annulCashOpening.mutateAsync({ reason })}
              onRegisterMovement={(payload) => registerCashMovement.mutateAsync(payload)}
              closing={closeCashRegister.isPending}
              annulling={annulCashOpening.isPending}
              registeringMovement={registerCashMovement.isPending}
              canAnnulOpen={canAnnulOpening}
              readOnly={!canOperateCaja}
            />
          </div>
        </div>

      {!isDesktop ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setActiveTab("pending")}
              className={cn(
                "group relative overflow-hidden rounded-2xl border px-3 py-3 text-sm font-semibold text-left transition-all",
                activeTab === "pending"
                  ? "border-orange-400 bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-[0_18px_35px_-24px_rgba(249,115,22,0.95)] dark:border-primary/50 dark:from-primary/20 dark:to-primary/10 dark:text-primary dark:shadow-none"
                  : "border-orange-200 bg-white/85 text-muted-foreground hover:border-orange-300 hover:bg-orange-50 dark:border-border dark:bg-card/85 dark:hover:border-primary/30 dark:hover:bg-primary/5",
              )}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-white/10" />
              <div className="relative flex items-center gap-2">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl border",
                  activeTab === "pending" ? "border-white/40 bg-white/15 dark:border-primary/40 dark:bg-primary/20" : "border-orange-200 bg-orange-50 text-primary dark:border-primary/20 dark:bg-primary/10",
                )}>
                  <CreditCard className="h-3.5 w-3.5" />
                </div>
                <span className="text-[13px] leading-tight">Por cobrar ({payableOrders.length})</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("completed")}
              className={cn(
                "group relative overflow-hidden rounded-2xl border px-3 py-3 text-sm font-semibold text-left transition-all",
                activeTab === "completed"
                  ? "border-violet-400 bg-gradient-to-b from-violet-500 to-fuchsia-600 text-white shadow-[0_18px_35px_-24px_rgba(139,92,246,0.95)] dark:border-violet-500/50 dark:from-violet-500/20 dark:to-violet-500/10 dark:text-violet-400 dark:shadow-none"
                  : "border-orange-200 bg-white/85 text-muted-foreground hover:border-violet-300 hover:bg-violet-50 dark:border-border dark:bg-card/85 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/5",
              )}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-white/10" />
              <div className="relative flex items-center gap-2">
                <div className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl border",
                  activeTab === "completed" ? "border-white/40 bg-white/15 dark:border-violet-500/40 dark:bg-violet-500/20" : "border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-500/20 dark:bg-violet-500/10",
                )}>
                  <History className="h-3.5 w-3.5" />
                </div>
                <span className="text-[13px] leading-tight">Pagos realizados ({completedPaymentsTotal})</span>
              </div>
            </button>
          </div>

          {activeTab === "pending" ? (
            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
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
            <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
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
      ) : activeTab === "pending" ? (
        <div>
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
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
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
