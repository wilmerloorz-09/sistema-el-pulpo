import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchCashRegisterMovementsForShift, useCaja, type CompletedPaymentsFilters } from "@/hooks/useCaja";
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
import { getOrderRef } from "@/lib/orderPresentation";

const initialCompletedFilters: CompletedPaymentsFilters = {
  scope: "ALL",
  cashierName: "ALL",
};

const PAYMENT_PROOF_API_URL = (import.meta.env.VITE_PAYMENT_PROOF_API_URL ?? "").trim().replace(/\/$/, "");

const formatElapsed = (openedAt: string) => {
  const opened = new Date(openedAt);
  const elapsed = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 60000));
  const hours = Math.floor(elapsed / 60);
  const minutes = elapsed % 60;
  return `${hours}h ${minutes}m`;
};

const formatMoney = (value: number) => `$${Number(value ?? 0).toFixed(2)}`;

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "N/D";
  return new Date(value).toLocaleString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const translateCashStatus = (value: string | null | undefined) => {
  switch (String(value ?? "").toUpperCase()) {
    case "OPEN":
      return "Abierto";
    case "CLOSED":
      return "Cerrado";
    default:
      return value || "N/D";
  }
};

const translatePaymentStatus = (value: string | null | undefined) => {
  switch (String(value ?? "").toUpperCase()) {
    case "APPLIED":
      return "Aplicado";
    case "PARTIAL":
      return "Parcial";
    case "REVERSED":
      return "Revertido";
    case "VOIDED":
      return "Anulado";
    default:
      return value || "N/D";
  }
};

type CashShiftSnapshot = NonNullable<ReturnType<typeof useCaja>["shift"]>;
type CashOpeningSnapshot = CashShiftSnapshot["openingHistory"][number];

const scopeReportToOpening = (params: {
  branchName: string;
  shift: CashShiftSnapshot;
  opening: CashOpeningSnapshot;
  completedPayments: ReturnType<typeof useCaja>["completedPayments"];
  movements: ReturnType<typeof useCaja>["cashRegisterMovements"];
  closureNotes?: string;
  denominationSnapshot?: CashShiftSnapshot["denoms"];
}) => {
  const openedAtMs = new Date(params.opening.opened_at).getTime();
  const closedAtMs = new Date(params.opening.closed_at ?? params.opening.opened_at).getTime();

  const filteredPayments = params.completedPayments.filter((payment) => {
    const paymentTime = new Date(payment.created_at).getTime();
    return paymentTime >= openedAtMs && paymentTime <= closedAtMs;
  });

  const uniquePayments = Array.from(
    new Map(filteredPayments.map((payment) => [payment.id, payment])).values(),
  );

  const methodSummaryMap = new Map<string, { methodName: string; amount: number; paymentCount: number }>();
  for (const payment of uniquePayments) {
    const current = methodSummaryMap.get(payment.method_name) ?? {
      methodName: payment.method_name,
      amount: 0,
      paymentCount: 0,
    };
    current.amount += Number(payment.amount ?? 0);
    current.paymentCount += 1;
    methodSummaryMap.set(payment.method_name, current);
  }

  const filteredMovements = params.movements.filter((movement) => {
    const movementTime = new Date(movement.createdAt).getTime();
    return movementTime >= openedAtMs && movementTime <= closedAtMs;
  });

  const scopedDenoms = params.denominationSnapshot ?? [];
  const manualMovementTotal = filteredMovements.reduce((sum, movement) => {
    if (movement.movementType === "entrada") return sum + Number(movement.amount ?? 0);
    if (movement.movementType === "salida") return sum - Number(movement.amount ?? 0);
    return sum;
  }, 0);
  const cashMethodTotal = Array.from(methodSummaryMap.values())
    .filter((entry) => /efectivo/i.test(entry.methodName))
    .reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  const estimatedCurrentTotal = Number(params.opening.initial_total ?? 0) + cashMethodTotal + manualMovementTotal;

  return {
    branchName: params.branchName,
    shift: {
      ...params.shift,
      denoms: scopedDenoms,
      openingHistory: [params.opening],
    },
    completedPayments: filteredPayments,
    methodSummary: Array.from(methodSummaryMap.values())
      .map((entry, index) => ({
        methodId: `opening-method-${index}-${entry.methodName}`,
        methodName: entry.methodName,
        amount: entry.amount,
        paymentCount: entry.paymentCount,
      }))
      .sort((left, right) => right.amount - left.amount || left.methodName.localeCompare(right.methodName)),
    movements: filteredMovements,
    closureNotes: params.closureNotes,
    openingCashTotals: {
      initial: Number(params.opening.initial_total ?? 0),
      current: scopedDenoms.length > 0
        ? scopedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_current, 0)
        : estimatedCurrentTotal,
    },
  };
};

const buildCashClosureReportHtml = (params: {
  branchName: string;
  shift: CashShiftSnapshot;
  completedPayments: ReturnType<typeof useCaja>["completedPayments"];
  methodSummary: ReturnType<typeof useCaja>["completedPaymentsMethodSummary"];
  movements: ReturnType<typeof useCaja>["cashRegisterMovements"];
  closureNotes?: string;
  reportMode?: "shift" | "opening";
  openingCashTotals?: {
    initial: number;
    current: number;
  };
}) => {
  const sortedDenoms = [...params.shift.denoms]
    .filter((denomination) => denomination.value > 0)
    .sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.value - b.value;
    });

  const totalInitial = params.openingCashTotals?.initial
    ?? sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_initial, 0);
  const totalCurrent = params.openingCashTotals?.current
    ?? sortedDenoms.reduce((sum, denomination) => sum + denomination.value * denomination.qty_current, 0);
  const closingDenominationCount = sortedDenoms.reduce(
    (sum, denomination) => sum + Number(denomination.qty_current ?? 0),
    0,
  );
  const openings = [...params.shift.openingHistory].sort(
    (left, right) => new Date(left.opened_at).getTime() - new Date(right.opened_at).getTime(),
  );
  const uniquePayments = Array.from(
    new Map(
      params.completedPayments.map((payment) => [
        payment.id,
        {
          id: payment.id,
          created_at: payment.created_at,
          cashier_name: payment.cashier_name,
          amount: payment.amount,
          method_name: payment.method_name,
          order_ref: payment.order_code ?? String(payment.order_number ?? "").padStart(4, "0"),
          table_name: payment.table_name,
          status: translatePaymentStatus(payment.status),
          opening_status: payment.payment_opening_status,
          notes: payment.notes,
        },
      ]),
    ).values(),
  ).sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());

  const statusSummary = uniquePayments.reduce<Record<string, { count: number; amount: number }>>((acc, payment) => {
    const key = translatePaymentStatus(payment.status);
    const bucket = acc[key] ?? { count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += Number(payment.amount ?? 0);
    acc[key] = bucket;
    return acc;
  }, {});

  const paymentRows = uniquePayments.map((payment) => `
    <tr>
      <td>${escapeHtml(formatDateTime(payment.created_at))}</td>
      <td>${escapeHtml(payment.order_ref || "N/D")}</td>
      <td>${escapeHtml(payment.table_name || "-")}</td>
      <td>${escapeHtml(payment.method_name)}</td>
      <td>${escapeHtml(payment.status)}</td>
      <td>${escapeHtml(payment.cashier_name)}</td>
      <td class="num">${escapeHtml(formatMoney(payment.amount))}</td>
    </tr>
  `).join("");

  const methodRows = params.methodSummary.map((method) => `
    <tr>
      <td>${escapeHtml(method.methodName)}</td>
      <td>${escapeHtml(String(method.paymentCount))}</td>
      <td class="num">${escapeHtml(formatMoney(method.amount))}</td>
    </tr>
  `).join("");

  const movementRows = params.movements.length > 0
    ? params.movements.map((movement) => `
        <tr>
          <td>${escapeHtml(formatDateTime(movement.createdAt))}</td>
          <td>${escapeHtml(movement.movementType)}</td>
          <td>${escapeHtml(movement.recordedByName || movement.recordedByUsername || movement.recordedBy)}</td>
          <td>${escapeHtml(movement.reason)}</td>
          <td class="num">${escapeHtml(formatMoney(movement.amount))}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="5" class="muted">Sin movimientos registrados.</td></tr>';

  const closingDenominationRows = sortedDenoms
    .filter((denomination) => Number(denomination.qty_current ?? 0) > 0)
    .map((denomination) => `
      <tr>
        <td>${escapeHtml(denomination.label || formatMoney(denomination.value))}</td>
        <td>${escapeHtml(denomination.denomination_type === "coin" ? "Moneda" : "Billete")}</td>
        <td class="num">${escapeHtml(formatMoney(denomination.value))}</td>
        <td class="num">${escapeHtml(String(denomination.qty_current ?? 0))}</td>
        <td class="num">${escapeHtml(formatMoney(denomination.value * Number(denomination.qty_current ?? 0)))}</td>
      </tr>
    `)
    .join("");

  const openingRows = openings.map((opening) => `
    <tr>
      <td>${escapeHtml(formatDateTime(opening.opened_at))}</td>
      <td>${escapeHtml(opening.status)}</td>
      <td>${escapeHtml(opening.cashier_name)}</td>
      <td>${escapeHtml(formatMoney(opening.initial_total))}</td>
      <td>${escapeHtml(opening.closed_at ? formatDateTime(opening.closed_at) : "-")}</td>
    </tr>
  `).join("");

  const statusCards = [
    { label: "Aplicados", key: "Aplicado" },
    { label: "Parciales", key: "Parcial" },
    { label: "Revertidos", key: "Revertido" },
    { label: "Anulados", key: "Anulado" },
  ].map((entry) => {
    const bucket = statusSummary[entry.key] ?? { count: 0, amount: 0 };
    return `
      <div class="card">
        <div class="label">${escapeHtml(entry.label)}</div>
        <div class="value">${escapeHtml(String(bucket.count))}</div>
        <div class="sub">${escapeHtml(formatMoney(bucket.amount))}</div>
      </div>
    `;
  }).join("");

  const isOpeningReport = params.reportMode === "opening";
  const currentOpening = params.shift.openingHistory[0] ?? null;
  const hasDenominationSnapshot = sortedDenoms.length > 0;
  const paymentsSectionTitle = isOpeningReport ? "Pagos de la apertura" : "Pagos del turno";
  const movementsSectionTitle = isOpeningReport ? "Movimientos de la apertura" : "Movimientos del turno";
  const reportTitle = isOpeningReport ? "Reporte por apertura de caja" : "Reporte consolidado del turno";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Reporte de cierre de caja</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
      h1, h2, h3, p { margin: 0; }
      .header { display:flex; justify-content:space-between; gap:16px; margin-bottom:20px; }
      .grid { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:12px; margin:16px 0; }
      .card { border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fafafa; }
      .label { font-size:12px; text-transform:uppercase; color:#6b7280; margin-bottom:6px; }
      .value { font-size:24px; font-weight:700; }
      .sub { font-size:13px; color:#4b5563; margin-top:4px; }
      .section { margin-top:24px; }
      table { width:100%; border-collapse:collapse; margin-top:10px; font-size:12px; }
      th, td { border:1px solid #e5e7eb; padding:8px; text-align:left; vertical-align:top; }
      th { background:#f3f4f6; }
      tbody tr:nth-child(odd) { background:#ffffff; }
      tbody tr:nth-child(even) { background:#f8fafc; }
      .num { text-align:right; white-space:nowrap; }
      .muted { color:#6b7280; text-align:center; }
      .notes { white-space:pre-wrap; margin-top:8px; padding:12px; border:1px solid #e5e7eb; border-radius:12px; background:#fafafa; }
      .page-break { page-break-before: always; break-before: page; }
      @media print {
        body { margin: 12px; }
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <h1>${escapeHtml(reportTitle)}</h1>
        <p>${escapeHtml(params.branchName)}</p>
        ${isOpeningReport && currentOpening ? `
          <p>Apertura: ${escapeHtml(formatDateTime(currentOpening.opened_at))}</p>
          <p>Cierre: ${escapeHtml(currentOpening.closed_at ? formatDateTime(currentOpening.closed_at) : "-")}</p>
          <p>Estado: ${escapeHtml(currentOpening.status)}</p>
          <p>Cajero: ${escapeHtml(currentOpening.cashier_name || currentOpening.cashier_username || "Sin nombre")}</p>
          <p>Monto inicial: ${escapeHtml(formatMoney(currentOpening.initial_total))}</p>
        ` : `
          <p>Turno abierto: ${escapeHtml(formatDateTime(params.shift.opened_at))}</p>
        `}
      </div>
      <div>
        <p>Generado: ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
        <p>Estado caja: ${escapeHtml(translateCashStatus(params.shift.caja_status))}</p>
        <p>Mesas activas al cierre: ${escapeHtml(String(params.shift.active_tables_count ?? 0))}</p>
      </div>
    </div>

    <div class="grid">
      <div class="card"><div class="label">Apertura</div><div class="value">${escapeHtml(formatMoney(totalInitial))}</div></div>
      <div class="card"><div class="label">Caja actual</div><div class="value">${escapeHtml(formatMoney(totalCurrent))}</div></div>
      <div class="card"><div class="label">Diferencia</div><div class="value">${escapeHtml(formatMoney(totalCurrent - totalInitial))}</div></div>
      <div class="card"><div class="label">Cobrado neto</div><div class="value">${escapeHtml(formatMoney(params.methodSummary.reduce((sum, row) => sum + row.amount, 0)))}</div></div>
    </div>

    <div class="section">
      <h2>Resumen por estado de pago</h2>
      <div class="grid">${statusCards}</div>
    </div>

    <div class="section">
      <h2>Cobro por método</h2>
      <table>
        <thead>
          <tr><th>Método</th><th>Cobros</th><th class="num">Monto</th></tr>
        </thead>
        <tbody>${methodRows || '<tr><td colspan="3" class="muted">Sin cobros registrados.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>${escapeHtml(paymentsSectionTitle)}</h2>
      <table>
        <thead>
          <tr><th>Fecha</th><th>Orden</th><th>Mesa</th><th>Método</th><th>Estado</th><th>Cajero</th><th class="num">Monto</th></tr>
        </thead>
        <tbody>${paymentRows || '<tr><td colspan="7" class="muted">Sin pagos registrados.</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>${escapeHtml(movementsSectionTitle)}</h2>
      <table>
        <thead>
          <tr><th>Fecha</th><th>Tipo</th><th>Registrado por</th><th>Motivo</th><th class="num">Monto</th></tr>
        </thead>
        <tbody>${movementRows}</tbody>
      </table>
    </div>

    ${!isOpeningReport ? `
      <div class="section">
        <h2>Historial de aperturas</h2>
        <table>
          <thead>
            <tr><th>Apertura</th><th>Estado</th><th>Cajero</th><th>Monto inicial</th><th>Cierre</th></tr>
          </thead>
          <tbody>${openingRows || '<tr><td colspan="5" class="muted">Sin aperturas registradas.</td></tr>'}</tbody>
        </table>
      </div>
    ` : ""}

    ${params.closureNotes?.trim()
      ? `<div class="section"><h2>Notas de cierre</h2><div class="notes">${escapeHtml(params.closureNotes.trim())}</div></div>`
      : ""}

    ${isOpeningReport ? `
      <div class="page-break"></div>
      <div class="header">
        <div>
          <h1>Detalle de monedas y billetes al cierre</h1>
          <p>${escapeHtml(params.branchName)}</p>
          ${currentOpening ? `
            <p>Apertura: ${escapeHtml(formatDateTime(currentOpening.opened_at))}</p>
            <p>Cierre: ${escapeHtml(currentOpening.closed_at ? formatDateTime(currentOpening.closed_at) : "-")}</p>
            <p>Cajero: ${escapeHtml(currentOpening.cashier_name || currentOpening.cashier_username || "Sin nombre")}</p>
          ` : ""}
        </div>
        <div>
          <p>Total en caja al cierre: ${escapeHtml(formatMoney(totalCurrent))}</p>
          <p>Generado: ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>
        </div>
      </div>

      ${hasDenominationSnapshot ? `
      <div class="section">
        <h2>Detalle de denominaciones</h2>
        <table>
          <thead>
            <tr><th>Denominación</th><th>Tipo</th><th class="num">Valor</th><th class="num">Cantidad</th><th class="num">Subtotal</th></tr>
          </thead>
          <tbody>${closingDenominationRows ? `${closingDenominationRows}
            <tr>
              <td colspan="3"><strong>Total</strong></td>
              <td class="num"></td>
              <td class="num"><strong>${escapeHtml(formatMoney(totalCurrent))}</strong></td>
            </tr>` : '<tr><td colspan="5" class="muted">Sin denominaciones registradas al cierre.</td></tr>'}</tbody>
        </table>
      </div>
    ` : `
      <div class="section">
        <h2>Detalle de denominaciones</h2>
        <div class="notes">Esta apertura historica no tiene un desglose de billetes y monedas guardado. Se muestran los totales y cobros de su rango para evitar reutilizar el conteo de otra apertura.</div>
      </div>
    `}
    ` : ""}
  </body>
</html>`;
};

const openCashClosureReportWindow = (params: {
  branchName: string;
  shift: CashShiftSnapshot;
  completedPayments: ReturnType<typeof useCaja>["completedPayments"];
  methodSummary: ReturnType<typeof useCaja>["completedPaymentsMethodSummary"];
  movements: ReturnType<typeof useCaja>["cashRegisterMovements"];
  closureNotes?: string;
  reportMode?: "shift" | "opening";
  openingCashTotals?: {
    initial: number;
    current: number;
  };
}) => {
  const reportWindow = window.open("", "_blank", "width=1024,height=900");
  if (!reportWindow) {
    return null;
  }

  reportWindow.document.open();
  reportWindow.document.write(buildCashClosureReportHtml(params));
  reportWindow.document.close();
  reportWindow.focus();
  window.setTimeout(() => {
    reportWindow.print();
  }, 350);

  return reportWindow;
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
    isLoadingShift,
    cashRegisterMovements,
    isLoadingCashRegisterMovements,
    branchReferenceTableCount,
    payableOrders,
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
    takeCajaControl,
  } = useCaja({ completedPaymentsFilters: completedFilters, autoOpenOrderId });

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

  const activeCajaSessionIds = [
    shiftGateQuery.data?.lastSessionId,
    shiftGateQuery.data?.secondarySessionId,
  ].filter((value): value is string => Boolean(value));
  const isCurrentTabRegisteredInCaja = activeCajaSessionIds.includes(TAB_SESSION_ID);
  const hasCajaSessionSlotAvailable =
    activeCajaSessionIds.length === 0
    || (Boolean(shiftGateQuery.data?.canDoubleSession) && activeCajaSessionIds.length < 2);

  useEffect(() => {
    const shiftId = shiftGateQuery.data?.shiftId;
    if (!shiftId || !shiftGateQuery.data?.userEnabled || isCurrentTabRegisteredInCaja || !hasCajaSessionSlotAvailable) {
      return;
    }
    void takeCajaControl({ sessionId: TAB_SESSION_ID, shiftId });
  }, [
    hasCajaSessionSlotAvailable,
    isCurrentTabRegisteredInCaja,
    shiftGateQuery.data?.shiftId,
    shiftGateQuery.data?.userEnabled,
    takeCajaControl,
  ]);

  const isSessionAuthorized =
    !shiftGateQuery.data?.shiftId
    || !shiftGateQuery.data?.userEnabled
    || isCurrentTabRegisteredInCaja;

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

  if (activeTab === "completed" && (!shift || shift.caja_status !== "OPEN")) {
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
              shiftDenoms={shift?.denoms ?? []}
              actionLoading={requestPaymentVoid.isPending || voidPaymentWithSupervisor.isPending}
              onFiltersChange={setCompletedFilters}
              onRequestVoid={(paymentId, reason, paymentSelections, cashRefundDenoms) =>
                requestPaymentVoid.mutateAsync({ paymentId, reason, paymentSelections, cashRefundDenoms })
              }
              onVoidWithSupervisor={(paymentId, requestId, reason, supervisorIdentifier, supervisorPassword, paymentSelections, cashRefundDenoms) =>
                voidPaymentWithSupervisor.mutateAsync({
                  paymentId,
                  requestId,
                  reason,
                  supervisorIdentifier,
                  supervisorPassword,
                  paymentSelections,
                  cashRefundDenoms,
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

    const reportWindow = openCashClosureReportWindow({
      branchName: activeBranch?.name ?? "Sucursal",
      shift,
      completedPayments,
      methodSummary: completedPaymentsMethodSummary,
      movements: freshMovements,
      closureNotes: shift.notes ?? undefined,
      reportMode: "shift",
    });

    if (!reportWindow) {
      toast.warning("El navegador bloqueo la ventana del reporte. Permite ventanas emergentes para Caja.");
    }
  };

  const handleReprintOpeningReport = async (opening: CashOpeningSnapshot) => {
    const freshMovements = shift?.id
      ? await fetchCashRegisterMovementsForShift(shift.id)
      : cashRegisterMovements;

    const reportWindow = openCashClosureReportWindow({
      ...scopeReportToOpening({
        branchName: activeBranch?.name ?? "Sucursal",
        shift,
        opening,
        completedPayments,
        movements: freshMovements,
        closureNotes: opening.notes ?? undefined,
      }),
      reportMode: "opening",
    });

    if (!reportWindow) {
      toast.warning("El navegador bloqueo la ventana del reporte. Permite ventanas emergentes para Caja.");
    }
  };

  if (shift.caja_status !== "OPEN") {
    return (
      <div className="bg-slate-50 px-4 py-2 sm:px-6 lg:px-10">
        <div className="w-full space-y-6">
          <div className="border-b border-slate-200 pb-4">
            <h1 className="text-[2.2rem] font-semibold tracking-[-0.04em] text-slate-950">
              Caja · {activeBranch?.name ?? "Sucursal"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              La jornada ya esta abierta. Falta preparar la caja para cobrar.
            </p>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.35)]">
            {shift.caja_status !== "OPEN" ? (
              <OpenShiftForm
                denominations={denominations}
                templates={cashRegisterTemplates}
                hasCashierUser={captureCandidates.length === 1}
                cashierUserLabel={
                  captureCandidates.length === 1
                    ? `${captureCandidates[0].full_name} @${captureCandidates[0].username}`
                    : null
                }
                onOpen={({ counts }) => openCashRegister.mutate({ counts })}
                opening={openCashRegister.isPending}
                readOnly={!canOperateCaja}
                title={shift.caja_status === "CLOSED" ? "Reabrir Caja" : "Abrir Caja"}
                description={
                  shift.caja_status === "CLOSED"
                    ? `La caja fue cerrada antes, pero el turno sigue abierto. Ingresa un nuevo conteo inicial para reanudar cobros. El turno tiene ${branchReferenceTableCount} mesa(s) de referencia en esta sucursal.`
                    : `Ingresa el conteo inicial de caja. El turno tiene ${branchReferenceTableCount} mesa(s) de referencia en esta sucursal.`
                }
                openingHistory={shift.openingHistory}
                onRegenerateShiftReport={handleRegenerateShiftReport}
                onReprintOpeningReport={handleReprintOpeningReport}
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

  const shiftElapsed = formatElapsed(shift.opened_at);

  const handleCloseCashRegister = async (notes?: string) => {
    const reportWindow = window.open("", "_blank", "width=1024,height=900");
    if (!reportWindow) {
      toast.warning("El navegador bloqueo la ventana del reporte. Permite ventanas emergentes para Caja.");
      return;
    }

    reportWindow.document.open();
    reportWindow.document.write(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Generando reporte</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; display:flex; align-items:center; justify-content:center; min-height:100vh; color:#1f2937; background:#fff7ed; }
      .card { border:1px solid #fed7aa; border-radius:16px; padding:24px 28px; background:white; box-shadow:0 20px 40px -30px rgba(249,115,22,0.35); text-align:center; }
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
    reportWindow.document.close();

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

        reportWindow.document.open();
        reportWindow.document.write(
          buildCashClosureReportHtml(
            closedOpening
              ? {
                  ...scopeReportToOpening({
                    ...reportSnapshot,
                    opening: closedOpening,
                    denominationSnapshot: shift.denoms,
                  }),
                  reportMode: "opening",
                }
              : {
                  ...reportSnapshot,
                  methodSummary: completedPaymentsMethodSummary,
                  reportMode: "shift",
                },
          ),
        );
      reportWindow.document.close();
      reportWindow.focus();
      window.setTimeout(() => {
        reportWindow.print();
      }, 350);
    } catch (error) {
      reportWindow.close();
      throw error;
    }
  };

  return (
    <div className="min-h-full bg-slate-50 px-4 pt-3 pb-0 sm:px-6 sm:pt-4 lg:px-10">
      <div className="w-full space-y-6">
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
                onClose={handleCloseCashRegister}
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
                readOnly={!canOperateCaja}
                autoOpenOrderId={autoOpenOrderId}
                onAutoOpenOrderConsumed={clearAutoOpenOrder}
              />
            </div>
          ) : activeTab === "completed" ? (
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
                shiftDenoms={shift.denoms}
                actionLoading={requestPaymentVoid.isPending || voidPaymentWithSupervisor.isPending}
                onFiltersChange={setCompletedFilters}
                onRequestVoid={(paymentId, reason, paymentSelections, cashRefundDenoms) =>
                  requestPaymentVoid.mutateAsync({ paymentId, reason, paymentSelections, cashRefundDenoms })
                }
                onVoidWithSupervisor={(paymentId, requestId, reason, supervisorIdentifier, supervisorPassword, paymentSelections, cashRefundDenoms) =>
                  voidPaymentWithSupervisor.mutateAsync({
                    paymentId,
                    requestId,
                    reason,
                    supervisorIdentifier,
                    supervisorPassword,
                    paymentSelections,
                    cashRefundDenoms,
                  })
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Caja;
