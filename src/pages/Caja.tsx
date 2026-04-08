import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCaja, type CompletedPaymentsFilters } from "@/hooks/useCaja";
import { useBranch } from "@/contexts/BranchContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBranchShiftGate, TAB_SESSION_ID } from "@/hooks/useBranchShiftGate";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { supabase } from "@/services/DatabaseService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import OpenShiftForm from "@/components/caja/OpenShiftForm";
import ShiftSummary from "@/components/caja/ShiftSummary";
import PayableOrdersList from "@/components/caja/PayableOrdersList";
import CompletedPaymentsList from "@/components/caja/CompletedPaymentsList";
import { toast } from "sonner";
import { Camera, CheckCircle2, CreditCard, History, Loader2, ReceiptText, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { canManage, canOperate } from "@/lib/permissions";
import { prepareProofImage } from "@/lib/prepareProofImage";

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

const PAYMENT_PROOF_API_URL = (import.meta.env.VITE_PAYMENT_PROOF_API_URL ?? "").trim().replace(/\/$/, "");

const formatElapsed = (openedAt: string) => {
  const opened = new Date(openedAt);
  const elapsed = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 60000));
  const hours = Math.floor(elapsed / 60);
  const minutes = elapsed % 60;
  return `${hours}h ${minutes}m`;
};

const Caja = () => {
  const { user } = useAuth();
  const { permissions, isGlobalAdmin, activeBranch } = useBranch();
  const shiftGateQuery = useBranchShiftGate();
  const { isDesktop } = useBreakpoint();
  const [searchParams, setSearchParams] = useSearchParams();
  const [completedFilters, setCompletedFilters] = useState<CompletedPaymentsFilters>(initialCompletedFilters);

  const [activeCaptureRequestId, setActiveCaptureRequestId] = useState<string | null>(null);
  const [selectedPhotoFile, setSelectedPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [captureNotesByRequest, setCaptureNotesByRequest] = useState<Record<string, string>>({});
  const [uploadingCaptureRequestId, setUploadingCaptureRequestId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeTabParam = searchParams.get("tab");
  const activeTab =
    activeTabParam === "completed"
      ? "completed"
      : activeTabParam === "capture"
        ? "capture"
        : "pending";

  const setActiveTab = (tab: "pending" | "completed" | "capture") => {
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "pending") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", tab);
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
    requestPaymentReversal,
    reversePayment,
    approvePaymentReversal,
    closeCashRegister,
    annulCashOpening,
    registerCashMovement,
    takeCajaControl,
  } = useCaja(completedFilters);

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

  useEffect(() => {
    const shiftId = shiftGateQuery.data?.shiftId;
    const currentSessionIdInDb = shiftGateQuery.data?.lastSessionId;
    // Only auto-claim if the shift is active but NO session has been registered yet in the DB
    if (shiftId && shiftGateQuery.data?.userEnabled && !currentSessionIdInDb) {
      void takeCajaControl({ sessionId: TAB_SESSION_ID, shiftId });
    }
  }, [shiftGateQuery.data?.shiftId, shiftGateQuery.data?.userEnabled]);

  const isSessionAuthorized = !shiftGateQuery.data?.shiftId || !shiftGateQuery.data?.userEnabled || shiftGateQuery.data?.lastSessionId === TAB_SESSION_ID;

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
                      {request.order_code
                        ? `Orden ${request.order_code}`
                        : request.order_number
                          ? `Orden #${request.order_number}`
                          : "Orden"}
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

  if (activeTab === "completed" && (!shift || shift.caja_status !== "OPEN")) {
    return (
      <div className="min-h-full bg-slate-50 px-4 pt-4 pb-8 sm:px-6 sm:pt-6 lg:px-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-[2.2rem] font-semibold tracking-[-0.04em] text-slate-950">
                Historial de Pagos
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                Visualizando pagos ({activeBranch?.name ?? "Sucursal"}). No hay turno de caja abierto actualmente.
              </p>
            </div>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
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
              onReversePayment={async (paymentId, reason, paymentEntryIds) => {
                await reversePayment.mutateAsync({ paymentId, reason, paymentEntryIds });
              }}
              onApproveReversal={(paymentId, approve, reason, paymentEntryIds) =>
                approvePaymentReversal.mutateAsync({ paymentId, approved: approve, reason, paymentEntryIds })
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
                hasCashierUser={captureCandidates.length === 1}
                cashierUserLabel={
                  captureCandidates.length === 1
                    ? `${captureCandidates[0].full_name} @${captureCandidates[0].username}`
                    : null
                }
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
                            {request.order_code
                              ? `Orden ${request.order_code}`
                              : request.order_number
                                ? `Orden #${request.order_number}`
                                : "Orden"}
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
              {activeTab !== "capture" && (
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
              )}
            </div>

            {activeTab !== "capture" && (
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
            )}
          </div>
        </div>

        <div className={cn(!isDesktop && "space-y-4")}>
          {activeTab === "pending" ? (
            <div className={cn(!isDesktop && "rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]")}>
              <PayableOrdersList
                orders={payableOrders}
                paymentMethods={paymentMethods}
                shiftDenoms={shift.denoms}
                onPay={(params) => payOrder.mutateAsync(params)}
                onPrepareTransferProof={(params) => prepareTransferProof(params)}
                onDiscardPreparedTransferProof={(session) => discardPreparedTransferProof(session)}
                getTransferProofReadiness={getTransferProofReadiness}
                paying={payOrder.isPending}
                readOnly={!canOperateCaja || !isSessionAuthorized}
                onTakeControl={() => {
                  const shiftId = shiftGateQuery.data?.shiftId;
                  if (shiftId) void takeCajaControl({ sessionId: TAB_SESSION_ID, shiftId });
                }}
              />
            </div>
          ) : activeTab === "completed" ? (
            <div className={cn(
              "rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]",
              !isDesktop ? "p-4" : "p-5"
            )}>
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
                onReversePayment={async (paymentId, reason, paymentEntryIds) => {
                  await reversePayment.mutateAsync({ paymentId, reason, paymentEntryIds });
                }}
                onApproveReversal={(paymentId, approve, reason, paymentEntryIds) =>
                  approvePaymentReversal.mutateAsync({ paymentId, approved: approve, reason, paymentEntryIds })
                }
              />
            </div>
          ) : renderCaptureContent()}
        </div>
      </div>
    </div>
  );
};

export default Caja;
