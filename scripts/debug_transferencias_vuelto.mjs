/**
 * Diagnostico: transferencias con vuelto en efectivo en el turno abierto.
 * Escenario planteado: transferencia por mas del valor a pagar, el vuelto
 * sale en efectivo de la gaveta (CHANGE_OUT ligado al pago transferencia).
 * Uso: node scripts/debug_transferencias_vuelto.mjs [sucursal]
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
const env = loadEnv();
const supabase = createClient(
  env.SUPABASE_URL || env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);
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
}

async function main() {
  await login();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .ilike("name", `%${branchFilter}%`);
  const branch = branches?.[0];
  if (!branch) throw new Error(`Sucursal no encontrada: ${branchFilter}`);

  const { data: shifts } = await supabase
    .from("cash_shifts")
    .select("id, shift_code, status, opened_at")
    .eq("branch_id", branch.id)
    .eq("status", "OPEN")
    .order("opened_at", { ascending: false })
    .limit(1);
  const shift = shifts?.[0];
  if (!shift) throw new Error("Sin turno OPEN");
  console.log(`Sucursal: ${branch.name} | Turno: ${shift.shift_code}`);

  const { data: methods } = await supabase.from("payment_methods").select("id, name");
  const methodById = new Map((methods ?? []).map((m) => [m.id, m.name]));
  const { data: denoms } = await supabase.from("denominations").select("id, value, label");
  const denomById = new Map((denoms ?? []).map((d) => [d.id, d]));

  const { data: payments, error } = await supabase
    .from("payments")
    .select("id, amount, change_amount, status, payment_method_id, created_by, created_at, banco_id, numero_transferencia, voided_at, notes")
    .eq("shift_id", shift.id)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const cashierIds = [...new Set((payments ?? []).map((p) => p.created_by))];
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, alias, username")
    .in("id", cashierIds);
  const nameById = new Map((profs ?? []).map((p) => [p.id, p.alias ?? p.username]));

  const isTransfer = (p) => {
    const mname = methodById.get(p.payment_method_id) ?? "";
    return /transfer/i.test(mname) || Boolean(p.numero_transferencia) || Boolean(p.banco_id);
  };
  const transfers = (payments ?? []).filter(isTransfer);
  console.log(`\n-- Pagos por transferencia en el turno: ${transfers.length}`);
  for (const p of transfers) {
    console.log(
      `   ${p.created_at} ${nameById.get(p.created_by) ?? "?"} monto=${money(p.amount)} vuelto=${money(p.change_amount)} status=${p.status}${p.voided_at ? " ANULADO" : ""}`,
    );
  }

  const withChange = transfers.filter((p) => Number(p.change_amount ?? 0) > 0.005);
  console.log(`\n-- Transferencias con vuelto (> $0): ${withChange.length}`);

  // Movimientos de gaveta ligados a CUALQUIER pago no-efectivo del turno
  const nonCashIds = transfers.map((t) => t.id);
  if (nonCashIds.length) {
    const { data: movs } = await supabase
      .from("cash_movements")
      .select("id, payment_id, movement_type, qty_delta, denomination_id, created_at")
      .eq("shift_id", shift.id)
      .in("payment_id", nonCashIds);
    console.log(`\n-- Movimientos de gaveta ligados a pagos por transferencia: ${movs?.length ?? 0}`);
    let totalChangeOut = 0;
    for (const mv of movs ?? []) {
      const d = denomById.get(mv.denomination_id);
      const value = Number(d?.value ?? 0) * Math.abs(Number(mv.qty_delta ?? 0));
      if (mv.movement_type === "CHANGE_OUT") totalChangeOut += value;
      const pay = transfers.find((t) => t.id === mv.payment_id);
      console.log(
        `   ${mv.movement_type} ${Math.abs(mv.qty_delta)} x ${money(d?.value)} = ${money(value)} (pago ${money(pay?.amount)} de ${nameById.get(pay?.created_by) ?? "?"}, ${mv.created_at})`,
      );
    }
    if (totalChangeOut > 0) {
      console.log(`   TOTAL vuelto en efectivo salido por transferencias: ${money(totalChangeOut)}`);
    }
    if (!movs?.length) {
      console.log("   (ninguno)");
    }
  }

  // Deteccion del hueco: transferencias con change_amount > 0 pero SIN CHANGE_OUT
  if (withChange.length) {
    console.log(`\n-- Verificacion transferencia con vuelto vs registro de gaveta`);
    for (const p of withChange) {
      const { data: movs } = await supabase
        .from("cash_movements")
        .select("id, movement_type, qty_delta, denomination_id")
        .eq("shift_id", shift.id)
        .eq("payment_id", p.id)
        .eq("movement_type", "CHANGE_OUT");
      const registered = (movs ?? []).reduce(
        (sum, mv) => sum + Number(denomById.get(mv.denomination_id)?.value ?? 0) * Math.abs(Number(mv.qty_delta ?? 0)),
        0,
      );
      const expected = Number(p.change_amount ?? 0);
      const diff = expected - registered;
      const flag = Math.abs(diff) > 0.005 ? "  <<< VUELTO NO DESCONTADO DE GAVETA" : "  ok";
      console.log(
        `   pago ${p.id.slice(0, 8)} ${nameById.get(p.created_by) ?? "?"} vueltoEsperado=${money(expected)} vueltoRegistrado=${money(registered)} dif=${money(diff)}${flag}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
