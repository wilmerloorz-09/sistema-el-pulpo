/**
 * Diagnostico: descuadre de caja para un cajero en una sucursal.
 * Reconcilia denominaciones (cash_shift_denoms) contra el libro de
 * movimientos (cash_movements), pagos en efectivo y movimientos manuales.
 *
 * Uso: node scripts/debug_descuadre_caja.mjs [sucursal] [cajero]
 *   ej: node scripts/debug_descuadre_caja.mjs Principal Jhon
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const candidates = [".env.local", ".env"];
  const path = candidates
    .map((name) => resolve(process.cwd(), name))
    .find((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
  if (!path) throw new Error("No se encontro .env.local ni .env");
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const branchFilter = process.argv[2] ?? "Principal";
const cashierFilter = process.argv[3] ?? "Jhon";
const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });
const money = (v) => `$${Number(v ?? 0).toFixed(2)}`;

async function login() {
  const { data, error } = await supabase.functions.invoke("login-with-identifier", {
    body: { identifier: "wloor", password: "wkim919293" },
  });
  if (error) throw new Error(`Login fallo: ${error.message}`);
  if (data?.error) throw new Error(`Login fallo: ${data.error}`);
  const { error: sErr } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sErr) throw sErr;
  console.log("Sesion iniciada como wloor");
}

async function main() {
  await login();
  // 1) Sucursal
  const { data: branches, error: bErr } = await supabase
    .from("branches")
    .select("id, name")
    .ilike("name", `%${branchFilter}%`);
  if (bErr) throw bErr;
  if (!branches?.length) {
    console.error("Sucursal no encontrada:", branchFilter);
    return;
  }
  console.log("Sucursales encontradas:", branches.map((b) => b.name).join(" | "));
  const branch = branches[0];
  console.log(`\n== Sucursal: ${branch.name} (${branch.id})`);

  // 2) Cajero (perfil)
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, username, alias, first_name, last_name, full_name")
    .or(
      [
        `username.ilike.%${cashierFilter}%`,
        `alias.ilike.%${cashierFilter}%`,
        `first_name.ilike.%${cashierFilter}%`,
        `full_name.ilike.%${cashierFilter}%`,
      ].join(","),
    );
  if (pErr) throw pErr;
  if (!profiles?.length) {
    console.error("Cajero no encontrado:", cashierFilter);
    return;
  }
  console.log(
    "Cajeros que coinciden:",
    profiles.map((p) => `${p.alias ?? p.username} (${p.full_name ?? p.first_name ?? ""})`).join(" | "),
  );
  const cashier = profiles[0];
  console.log(`\n== Cajero: ${cashier.alias ?? cashier.username} (${cashier.id})`);

  // 3) Turnos OPEN de la sucursal
  const { data: shifts, error: sErr } = await supabase
    .from("cash_shifts")
    .select("id, shift_code, status, opened_at")
    .eq("branch_id", branch.id)
    .order("opened_at", { ascending: false })
    .limit(5);
  if (sErr) throw sErr;
  const openShift = shifts?.find((s) => s.status === "OPEN") ?? shifts?.[0];
  if (!openShift) {
    console.log("Sin turnos en la sucursal.");
    return;
  }
  console.log(`\n== Turno: ${openShift.shift_code ?? openShift.id} status=${openShift.status} abierto=${openShift.opened_at}`);

  // 4) Denominaciones del catalogo
  const { data: denomCatalog } = await supabase
    .from("denominations")
    .select("id, value, label, display_order");
  const denomById = new Map((denomCatalog ?? []).map((d) => [d.id, d]));

  // 5) cash_shift_denoms del cajero
  const { data: shiftDenoms, error: dErr } = await supabase
    .from("cash_shift_denoms")
    .select("*")
    .eq("shift_id", openShift.id);
  if (dErr) throw dErr;
  const mine = (shiftDenoms ?? []).filter((r) => (r.cashier_id ? r.cashier_id === cashier.id : true));
  if (!mine.length) {
    console.log("El cajero no tiene cash_shift_denoms en este turno.");
  }

  let openingTotal = 0;
  let currentTotal = 0;
  const denomRows = [];
  for (const row of mine) {
    const d = denomById.get(row.denomination_id);
    const value = Number(d?.value ?? 0);
    openingTotal += value * Number(row.qty_initial ?? 0);
    currentTotal += value * Number(row.qty_current ?? 0);
    denomRows.push({
      value,
      label: d?.label ?? money(value),
      qty_initial: Number(row.qty_initial ?? 0),
      qty_current: Number(row.qty_current ?? 0),
      display_order: d?.display_order ?? 0,
      denomination_id: row.denomination_id,
    });
  }
  denomRows.sort((a, b) => a.value - b.value);

  console.log(`\n-- Denominaciones del cajero (${mine.length} filas)`);
  console.log("valor      | ini  | act  | delta | delta $$");
  let netDenomChange = 0;
  for (const r of denomRows) {
    const delta = r.qty_current - r.qty_initial;
    netDenomChange += delta * r.value;
    console.log(
      `${money(r.value).padEnd(10)} | ${String(r.qty_initial).padStart(4)} | ${String(r.qty_current).padStart(4)} | ${String(delta).padStart(5)} | ${money(delta * r.value)}`,
    );
  }
  console.log(`Apertura (denoms):  ${money(openingTotal)}`);
  console.log(`Actual   (denoms):  ${money(currentTotal)}`);
  console.log(`Cambio neto denoms: ${money(netDenomChange)}`);

  // 6) Pagos del cajero en el turno
  const { data: methods } = await supabase.from("payment_methods").select("id, name");
  const methodById = new Map((methods ?? []).map((m) => [m.id, m.name]));
  const { data: payments, error: payErr } = await supabase
    .from("payments")
    .select("id, amount, change_amount, status, payment_method_id, created_by, created_at, order_id, voided_at, void_reason, notes")
    .eq("shift_id", openShift.id)
    .eq("created_by", cashier.id)
    .order("created_at", { ascending: true });
  if (payErr) throw payErr;

  const isCash = (m) => /efectivo|cash/i.test(m ?? "");
  let cashApplied = 0;
  let cashVoided = 0;
  const cashPayments = [];
  for (const p of payments ?? []) {
    const mname = methodById.get(p.payment_method_id) ?? p.payment_method_id;
    if (!isCash(mname)) continue;
    cashPayments.push({ ...p, mname });
    const active = !p.voided_at && !/revers|anul|void/i.test(p.status ?? "");
    if (active) cashApplied += Number(p.amount ?? 0);
    else cashVoided += Number(p.amount ?? 0);
  }
  console.log(`\n-- Pagos EFECTIVO del cajero: ${cashPayments.length}`);
  console.log(`Efectivo aplicado (activo): ${money(cashApplied)}`);
  console.log(`Efectivo anulado/revertido: ${money(cashVoided)}`);

  // 7) Libro cash_movements por pago (verifica denominaciones vs monto)
  const payIds = cashPayments.map((p) => p.id);
  let movementsByPayment = new Map();
  if (payIds.length) {
    const { data: movs, error: mErr } = await supabase
      .from("cash_movements")
      .select("id, denomination_id, qty_delta, movement_type, payment_id, created_at")
      .eq("shift_id", openShift.id)
      .in("payment_id", payIds);
    if (mErr) throw mErr;
    for (const mv of movs ?? []) {
      const arr = movementsByPayment.get(mv.payment_id) ?? [];
      arr.push(mv);
      movementsByPayment.set(mv.payment_id, arr);
    }
  }

  console.log(`\n-- Reconciliacion por pago (PAYMENT_IN - CHANGE_OUT debe = monto)`);
  let ledgerMismatchTotal = 0;
  for (const p of cashPayments) {
    const movs = movementsByPayment.get(p.id) ?? [];
    let inVal = 0;
    let outVal = 0;
    for (const mv of movs) {
      const value = Number(denomById.get(mv.denomination_id)?.value ?? 0);
      const delta = Number(mv.qty_delta ?? 0);
      if (mv.movement_type === "PAYMENT_IN") inVal += value * delta;
      else if (mv.movement_type === "CHANGE_OUT") outVal += value * Math.abs(delta);
    }
    const netLedger = inVal - outVal;
    const expected = Number(p.amount ?? 0);
    const diff = netLedger - expected;
    const flag = Math.abs(diff) > 0.005 ? "  <<< DESCUADRE" : "";
    if (Math.abs(diff) > 0.005 && !p.voided_at) ledgerMismatchTotal += diff;
    console.log(
      `pago ${p.id.slice(0, 8)} monto=${money(expected)} recibido=${money(inVal)} cambio=${money(outVal)} netoLibro=${money(netLedger)} dif=${money(diff)} status=${p.status}${p.voided_at ? " (anulado)" : ""}${flag}`,
    );
  }

  // 8) Movimientos manuales del cajero
  const { data: manual } = await supabase
    .from("cash_register_movements")
    .select("id, amount, movement_type, reason, recorded_by, created_at")
    .eq("shift_id", openShift.id)
    .eq("recorded_by", cashier.id);
  let manualIn = 0;
  let manualOut = 0;
  for (const mv of manual ?? []) {
    const t = String(mv.movement_type ?? "").toLowerCase();
    if (/entrada|in/.test(t)) manualIn += Number(mv.amount ?? 0);
    else if (/salida|out/.test(t)) manualOut += Number(mv.amount ?? 0);
  }
  console.log(`\n-- Movimientos manuales: ${manual?.length ?? 0} (entradas ${money(manualIn)}, salidas ${money(manualOut)})`);
  for (const mv of manual ?? []) {
    console.log(`   ${mv.movement_type} ${money(mv.amount)} :: ${mv.reason} (${mv.created_at})`);
  }

  // 9) Ledger completo del cajero vs denoms (todas las denominaciones)
  console.log(`\n-- Reconciliacion global por denominacion (ini + libro vs actual)`);
  const allPayIdsCash = new Set(payIds);
  // Traer TODOS los movimientos del turno para este cajero (por sus pagos) + OPENING
  const { data: allMovs } = await supabase
    .from("cash_movements")
    .select("denomination_id, qty_delta, movement_type, payment_id, created_at")
    .eq("shift_id", openShift.id)
    .order("created_at", { ascending: true });
  const ledgerDeltaByDenom = new Map();
  for (const mv of allMovs ?? []) {
    // Solo contar movimientos ligados a pagos del cajero (PAYMENT_IN/CHANGE_OUT).
    // OPENING no tiene payment_id; se refleja en qty_initial.
    if (mv.payment_id && !allPayIdsCash.has(mv.payment_id)) continue;
    if (mv.movement_type === "OPENING") continue;
    // PAYMENT_IN suma; CHANGE_OUT resta (qty_delta puede venir positivo).
    const signedQty = mv.movement_type === "CHANGE_OUT"
      ? -Math.abs(Number(mv.qty_delta ?? 0))
      : Math.abs(Number(mv.qty_delta ?? 0));
    const prev = ledgerDeltaByDenom.get(mv.denomination_id) ?? 0;
    ledgerDeltaByDenom.set(mv.denomination_id, prev + signedQty);
  }
  let globalMismatch = 0;
  for (const r of denomRows) {
    const ledgerDelta = ledgerDeltaByDenom.get(r.denomination_id) ?? 0;
    const realDelta = r.qty_current - r.qty_initial;
    const diffQty = realDelta - ledgerDelta;
    const diffVal = diffQty * r.value;
    globalMismatch += diffVal;
    const flag = Math.abs(diffQty) > 0 ? "  <<<" : "";
    console.log(
      `${money(r.value).padEnd(8)} deltaReal=${String(realDelta).padStart(4)} deltaLibro=${String(ledgerDelta).padStart(4)} difQty=${String(diffQty).padStart(4)} difVal=${money(diffVal)}${flag}`,
    );
  }
  console.log(`Descuadre libro vs denoms: ${money(globalMismatch)}`);

  // 9b) Simulacion de saldo por denominacion (detecta faltantes fisicos:
  //     cuando el libro exige entregar mas monedas de las que hay en gaveta).
  console.log(`\n-- Simulacion de saldo por denominacion (¿alguna quedaria negativa?)`);
  const running = new Map();
  for (const r of denomRows) running.set(r.denomination_id, r.qty_initial);
  const worstNeg = new Map();
  const relevantMovs = (allMovs ?? []).filter(
    (mv) => (!mv.payment_id || allPayIdsCash.has(mv.payment_id)) && mv.movement_type !== "OPENING",
  );
  for (const mv of relevantMovs) {
    if (!running.has(mv.denomination_id)) running.set(mv.denomination_id, 0);
    const signedQty = mv.movement_type === "CHANGE_OUT"
      ? -Math.abs(Number(mv.qty_delta ?? 0))
      : Math.abs(Number(mv.qty_delta ?? 0));
    const next = running.get(mv.denomination_id) + signedQty;
    running.set(mv.denomination_id, next);
    const prevWorst = worstNeg.get(mv.denomination_id);
    if (prevWorst === undefined || next < prevWorst) worstNeg.set(mv.denomination_id, next);
  }
  for (const r of denomRows) {
    const worst = worstNeg.get(r.denomination_id);
    const finalBal = running.get(r.denomination_id);
    const flag = worst !== undefined && worst < 0 ? `  <<< quedaria en ${worst} (imposible fisicamente)` : "";
    console.log(
      `${money(r.value).padEnd(8)} saldoMin=${String(worst ?? r.qty_initial).padStart(4)} saldoFinalLibro=${String(finalBal).padStart(4)} saldoActualReal=${String(r.qty_current).padStart(4)}${flag}`,
    );
  }

  // 9c) Otros cajeros en el mismo turno (¿comparten cajon fisico?)
  console.log(`\n-- Cajeros con denominaciones en este turno`);
  const totalsByCashier = new Map();
  for (const row of shiftDenoms ?? []) {
    const cid = row.cashier_id ?? "sin_cashier_id";
    const value = Number(denomById.get(row.denomination_id)?.value ?? 0);
    const prev = totalsByCashier.get(cid) ?? { ini: 0, cur: 0 };
    prev.ini += value * Number(row.qty_initial ?? 0);
    prev.cur += value * Number(row.qty_current ?? 0);
    totalsByCashier.set(cid, prev);
  }
  const cashierIds = [...totalsByCashier.keys()].filter((c) => c !== "sin_cashier_id");
  const nameById = new Map();
  if (cashierIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, alias, username")
      .in("id", cashierIds);
    for (const p of profs ?? []) nameById.set(p.id, p.alias ?? p.username);
  }
  for (const [cid, t] of totalsByCashier) {
    console.log(`   ${nameById.get(cid) ?? cid}: apertura=${money(t.ini)} actual=${money(t.cur)}`);
  }

  // 10) Resumen
  const expectedDrawer = openingTotal + cashApplied + manualIn - manualOut;
  console.log(`\n===== RESUMEN =====`);
  console.log(`Apertura:                    ${money(openingTotal)}`);
  console.log(`+ Efectivo cobrado (activo): ${money(cashApplied)}`);
  console.log(`+ Entradas manuales:         ${money(manualIn)}`);
  console.log(`- Salidas manuales:          ${money(manualOut)}`);
  console.log(`= Esperado en caja:          ${money(expectedDrawer)}`);
  console.log(`Caja actual (denoms):        ${money(currentTotal)}`);
  console.log(`DESCUADRE (denoms-esperado): ${money(currentTotal - expectedDrawer)}`);
  console.log(`Descuadre libro (denoms):    ${money(globalMismatch)}`);
  console.log(`Descuadre por pagos (libro): ${money(ledgerMismatchTotal)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
