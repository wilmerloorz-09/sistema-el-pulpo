import { Capacitor } from "@capacitor/core";
import { getOrderRef } from "@/lib/orderPresentation";
import { Database } from "@/integrations/supabase/types";
import { hideCashReport, showCashReport } from "@/lib/cashReportViewerStore";

/** En móvil/tablet/nativo el diálogo de impresión atrapa al usuario; el reporte ya tiene botón Imprimir. */
export const shouldAutoPrintCashReport = (): boolean => {
  if (typeof window === "undefined") return false;
  if (Capacitor.isNativePlatform()) return false;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const narrowViewport = window.matchMedia("(max-width: 1024px)").matches;
  return !(coarsePointer || narrowViewport);
};

export type CashShiftSnapshot = {
  id: string;
  opened_at: string;
  caja_status: Database["public"]["Enums"]["caja_status"];
  active_tables_count: number;
  denoms: Array<{
    value: number;
    qty_initial: number;
    qty_current: number;
    label: string;
    display_order: number;
    denomination_type?: "coin" | "bill";
  }>;
  openingHistory: Array<{
    opened_at: string;
    closed_at: string | null;
    status: string;
    cashier_name: string | null;
    cashier_username?: string | null;
    initial_total: number;
  }>;
};

export type CashOpeningSnapshot = CashShiftSnapshot["openingHistory"][number];

export type CompletedPayment = {
  id: string;
  created_at: string;
  amount: number;
  method_name: string;
  order_code?: string | null;
  order_number?: number | null;
  table_name?: string | null;
  status: string;
  payment_opening_status?: string | null;
  notes?: string | null;
  cashier_name?: string | null;
};

export type CashMovement = {
  id: string;
  createdAt: string;
  movementType: "entrada" | "salida" | "cambio_denominacion";
  amount: number;
  reason: string;
  recordedBy?: string;
  recordedByName?: string;
  recordedByUsername?: string;
};

export type MethodSummaryEntry = {
  methodId: string;
  methodName: string;
  amount: number;
  paymentCount: number;
};

export const formatMoney = (value: number) => `$${Number(value ?? 0).toFixed(2)}`;

export const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "N/D";
  return new Date(value).toLocaleString("es-EC", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const translateCashStatus = (value: string | null | undefined) => {
  switch (String(value ?? "").toUpperCase()) {
    case "OPEN":
      return "Abierto";
    case "CLOSED":
      return "Cerrado";
    default:
      return value || "N/D";
  }
};

export const translatePaymentStatus = (value: string | null | undefined) => {
  switch (String(value ?? "").toUpperCase()) {
    case "APPLIED":
    case "PAGADO":
      return "Aplicado";
    case "PARTIAL":
      return "Parcial";
    case "REVERSED":
      return "Revertido";
    case "VOIDED":
    case "CANCELLED":
      return "Anulado";
    default:
      return value || "N/D";
  }
};

export const scopeReportToOpening = (params: {
  branchName: string;
  shift: CashShiftSnapshot;
  opening: CashOpeningSnapshot;
  completedPayments: CompletedPayment[];
  movements: CashMovement[];
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

export const buildCashClosureReportHtml = (params: {
  branchName: string;
  shift: CashShiftSnapshot;
  completedPayments: CompletedPayment[];
  methodSummary: MethodSummaryEntry[];
  movements: CashMovement[];
  closureNotes?: string;
  reportMode?: "shift" | "opening";
  openingCashTotals?: {
    initial: number;
    current: number;
  };
  /** Toolbar HTML (Imprimir/Cerrar). En visor in-app debe ser false. */
  includeToolbar?: boolean;
}) => {
  const includeToolbar = params.includeToolbar !== false;
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
          order_ref: getOrderRef(payment.order_code, payment.order_number),
          table_name: payment.table_name,
          status: translatePaymentStatus(payment.status),
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
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Reporte de cierre de caja</title>
    <style>
      html, body { margin: 0; padding: 0; background: #fff; color: #1f2937; }
      body { font-family: Arial, sans-serif; padding: 16px; padding-bottom: max(24px, env(safe-area-inset-bottom, 0px)); overflow-y: auto; -webkit-overflow-scrolling: touch; }
      h1, h2, h3, p { margin: 0; }
      .toolbar {
        position: sticky; top: 0; z-index: 40;
        display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; align-items: center;
        margin: -16px -16px 16px; padding: 12px 16px;
        padding-top: max(12px, env(safe-area-inset-top, 0px));
        background: rgba(255,255,255,0.97); border-bottom: 1px solid #e5e7eb;
        box-shadow: 0 8px 20px -18px rgba(15,23,42,0.45);
      }
      .toolbar button {
        appearance: none; border-radius: 999px; border: 1px solid #fdba74;
        background: #fff7ed; color: #9a3412; font-weight: 700; font-size: 14px;
        padding: 10px 16px; min-height: 44px; cursor: pointer;
      }
      .toolbar button.primary { background: #ea580c; border-color: #ea580c; color: #fff; }
      .header { display:flex; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap: wrap; }
      .grid { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; margin:16px 0; }
      @media (min-width: 900px) {
        .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      }
      .card { border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fafafa; }
      .label { font-size:12px; text-transform:uppercase; color:#6b7280; margin-bottom:6px; }
      .value { font-size:24px; font-weight:700; }
      .sub { font-size:13px; color:#4b5563; margin-top:4px; }
      .section { margin-top:24px; }
      .table-wrap { width:100%; overflow-x:auto; -webkit-overflow-scrolling: touch; }
      table { width:100%; min-width: 520px; border-collapse:collapse; margin-top:10px; font-size:12px; }
      th, td { border:1px solid #e5e7eb; padding:8px; text-align:left; vertical-align:top; }
      th { background:#f3f4f6; }
      tbody tr:nth-child(odd) { background:#ffffff; }
      tbody tr:nth-child(even) { background:#f8fafc; }
      .num { text-align:right; white-space:nowrap; }
      .muted { color:#6b7280; text-align:center; }
      .notes { white-space:pre-wrap; margin-top:8px; padding:12px; border:1px solid #e5e7eb; border-radius:12px; background:#fafafa; }
      .page-break { page-break-before: always; break-before: page; }
      @media print {
        body { margin: 12px; padding: 12px; }
        .toolbar { display: none !important; }
        .page-break { page-break-before: always; break-before: page; }
      }
    </style>
    ${includeToolbar ? `
    <script>
      function cerrarReporteCaja() {
        try {
          if (window.opener && !window.opener.closed) {
            try {
              window.opener.postMessage({ type: "el-pulpo-cerrar-reporte-caja" }, "*");
            } catch (_e) {}
            try { window.opener.focus(); } catch (_e) {}
          }
        } catch (_e) {}

        try { window.close(); } catch (_e) {}

        window.setTimeout(function () {
          var sigueAbierta = true;
          try { sigueAbierta = !window.closed; } catch (_e) { sigueAbierta = true; }
          if (!sigueAbierta) return;

          try {
            if (window.history.length > 1) {
              window.history.back();
              return;
            }
          } catch (_e) {}

          document.body.innerHTML =
            '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif;text-align:center;background:#fff;box-sizing:border-box;">' +
            '<div><p style="font-size:18px;font-weight:700;margin:0 0 8px;color:#1f2937;">Reporte cerrado</p>' +
            '<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.4;">Use el botón Atrás del dispositivo para volver a Caja.</p></div></div>';
        }, 120);
      }
    </script>
    ` : ""}
  </head>
  <body>
    ${includeToolbar ? `
    <div class="toolbar">
      <button type="button" class="primary" onclick="window.print()">Imprimir</button>
      <button type="button" onclick="cerrarReporteCaja()">Cerrar</button>
    </div>
    ` : ""}
    <div class="header">
      <div>
        <h1>${escapeHtml(reportTitle)}</h1>
        <p>${escapeHtml(params.branchName)}</p>
        ${isOpeningReport && currentOpening ? `
          <p>Apertura: ${escapeHtml(formatDateTime(currentOpening.opened_at))}</p>
          <p>Cierre: ${escapeHtml(currentOpening.closed_at ? formatDateTime(currentOpening.closed_at) : "-")}</p>
          <p>Estado: ${escapeHtml(currentOpening.status)}</p>
          <p>Cajero: ${escapeHtml(currentOpening.cashier_username || currentOpening.cashier_name || "Sin nombre")}</p>
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
      <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Método</th><th>Cobros</th><th class="num">Monto</th></tr>
        </thead>
        <tbody>${methodRows || '<tr><td colspan="3" class="muted">Sin cobros registrados.</td></tr>'}</tbody>
      </table>
      </div>
    </div>

    <div class="section">
      <h2>${escapeHtml(paymentsSectionTitle)}</h2>
      <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Fecha</th><th>Orden</th><th>Mesa</th><th>Método</th><th>Estado</th><th>Cajero</th><th class="num">Monto</th></tr>
        </thead>
        <tbody>${paymentRows || '<tr><td colspan="7" class="muted">Sin pagos registrados.</td></tr>'}</tbody>
      </table>
      </div>
    </div>

    <div class="section">
      <h2>${escapeHtml(movementsSectionTitle)}</h2>
      <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Fecha</th><th>Tipo</th><th>Registrado por</th><th>Motivo</th><th class="num">Monto</th></tr>
        </thead>
        <tbody>${movementRows}</tbody>
      </table>
      </div>
    </div>

    ${!isOpeningReport ? `
      <div class="section">
        <h2>Historial de aperturas</h2>
        <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Apertura</th><th>Estado</th><th>Cajero</th><th>Monto inicial</th><th>Cierre</th></tr>
          </thead>
          <tbody>${openingRows || '<tr><td colspan="5" class="muted">Sin aperturas registradas.</td></tr>'}</tbody>
        </table>
        </div>
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
            <p>Cajero: ${escapeHtml(currentOpening.cashier_username || currentOpening.cashier_name || "Sin nombre")}</p>
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
        <div class="table-wrap">
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

export const CASH_REPORT_CLOSE_MESSAGE = "el-pulpo-cerrar-reporte-caja";

/** @deprecated El reporte ahora se cierra desde el visor in-app. */
export const attachCashReportCloseBridge = (_reportWindow: Window) => {
  return () => {};
};

/**
 * Abre el reporte de cierre de caja en un visor in-app (pantalla completa).
 * Evita window.open en tablet/Capacitor, donde Imprimir/Cerrar no responden.
 */
export const openCashClosureReportWindow = (params: {
  branchName: string;
  shift: CashShiftSnapshot;
  completedPayments: CompletedPayment[];
  methodSummary: MethodSummaryEntry[];
  movements: CashMovement[];
  closureNotes?: string;
  reportMode?: "shift" | "opening";
  openingCashTotals?: {
    initial: number;
    current: number;
  };
  /** Por defecto: solo en escritorio. En móvil el usuario usa el botón Imprimir del reporte. */
  autoPrint?: boolean;
}) => {
  const { autoPrint = shouldAutoPrintCashReport(), ...reportParams } = params;
  const html = buildCashClosureReportHtml({
    ...reportParams,
    includeToolbar: false,
  });

  showCashReport(html, { autoPrint });

  return {
    closed: false,
    close: () => {
      hideCashReport();
    },
    focus: () => {},
    print: () => {},
    document: {
      open: () => {},
      write: () => {},
      close: () => {},
    },
  } as unknown as Window;
};
