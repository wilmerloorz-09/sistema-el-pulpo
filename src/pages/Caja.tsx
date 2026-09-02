import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCashRegisterMovementsForShift, useCaja, type CompletedPaymentsFilters, type PayableOrder } from "@/hooks/useCaja";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBranchShiftGate } from "@/hooks/useBranchShiftGate";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { supabase } from "@/services/DatabaseService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import OpenShiftForm from "@/components/caja/OpenShiftForm";
import ShiftSummary from "@/components/caja/ShiftSummary";
import PayableOrdersList from "@/components/caja/PayableOrdersList";
import PaymentDialog from "@/components/caja/PaymentDialog";
import PaymentDialogV2 from "@/components/caja/PaymentDialogV2";
import { USE_PAYMENT_DIALOG_V2 } from "@/lib/cajaPaymentUi";
import CompletedPaymentsList from "@/components/caja/CompletedPaymentsList";
import ComprobantesPagoPendientesPanel from "@/components/caja/ComprobantesPagoPendientesPanel";
import { toast } from "sonner";
import { Camera, CheckCircle2, CreditCard, History, Loader2, ReceiptText, RotateCcw, Upload } from "lucide-react";
import { cn, formatElapsedSince } from "@/lib/utils";
import { canManage, canOperate } from "@/lib/permissions";
import { prepareProofImage } from "@/lib/prepareProofImage";
import { getOrderRef } from "@/lib/orderPresentation";
import { getUserDisplayName } from "@/lib/userDisplay";
import { 
  buildCashClosureReportHtml, 
  openCashClosureReportWindow,
  shouldAutoPrintCashReport,
  scopeReportToOpening,
  formatMoney,
  formatDateTime,
  translateCashStatus,
  translatePaymentStatus,
  type CashShiftSnapshot,
  type CashOpeningSnapshot,
  type CompletedPayment,
  type CashMovement
} from "@/lib/cashReportUtils";
import { hideCashReport, showCashReport } from "@/lib/cashReportViewerStore";
import { OPERATIONAL_STALE_MS } from "@/lib/queryEgress";
import { dbSelect } from "@/services/DatabaseService";
import type { CompletedPaymentsMethodSummary } from "@/hooks/useCaja";
import { buildMethodSummaryFromPayments } from "@/lib/paymentSummary";
import { sumNonCashPaymentChangeOut } from "@/lib/transferCashChange";
import { fetchPaymentsForRegisterSummary } from "@/lib/cajaRegisterPayments";
import { fetchRegisterOpeningCollectedPayments } from "@/lib/cajaRegisterOpeningSummary";
import { ALL_CASHIERS, scopeCajaSummary, belongsToCashierRegisterActivity, resolveCashierOpening } from "@/lib/cajaSummaryScope";

const initialCompletedFilters: CompletedPaymentsFilters = {
  scope: "ALL",
  cashierName: "ALL",
};

const PAYMENT_PROOF_API_URL = (import.meta.env.VITE_PAYMENT_PROOF_API_URL ?? "").trim().replace(/\/$/, "");

// Helper functions moved to @/lib/cashReportUtils

// Types moved to @/lib/cashReportUtils

// Report generation logic moved to @/lib/cashReportUtils

const Caja = () => {
  const { user } = useAuth();
  const { permissions, isGlobalAdmin, activeBranch } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const { isDesktop } = useBreakpoint();
  const [searchParams, setSearchParams] = useSearchParams();
  const [completedFilters, setCompletedFilters] = useState<CompletedPaymentsFilters>({
    scope: "ALL",
    cashierName: user?.id ?? "ALL",
  });

  const [activeCaptureRequestId, setActiveCaptureRequestId] = useState<string | null>(null);
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [captureNotesByRequest, setCaptureNotesByRequest] = useState<Record<string, string>>({});
  const [uploadingCaptureRequestId, setUploadingCaptureRequestId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [completedChargeOrder, setCompletedChargeOrder] = useState<PayableOrder | null>(null);
  const [completedChargeBlock, setCompletedChargeBlock] = useState<{
    kind: "not_found" | "undispatched" | "unsent_drafts" | "locked";
    orderRef?: string;
  } | null>(null);
  const [rechargeLoading, setRechargeLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeTabParam = searchParams.get("tab");
  const autoOpenOrderId = searchParams.get("order");
  const activeTab =
    activeTabParam === "completed"
      ? "completed"
      : "pending";

  const setActiveTab = (tab: "pending" | "completed") => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "pending") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tab);
    }
    setSearchParams(nextParams, { replace: true });

  };

  const clearAutoOpenOrder = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("order");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const canOperateCaja =
    canOperate(permissions, "caja")
    || isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global")
    || Boolean(shiftGateQuery.data?.canUseCaja)
    || Boolean(shiftGateQuery.data?.isSupervisor);
  const canAnnulOpening =
    isGlobalAdmin
    || canManage(permissions, "admin_sucursal")
    || canManage(permissions, "admin_global");

  const {
    denominations,
    shift,
    shiftRegisterSnapshot,
    isLoadingShift,
    cashRegisterMovements,
    isLoadingCashRegisterMovements,
    branchReferenceTableCount,
    payableOrders,
    isFetchingPayableOrders,
    refetchPayableOrders,
    paymentMethods,
    cashRegisterTemplates,
    completedPayments,
    completedPaymentsTotal,
    completedPaymentsMethodSummary,
    completedPaymentsCollectedTotal,
    isLoadingCompletedPayments,
    captureCandidates,
    pendingCaptureRequests,
    isLoadingPendingCaptureRequests,
    refetchPendingCaptureRequests,
    openCaptureRequest,
    prepareTransferProof,
    discardPreparedTransferProof,
    getTransferProofReadiness,
    openCashRegister,
    payOrder,
    requestPaymentVoid,
    voidPaymentWithSupervisor,
    closeCashRegister,
    annulCashOpening,
    registerCashMovement,
    prepareOrderForRecharge,
  } = useCaja({
    completedPaymentsFilters: completedFilters,
    autoOpenOrderId,
    loadCompletedPayments: activeTab === "completed",
  });

  const userCajaStatus = shiftGateQuery.data?.cajaStatus ?? "UNOPENED";
  const userCajaIsOpen = userCajaStatus === "OPEN";
  const summaryCashierId = completedFilters.cashierName || ALL_CASHIERS;
  /** Mismo alcance que Pagos del turno (filtro de cajero), no forzar siempre la caja del usuario logueado. */
  const registerSummaryCashierId = summaryCashierId;

  const registerSummaryOpening = useMemo(() => {
    const openingHistory =
      shiftRegisterSnapshot?.openingHistory ?? shift?.openingHistory ?? [];
    return resolveCashierOpening(openingHistory, registerSummaryCashierId);
  }, [
    shiftRegisterSnapshot?.openingHistory,
    shift?.openingHistory,
    registerSummaryCashierId,
  ]);

  const cashierMethodSummaryQuery = useQuery({
    queryKey: [
      "cashier-method-summary",
      activeBranch?.id ?? "_",
      shift?.id ?? "_",
      registerSummaryCashierId,
      registerSummaryOpening?.id ?? "_",
      registerSummaryOpening?.cashier_id ?? "_",
    ],
    enabled: Boolean(activeBranch?.id) && Boolean(shift?.id) && Boolean(user?.id),
    queryFn: async (): Promise<{
      methodSummary: CompletedPaymentsMethodSummary[];
      transferCashChangeTotal: number;
    }> => {
      if (!activeBranch?.id || !shift?.id || !shift?.opened_at) {
        return { methodSummary: [], transferCashChangeTotal: 0 };
      }

      const openingHistory =
        shiftRegisterSnapshot?.openingHistory ?? shift?.openingHistory ?? [];
      const cashierOpening = registerSummaryOpening
        ?? resolveCashierOpening(openingHistory, registerSummaryCashierId);

      let paymentsRaw: Awaited<ReturnType<typeof fetchPaymentsForRegisterSummary>> = [];
      let usedOpeningRpc = false;

      if (cashierOpening?.id) {
        try {
          paymentsRaw = await fetchRegisterOpeningCollectedPayments(cashierOpening.id);
          usedOpeningRpc = true;
        } catch (rpcError) {
          console.warn(
            "[Caja] RPC get_register_opening_collected_payments no disponible, usando respaldo:",
            rpcError,
          );
        }
      }

      if (!usedOpeningRpc) {
        const rangeStart = cashierOpening?.opened_at ?? shift.opened_at;
        const rangeEnd = shift.closed_at ?? undefined;
        const fallbackRaw = await fetchPaymentsForRegisterSummary({
          shiftId: shift.id,
          branchId: activeBranch.id,
          rangeStart,
          rangeEnd,
        });
        paymentsRaw = fallbackRaw.filter((payment) =>
          belongsToCashierRegisterActivity({
            actorId: payment.created_by,
            activityAt: payment.created_at,
            cashierId: registerSummaryCashierId,
            opening: cashierOpening,
            openingHistory,
          }),
        );
      }

      const methods = await dbSelect<any>("payment_methods", {
        select: "id, name",
        filters: [{ column: "branch_id", op: "eq", value: activeBranch.id }],
      });

      const methodNameById = Object.fromEntries((methods ?? []).map((m: any) => [m.id, m.name]));
      const methodSummary = buildMethodSummaryFromPayments(paymentsRaw, methodNameById);

      const paymentIds = paymentsRaw.map((p) => p.id).filter(Boolean);
      if (paymentIds.length === 0) {
        return { methodSummary, transferCashChangeTotal: 0 };
      }

      const changeOutRows = await dbSelect<any>("cash_movements", {
        select: "payment_id, denomination_id, qty_delta, movement_type",
        filters: [
          { column: "payment_id", op: "in", value: paymentIds },
          { column: "movement_type", op: "eq", value: "CHANGE_OUT" },
        ],
      });

      const denomIds = Array.from(
        new Set((changeOutRows ?? []).map((row: any) => row.denomination_id).filter(Boolean)),
      );
      const denomRows = denomIds.length > 0
        ? await dbSelect<any>("denominations", {
            select: "id, value",
            filters: [{ column: "id", op: "in", value: denomIds }],
          })
        : [];
      const denominationValueById: Record<string, number> = {
        ...Object.fromEntries((shift.denoms ?? []).map((d) => [d.denomination_id, d.value])),
        ...Object.fromEntries((denomRows ?? []).map((d: any) => [d.id, Number(d.value ?? 0)])),
      };

      const transferCashChangeTotal = sumNonCashPaymentChangeOut({
        payments: paymentsRaw ?? [],
        methodNameById,
        changeOutMovements: changeOutRows ?? [],
        denominationValueById,
      });

      return { methodSummary, transferCashChangeTotal };
    },
    staleTime: OPERATIONAL_STALE_MS,
  });

  const shiftSummaryMethodSummary = cashierMethodSummaryQuery.data?.methodSummary ?? [];
  const shiftSummaryTransferCashChange = cashierMethodSummaryQuery.data?.transferCashChangeTotal ?? 0;

  const currentUserCashierCandidate = useMemo(
    () => (user?.id ? captureCandidates.find((c) => c.id === user.id) ?? null : null),
    [user?.id, captureCandidates],
  );

  // Recaudar: todas las órdenes por cobrar del turno (sin filtrar por cajero/creador).
  // En Despacho primero NO se ocultan las que aún no están listas: PayableOrdersList
  // las muestra con botón Cobrar rojo + AlertDialog (ready_to_collect=false).
  // Filtrarlas aquí causaba parpadeo (aparecen/desaparecen) al recalcular
  // undispatched_units entre refetches.

  const activeCaptureRequest = useMemo(
    () => pendingCaptureRequests.find((request) => request.id === activeCaptureRequestId) ?? null,
    [activeCaptureRequestId, pendingCaptureRequests],
  );

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  useEffect(() => {
    if (!activeCaptureRequestId) return;
    if (pendingCaptureRequests.some((request) => request.id === activeCaptureRequestId)) return;

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setUploadingCaptureRequestId(null);
    setPreparingPhoto(false);
  }, [activeCaptureRequestId, pendingCaptureRequests, photoPreviewUrl]);

  const cajaPanelReadOnly = !canOperateCaja || !userCajaIsOpen;
  const canChargeFromCompleted = canOperateCaja && userCajaIsOpen;
  const summaryIsOwnCaja = Boolean(user?.id) && summaryCashierId === user.id;
  const summaryReadOnly = cajaPanelReadOnly || !summaryIsOwnCaja;
  const canAnnulSelectedOpening = canAnnulOpening && summaryCashierId !== ALL_CASHIERS;

  useEffect(() => {
    if (!shiftGateQuery.isFetched) return;
    if (userCajaIsOpen) return;
    setCompletedFilters((prev) => {
      if (prev.cashierName === ALL_CASHIERS) return prev;
      if (user?.id && prev.cashierName !== user.id) return prev;
      return { ...prev, cashierName: ALL_CASHIERS };
    });
  }, [shiftGateQuery.isFetched, userCajaIsOpen, user?.id]);

  const scopedCajaSummary = useMemo(() => {
    if (shiftRegisterSnapshot) {
      return scopeCajaSummary({
        denoms: shiftRegisterSnapshot.denoms,
        openingHistory: shiftRegisterSnapshot.openingHistory,
        movements: cashRegisterMovements ?? [],
        cashierId: registerSummaryCashierId,
      });
    }
    return {
      denoms: shift?.denoms ?? [],
      cashierGroups: [],
      openingHistory: shift?.openingHistory ?? [],
      movements: (cashRegisterMovements ?? []).filter((movement) => !user?.id || movement.recordedBy === user.id),
    };
  }, [
    shiftRegisterSnapshot,
    cashRegisterMovements,
    registerSummaryCashierId,
    shift?.denoms,
    shift?.openingHistory,
    user?.id,
  ]);

  const summaryShift = useMemo(() => {
    if (!shift) return shift;
    return {
      ...shift,
      denoms: scopedCajaSummary.denoms,
      openingHistory: scopedCajaSummary.openingHistory,
    };
  }, [shift, scopedCajaSummary.denoms, scopedCajaSummary.openingHistory]);


  useEffect(() => {
    if (!completedChargeOrder) return;
    const refreshed = payableOrders.find((order) => order.id === completedChargeOrder.id) ?? null;
    if (refreshed) {
      setCompletedChargeOrder(refreshed);
    }
  }, [payableOrders, completedChargeOrder?.id]);

  const handleChargeOrderFromCompleted = useCallback(
    async (args: { orderId: string; successorOrderId: string | null }) => {
      setRechargeLoading(true);
      let order: PayableOrder | null = null;
      try {
        // Siempre preparar en BD (reabre misma orden / limpia sucesora legacy) y construir saldo pendiente.
        order = await prepareOrderForRecharge(args);
      } catch (error: any) {
        order = null;
        setCompletedChargeBlock({
          kind: "not_found",
          orderRef: error?.message ? String(error.message) : undefined,
        });
        setRechargeLoading(false);
        return;
      } finally {
        setRechargeLoading(false);
      }

      if (!order) {
        setCompletedChargeBlock({ kind: "not_found" });
        return;
      }
      if (order.locked_for_editing) {
        setCompletedChargeBlock({
          kind: "locked",
          orderRef: getOrderRef(order.order_code, order.order_number),
        });
        return;
      }
      if (!order.ready_to_collect) {
        setCompletedChargeBlock({
          kind: (order.unsent_draft_units ?? 0) > 0 ? "unsent_drafts" : "undispatched",
          orderRef: getOrderRef(order.order_code, order.order_number),
        });
        return;
      }
      setCompletedChargeOrder(order);
    },
    [prepareOrderForRecharge],
  );

  const userOpeningHistory = useMemo(
    () => (shift?.openingHistory ?? []).filter((entry) => entry.cashier_id === user?.id),
    [shift?.openingHistory, user?.id],
  );

  const clearSelectedPhoto = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPreparingPhoto(false);
    setSelectedPhotoFile(null);
    setPhotoPreviewUrl(null);
    setCaptureError(null);
    setUploadProgress(0);
    setUploadingCaptureRequestId(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleTakePhotoClick = async (requestId: string) => {
    setCaptureError(null);
    setActiveCaptureRequestId(requestId);
    clearSelectedPhoto();

    try {
      await openCaptureRequest.mutateAsync(requestId);
    } catch {
      return;
    }

    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 60);
  };

  const handleSelectedPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    setPreparingPhoto(true);
    setCaptureError(null);

    try {
      const preparedFile = await prepareProofImage(file);
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }

      const objectUrl = URL.createObjectURL(preparedFile);
      setSelectedPhotoFile(preparedFile);
      setPhotoPreviewUrl(objectUrl);
    } catch (error: any) {
      setSelectedPhotoFile(null);
      setPhotoPreviewUrl(null);
      setCaptureError(error?.message ?? "No se pudo preparar la foto del comprobante.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } finally {
      setPreparingPhoto(false);
    }
  };

  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 1200;
        
        if (width > height && width > MAX_DIM) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }
        
        canvas.width = Math.floor(width);
        canvas.height = Math.floor(height);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else resolve(file);
          },
          "image/jpeg",
          0.8
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  };

  const handleUploadSelectedPhoto = async () => {
    if (!activeCaptureRequest || !selectedPhotoFile) return;

    if (!PAYMENT_PROOF_API_URL) {
      setCaptureError("La opcion para tomar la foto ya esta lista, pero la subida final aun no esta configurada en este entorno.");
      toast.warning("Falta configurar VITE_PAYMENT_PROOF_API_URL para subir el comprobante.");
      return;
    }

    setUploadingCaptureRequestId(activeCaptureRequest.id);
    setUploadProgress(8);
    setCaptureError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const compressedBlob = await compressImage(selectedPhotoFile);
    const formData = new FormData();
    formData.append("file", compressedBlob, "comprobante.jpg");

    const note = captureNotesByRequest[activeCaptureRequest.id]?.trim();
    if (note) {
      formData.append("note", note);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${PAYMENT_PROOF_API_URL}/api/capture-requests/${activeCaptureRequest.secure_token}/upload`);
        if (accessToken) {
          xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        }
        xhr.timeout = 45000;

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.max(10, Math.min(95, Math.round((event.loaded / event.total) * 100)));
          setUploadProgress(percent);
        };

        xhr.upload.onload = () => {
          setUploadProgress((current) => Math.max(current, 96));
        };

        xhr.onerror = () => reject(new Error("No se pudo subir la foto del comprobante."));
        xhr.onabort = () => reject(new Error("La subida del comprobante fue cancelada."));
        xhr.ontimeout = () => reject(new Error("La subida esta tardando demasiado. Intenta de nuevo."));

        xhr.onload = () => {
          try {
            const payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
              return;
            }
            reject(new Error(payload?.message || "No se pudo guardar el comprobante."));
          } catch {
            reject(new Error("La respuesta del servidor no fue valida."));
          }
        };

        xhr.send(formData);
      });

      setUploadProgress(100);
      toast.success("Comprobante enviado correctamente.");
      await refetchPendingCaptureRequests();
      clearSelectedPhoto();
      setActiveCaptureRequestId(null);
    } catch (error: any) {
      setCaptureError(error?.message ?? "No se pudo subir la foto del comprobante.");
    } finally {
      setUploadingCaptureRequestId(null);
    }
  };

  const renderCaptureContent = () => (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
      <div className="mb-4">
        <h2 className="font-display text-sm font-bold text-foreground">Captura de comprobante</h2>

      </div>

      {isLoadingPendingCaptureRequests ? (
        <div className="flex flex-col items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">
            Buscando solicitud de comprobante...
          </p>
        </div>
      ) : pendingCaptureRequests.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Camera className="h-8 w-8" />
          </div>
          <h3 className="mt-4 font-display text-2xl font-black text-foreground">
            Sin solicitudes pendientes
          </h3>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Cuando registres un pago por transferencia, aqui aparecera la solicitud para tomar y subir el comprobante.
          </p>
        </div>
      ) : (
        <div className="space-y-4 text-left">


          <div className="space-y-3">
            {pendingCaptureRequests.map((request) => (
              <div
                key={request.id}
                className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                      {request.table_name ? `${request.table_name} - ` : ""}
                      Orden {getOrderRef(request.order_code, request.order_number)}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      ${request.amount.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="rounded-2xl"
                    onClick={() => void handleTakePhotoClick(request.id)}
                    disabled={Boolean(uploadingCaptureRequestId) || preparingPhoto}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    Tomar foto
                  </Button>
                  {activeCaptureRequestId === request.id && selectedPhotoFile && (
                    <Button
                      type="button"
                      variant="default"
                      className="rounded-2xl bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => void handleUploadSelectedPhoto()}
                      disabled={uploadingCaptureRequestId === request.id || preparingPhoto}
                    >
                      {uploadingCaptureRequestId === request.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Subir foto
                    </Button>
                  )}
                </div>

                {activeCaptureRequestId === request.id && (
                  <div className="mt-4 rounded-3xl border border-dashed border-orange-200 bg-orange-50/40 p-4">
                    {preparingPhoto ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                        <Loader2 className="h-6 w-6 animate-spin text-orange-600" />
                        <p className="text-sm text-slate-600">
                          Preparando la foto para subirla mas rapido...
                        </p>
                      </div>
                    ) : !selectedPhotoFile || !photoPreviewUrl ? (
                      <p className="text-sm text-slate-600">
                        Toca <span className="font-semibold text-slate-900">Tomar foto</span> para abrir la camara o escoger una imagen del dispositivo.
                      </p>
                    ) : (
                        <div className="space-y-4">
                          {uploadingCaptureRequestId === request.id && (
                            <div className="space-y-2">
                              <Progress value={uploadProgress} className="h-2.5" />
                              <p className="text-xs text-slate-500 text-center">
                                Subiendo comprobante... {uploadProgress}%
                              </p>
                            </div>
                          )}
                          <div className="flex h-[32rem] items-center justify-center overflow-hidden rounded-2xl border border-orange-100 bg-white p-4">
                          <img
                            src={photoPreviewUrl}
                            alt="Preview del comprobante"
                            className="h-full max-w-[22rem] bg-white object-contain"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.22em] text-slate-500">
                            Observacion opcional
                          </label>
                          <Textarea
                            value={captureNotesByRequest[request.id] ?? ""}
                            onChange={(event) =>
                              setCaptureNotesByRequest((current) => ({
                                ...current,
                                [request.id]: event.target.value,
                              }))
                            }
                            placeholder="Ejemplo: comprobante legible, revisar monto, etc."
                            disabled={uploadingCaptureRequestId === request.id || preparingPhoto}
                          />
                        </div>
                        {uploadingCaptureRequestId === request.id && (
                          <div className="space-y-2">
                            <Progress value={uploadProgress} className="h-2.5" />
                            <p className="text-xs text-slate-500">
                              Subiendo comprobante... {uploadProgress}%
                            </p>
                          </div>
                        )}
                        {captureError && (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {captureError}
                          </div>
                        )}
                        {!PAYMENT_PROOF_API_URL && (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                            La camara y la vista previa ya estan disponibles. Para guardar definitivamente la foto falta configurar el backend de comprobantes en este entorno.
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        className="hidden"
        onChange={handleSelectedPhoto}
      />
    </div>
  );

  if (isLoadingShift) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isCaptureDeviceOnly = false;

  if (activeTab === "completed" && !shift) {
    return (
      <div className="min-h-full bg-slate-50 px-4 pt-4 pb-8 sm:px-6 sm:pt-6 lg:px-10">
        <div className="w-full space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-[2.2rem] font-semibold tracking-[-0.04em] text-slate-950">
                Pagos del turno
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Vista de pagos de caja para {activeBranch?.name ?? "Sucursal"}. No hay turno abierto en este momento.
              </p>
            </div>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
            <CompletedPaymentsList
              payments={completedPayments}
              total={completedPaymentsTotal}
              collectedTotal={completedPaymentsCollectedTotal}
              loading={isLoadingCompletedPayments}
              filters={completedFilters}
              permissions={permissions}
              canVoidPayments={canOperateCaja}
              canChargePayments={false}
              shiftDenoms={shift?.denoms ?? []}
              cashierUsers={captureCandidates}
              currentUserId={user?.id ?? null}
              actionLoading={requestPaymentVoid.isPending || voidPaymentWithSupervisor.isPending}
              onFiltersChange={setCompletedFilters}
              onRequestVoid={(paymentId, orderId, reason, paymentSelections, cashRefundDenoms, refundAmount, refundMethod, cashChangeReturnDenoms) =>
                requestPaymentVoid.mutateAsync({
                  paymentId,
                  orderId,
                  reason,
                  paymentSelections,
                  cashRefundDenoms,
                  refundAmount,
                  refundMethod,
                  cashChangeReturnDenoms,
                })
              }
              onVoidWithSupervisor={(paymentId, requestId, reason, supervisorIdentifier, supervisorPassword, paymentSelections, cashRefundDenoms, cashChangeReturnDenoms) =>
                voidPaymentWithSupervisor.mutateAsync({
                  paymentId,
                  requestId,
                  reason,
                  supervisorIdentifier,
                  supervisorPassword,
                  paymentSelections,
                  cashRefundDenoms,
                  cashChangeReturnDenoms,
                })
              }
            />
          </div>
        </div>
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

  const handleRegenerateShiftReport = async () => {
    const freshMovements = shift?.id
      ? await fetchCashRegisterMovementsForShift(shift.id)
      : cashRegisterMovements;

    openCashClosureReportWindow({
      branchName: activeBranch?.name ?? "Sucursal",
      shift,
      completedPayments,
      methodSummary: completedPaymentsMethodSummary,
      movements: freshMovements,
      closureNotes: shift.notes ?? undefined,
      reportMode: "shift",
      transferCashChangeTotal: shiftSummaryTransferCashChange,
    });
  };

  const handleReprintOpeningReport = async (opening: CashOpeningSnapshot) => {
    const freshMovements = shift?.id
      ? await fetchCashRegisterMovementsForShift(shift.id)
      : cashRegisterMovements;

    openCashClosureReportWindow({
      ...scopeReportToOpening({
        branchName: activeBranch?.name ?? "Sucursal",
        shift,
        opening,
        completedPayments,
        movements: freshMovements,
        closureNotes: opening.notes ?? undefined,
        transferCashChangeTotal: shiftSummaryTransferCashChange,
      }),
      reportMode: "opening",
    });
  };

  if (!userCajaIsOpen && activeTab !== "completed") {
    return (
      <div className="bg-slate-50 px-4 py-2 sm:px-6 lg:px-10">
        <div className="w-full space-y-6">
          <div className="border-b border-slate-200 pb-4">
            <h1 className="text-[2.2rem] font-semibold tracking-[-0.04em] text-slate-950">
              Caja · {activeBranch?.name ?? "Sucursal"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {userCajaStatus === "CLOSED"
                ? "Tu caja esta cerrada. Ingresa un nuevo arqueo inicial para volver a cobrar en este turno."
                : "El turno esta abierto. Debes abrir tu propia caja con tu arqueo de monedas y billetes antes de cobrar."}
            </p>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
            <OpenShiftForm
                denominations={denominations}
                templates={cashRegisterTemplates}
                hasCashierUser={Boolean(currentUserCashierCandidate)}
                shiftHasConfiguredCashiers={captureCandidates.length > 0}
                cashierUserLabel={
                  currentUserCashierCandidate
                    ? getUserDisplayName(currentUserCashierCandidate)
                    : null
                }
                onOpen={({ counts }) => openCashRegister.mutate({ counts })}
                opening={openCashRegister.isPending}
                readOnly={!canOperateCaja}
                title={userCajaStatus === "CLOSED" ? "Reabrir mi caja" : "Abrir mi caja"}
                description={
                  userCajaStatus === "CLOSED"
                    ? `Cerraste tu caja en este turno, pero la jornada sigue abierta. Ingresa tu nuevo arqueo inicial para volver a cobrar. Referencia: ${branchReferenceTableCount} mesa(s) en esta sucursal.`
                    : `Ingresa tu conteo inicial de monedas y billetes. Cada cajero habilitado abre su propia caja en el mismo turno. Referencia: ${branchReferenceTableCount} mesa(s) en esta sucursal.`
                }
                openingHistory={userOpeningHistory}
                onRegenerateShiftReport={handleRegenerateShiftReport}
                onReprintOpeningReport={handleReprintOpeningReport}
              />
          </div>
        </div>
      </div>
    );
  }

  if (isCaptureDeviceOnly) {
    return (
      <div className="bg-slate-50 px-4 py-6 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="border-b border-slate-200 pb-4">
            <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-slate-950">
              Caja · {activeBranch?.name ?? "Sucursal"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Este dispositivo esta asignado para capturar comprobantes de transferencia.
            </p>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 text-center shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
            {isLoadingPendingCaptureRequests ? (
              <div className="flex flex-col items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-4 text-sm text-muted-foreground">
                  Buscando solicitudes de comprobante...
                </p>
              </div>
            ) : pendingCaptureRequests.length === 0 ? (
              <>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Camera className="h-8 w-8" />
                </div>
                <h2 className="mt-4 font-display text-2xl font-black text-foreground">
                  Esperando solicitud de foto
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Cuando el cajero principal registre un pago por transferencia, aqui aparecera la solicitud para tomar y subir el comprobante.
                </p>
              </>
            ) : (
              <div className="space-y-4 text-left">
                <div className="flex items-start gap-4 rounded-3xl border border-orange-200 bg-orange-50/70 p-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-orange-600 shadow-sm">
                    <ReceiptText className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-display text-2xl font-black text-foreground">
                      Solicitud de foto pendiente
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Se registro un pago por transferencia y este equipo ya fue notificado para subir el comprobante.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {pendingCaptureRequests.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                            Orden {getOrderRef(request.order_code, request.order_number)}
                          </p>
                          <p className="mt-1 text-lg font-semibold text-slate-950">
                            ${request.amount.toFixed(2)}
                          </p>
                        </div>
                        <Badge className="border-orange-200 bg-orange-100 text-orange-700 hover:bg-orange-100">
                          {request.status === "opened" ? "Abierta" : "Pendiente"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm text-slate-600">
                        Metodo: {request.payment_method_name}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Expira: {new Date(request.token_expires_at).toLocaleTimeString("es-EC", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className="rounded-2xl"
                          onClick={() => void handleTakePhotoClick(request.id)}
                          disabled={Boolean(uploadingCaptureRequestId)}
                        >
                          <Camera className="mr-2 h-4 w-4" />
                          Tomar foto
                        </Button>
                        {activeCaptureRequestId === request.id && selectedPhotoFile && (
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
                            onClick={clearSelectedPhoto}
                            disabled={uploadingCaptureRequestId === request.id}
                          >
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Volver a tomar
                          </Button>
                        )}
                      </div>

                      {activeCaptureRequestId === request.id && (
                        <div className="mt-4 rounded-3xl border border-dashed border-orange-200 bg-orange-50/40 p-4">
                          {!selectedPhotoFile || !photoPreviewUrl ? (
                            <p className="text-sm text-slate-600">
                              Toca <span className="font-semibold text-slate-900">Tomar foto</span> para abrir la camara o escoger una imagen del dispositivo.
                            </p>
                          ) : (
                            <div className="space-y-4">
                              <div className="flex h-[32rem] items-center justify-center overflow-hidden rounded-2xl border border-orange-100 bg-white p-4">
                                <img
                                  src={photoPreviewUrl}
                                  alt="Preview del comprobante"
                                  className="h-full max-w-[22rem] bg-white object-contain"
                                />
                              </div>
                              <div className="rounded-2xl bg-white/90 p-3">
                                <p className="text-sm font-medium text-slate-900">
                                  Vista previa lista
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  La foto solo se guardara cuando confirmes con “Usar foto”.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <label className="text-xs uppercase tracking-[0.22em] text-slate-500">
                                  Observacion opcional
                                </label>
                                <Textarea
                                  value={captureNotesByRequest[request.id] ?? ""}
                                  onChange={(event) =>
                                    setCaptureNotesByRequest((current) => ({
                                      ...current,
                                      [request.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Ejemplo: comprobante legible, revisar monto, etc."
                                  disabled={uploadingCaptureRequestId === request.id}
                                />
                              </div>
                              {uploadingCaptureRequestId === request.id && (
                                <div className="space-y-2">
                                  <Progress value={uploadProgress} className="h-2.5" />
                                  <p className="text-xs text-slate-500">
                                    Subiendo comprobante... {uploadProgress}%
                                  </p>
                                </div>
                              )}
                              {captureError && (
                                <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                  {captureError}
                                </div>
                              )}
                              {!PAYMENT_PROOF_API_URL && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                  La camara y la vista previa ya estan disponibles. Para guardar definitivamente la foto falta configurar el backend de comprobantes en este entorno.
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  className="rounded-2xl"
                                  onClick={() => void handleUploadSelectedPhoto()}
                                  disabled={uploadingCaptureRequestId === request.id}
                                >
                                  {uploadingCaptureRequestId === request.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                  )}
                                  Usar foto
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="rounded-2xl"
                                  onClick={clearSelectedPhoto}
                                  disabled={uploadingCaptureRequestId === request.id}
                                >
                                  <Upload className="mr-2 h-4 w-4" />
                                  Elegir otra
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/*"
              capture="environment"
              className="hidden"
              onChange={handleSelectedPhoto}
            />
            {shift.capture_device_label && (
              <p className="mt-4 text-xs uppercase tracking-[0.22em] text-slate-500">
                Equipo asignado: {shift.capture_device_label}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const shiftElapsed = formatElapsedSince(shift.opened_at);

  const handleCloseCashRegister = async (notes?: string) => {
    showCashReport(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Generando reporte</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; display:flex; align-items:center; justify-content:center; min-height:100vh; color:#1f2937; background:#fff7ed; padding: max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px)); box-sizing: border-box; }
      .card { border:1px solid #fed7aa; border-radius:16px; padding:24px 28px; background:white; box-shadow:0 20px 40px -30px rgba(249,115,22,0.35); text-align:center; max-width: 28rem; }
      h1 { margin:0 0 8px; font-size:22px; }
      p { margin:0; color:#6b7280; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Generando reporte de caja...</h1>
      <p>Espera un momento mientras se cierra la caja.</p>
    </div>
  </body>
</html>`);

    const closedAtIso = new Date().toISOString();
    const closedOpening: CashOpeningSnapshot | null =
      shift.openingHistory.find((entry) => entry.status === "abierta" && entry.is_current)
        ? {
            ...(shift.openingHistory.find((entry) => entry.status === "abierta" && entry.is_current) as CashOpeningSnapshot),
            status: "cerrada" as const,
            closed_at: closedAtIso,
            notes: notes ?? (shift.openingHistory.find((entry) => entry.status === "abierta" && entry.is_current) as CashOpeningSnapshot).notes,
            is_current: false,
          }
        : null;
    const reportSnapshot = {
      branchName: activeBranch?.name ?? "Sucursal",
      shift: {
        ...shift,
        caja_status: "CLOSED" as const,
        notes: notes ?? shift.notes,
        openingHistory: shift.openingHistory.map((entry) =>
          entry.status === "abierta" && entry.is_current
            ? {
                ...entry,
                status: "cerrada" as const,
                closed_at: closedAtIso,
                notes: notes ?? entry.notes,
                is_current: false,
              }
            : entry,
        ),
      },
      completedPayments,
      movements: cashRegisterMovements,
      closureNotes: notes,
    };

    try {
      await closeCashRegister.mutateAsync(notes);

      const reportParams = closedOpening
        ? {
            ...scopeReportToOpening({
              ...reportSnapshot,
              opening: closedOpening,
              denominationSnapshot: shift.denoms,
              transferCashChangeTotal: shiftSummaryTransferCashChange,
            }),
            reportMode: "opening" as const,
            includeToolbar: false,
          }
        : {
            ...reportSnapshot,
            methodSummary: completedPaymentsMethodSummary,
            transferCashChangeTotal: shiftSummaryTransferCashChange,
            reportMode: "shift" as const,
            includeToolbar: false,
          };

      const reportHtml = buildCashClosureReportHtml(reportParams);

      showCashReport(reportHtml, {
        autoPrint: shouldAutoPrintCashReport(),
        printParams: reportParams,
      });
    } catch (error) {
      hideCashReport();
      throw error;
    }
  };

  return (
    <div className="min-h-full bg-slate-50 px-4 pt-3 pb-0 sm:px-6 sm:pt-4 lg:px-10">
      <div className="w-full space-y-6">
        <div className="border-b border-slate-200 pb-4 sm:pb-6">
          <div className="flex flex-col gap-3 sm:gap-5">
            <h1 className="text-base font-semibold tracking-[-0.03em] text-slate-950 sm:text-[1.95rem]">
              Caja · {activeBranch?.name ?? "Sucursal"}
            </h1>
            {activeTab !== "capture" && (
              <div className="flex flex-nowrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-xs text-slate-500 sm:text-sm">
                    Turno abierto hace {shiftElapsed}
                  </p>
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#0f766e]" />
                    <span className="truncate text-xs text-slate-700 sm:text-sm">
                      {userCajaIsOpen ? "Mi caja abierta" : "Turno abierto"}
                    </span>
                    {(!canOperateCaja || !userCajaIsOpen) && (
                      <span className="shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 sm:text-xs">
                        Solo consulta
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  <ShiftSummary
                    shift={summaryShift ?? shift}
                    methodSummary={shiftSummaryMethodSummary}
                    transferCashChangeTotal={shiftSummaryTransferCashChange}
                    movements={scopedCajaSummary.movements}
                    movementsLoading={isLoadingCashRegisterMovements}
                    onClose={handleCloseCashRegister}
                    onAnnulOpen={async (reason) => {
                      const opening = (summaryShift ?? shift).openingHistory.find((entry) => entry.is_current);
                      if (!opening) throw new Error("No hay apertura activa para anular");
                      await annulCashOpening.mutateAsync({ openingId: opening.id, reason });
                    }}
                    onRegisterMovement={(payload) => registerCashMovement.mutateAsync(payload)}
                    closing={closeCashRegister.isPending}
                    annulling={annulCashOpening.isPending}
                    registeringMovement={registerCashMovement.isPending}
                    canAnnulOpen={canAnnulSelectedOpening}
                    readOnly={summaryReadOnly}
                    cashierDenomGroups={scopedCajaSummary.cashierGroups}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={cn(!isDesktop && "space-y-4")}>
          {activeTab === "pending" ? (
            <div className="space-y-3 sm:space-y-4">
              <ComprobantesPagoPendientesPanel />
              <PayableOrdersList
                orders={payableOrders}
                paymentMethods={paymentMethods}
                denominations={denominations}
                shiftDenoms={shift.denoms}
                onPay={(params) => payOrder.mutateAsync(params)}
                onPrepareTransferProof={(params) => prepareTransferProof(params)}
                onDiscardPreparedTransferProof={(session) => discardPreparedTransferProof(session)}
                getTransferProofReadiness={getTransferProofReadiness}
                paying={payOrder.isPending}
                readOnly={cajaPanelReadOnly}
                autoOpenOrderId={autoOpenOrderId}
                onAutoOpenOrderConsumed={clearAutoOpenOrder}
                onRefreshPayableOrders={refetchPayableOrders}
                refreshingPayableOrders={isFetchingPayableOrders}
              />
            </div>
          ) : activeTab === "completed" ? (
            <div className="space-y-3 sm:space-y-4">
              <ComprobantesPagoPendientesPanel />
            <div className={cn(
              "rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]",
              !isDesktop ? "p-4" : "p-5"
            )}>
              <h2 className="mb-3 font-display text-sm font-bold text-foreground">Pagos del turno</h2>
              <CompletedPaymentsList
                payments={completedPayments}
                total={completedPaymentsTotal}
                collectedTotal={completedPaymentsCollectedTotal}
                loading={isLoadingCompletedPayments}
                filters={completedFilters}
                permissions={permissions}
                canVoidPayments={canOperateCaja}
                canChargePayments={canChargeFromCompleted}
                shiftDenoms={shift.denoms}
                cashierUsers={captureCandidates}
                currentUserId={user?.id ?? null}
                actionLoading={requestPaymentVoid.isPending || voidPaymentWithSupervisor.isPending}
                onFiltersChange={setCompletedFilters}
                onRequestVoid={(paymentId, orderId, reason, paymentSelections, cashRefundDenoms, refundAmount, refundMethod, cashChangeReturnDenoms) =>
                  requestPaymentVoid.mutateAsync({
                    paymentId,
                    orderId,
                    reason,
                    paymentSelections,
                    cashRefundDenoms,
                    refundAmount,
                    refundMethod,
                    cashChangeReturnDenoms,
                  })
                }
                onVoidWithSupervisor={(paymentId, requestId, reason, supervisorIdentifier, supervisorPassword, paymentSelections, cashRefundDenoms, cashChangeReturnDenoms) =>
                  voidPaymentWithSupervisor.mutateAsync({
                    paymentId,
                    requestId,
                    reason,
                    supervisorIdentifier,
                    supervisorPassword,
                    paymentSelections,
                    cashRefundDenoms,
                    cashChangeReturnDenoms,
                  })
                }
                onChargeOrder={handleChargeOrderFromCompleted}
              />
            </div>
            </div>
          ) : null}
        </div>
      </div>

      <AlertDialog
        open={!!completedChargeBlock}
        onOpenChange={(open) => {
          if (!open) setCompletedChargeBlock(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {completedChargeBlock?.kind === "locked"
                ? "Orden en edición"
                : completedChargeBlock?.kind === "undispatched"
                  ? "Despacho incompleto"
                  : completedChargeBlock?.kind === "unsent_drafts"
                    ? "Productos sin enviar a caja"
                    : "No se puede cobrar"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {completedChargeBlock?.kind === "locked" ? (
                <>
                  La orden{completedChargeBlock.orderRef ? ` ${completedChargeBlock.orderRef}` : ""} está bloqueada por edición. Finaliza o cancela la edición antes de cobrar.
                </>
              ) : completedChargeBlock?.kind === "undispatched" ? (
                <>
                  La orden{completedChargeBlock.orderRef ? ` ${completedChargeBlock.orderRef}` : ""} aún tiene ítems sin despachar. Despacha todo antes de registrar el cobro.
                </>
              ) : completedChargeBlock?.kind === "unsent_drafts" ? (
                <>
                  La orden{completedChargeBlock.orderRef ? ` ${completedChargeBlock.orderRef}` : ""} tiene productos agregados que aún no se enviaron a caja. Envía esos productos antes de registrar el cobro.
                </>
              ) : (
                <>
                  {completedChargeBlock?.orderRef
                    ? completedChargeBlock.orderRef
                    : "No se encontró la orden pendiente de cobro en este turno. Actualiza la lista o revisa que el pago anulado tenga saldo por cobrar."}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setCompletedChargeBlock(null)}>
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {rechargeLoading ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/20">
          <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparando cobro...
          </div>
        </div>
      ) : null}

      {USE_PAYMENT_DIALOG_V2 ? (
        <PaymentDialogV2
          order={completedChargeOrder}
          denominations={denominations}
          shiftDenoms={shift?.denoms ?? []}
          paymentMethods={paymentMethods}
          onPay={(params) => payOrder.mutateAsync(params)}
          paying={payOrder.isPending}
          open={!!completedChargeOrder}
          onClose={() => setCompletedChargeOrder(null)}
          readOnly={cajaPanelReadOnly}
        />
      ) : (
        <PaymentDialog
          order={completedChargeOrder}
          paymentMethods={paymentMethods}
          shiftDenoms={shift?.denoms ?? []}
          onPay={(params) => payOrder.mutateAsync(params)}
          onPrepareTransferProof={(params) => prepareTransferProof(params)}
          onDiscardPreparedTransferProof={(session) => discardPreparedTransferProof(session)}
          getTransferProofReadiness={getTransferProofReadiness}
          paying={payOrder.isPending}
          open={!!completedChargeOrder}
          onClose={() => setCompletedChargeOrder(null)}
          readOnly={cajaPanelReadOnly}
        />
      )}
    </div>
  );
};

export default Caja;
