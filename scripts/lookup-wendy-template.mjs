import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const path = resolve(process.cwd(), ".env");
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function sig(rows) {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a.denomination_id.localeCompare(b.denomination_id))
      .map((r) => ({ d: r.denomination_id, q: Number(r.qty) })),
  );
}

const env = loadEnv();
const serviceRoleKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";
const supabase = createClient(env.VITE_SUPABASE_URL, serviceRoleKey);

async function main() {
  const { data: wendyRows, error: wErr } = await supabase
    .from("profiles")
    .select("id, full_name, username")
    .or("username.ilike.Wendy,full_name.ilike.%Wendy%")
    .limit(5);
  if (wErr) throw wErr;

  console.log("=== Perfiles Wendy ===");
  console.log(JSON.stringify(wendyRows, null, 2));
  if (!wendyRows?.length) {
    console.log("No se encontró perfil Wendy.");
    return;
  }

  const wendyId = wendyRows[0].id;

  const { data: shifts, error: sErr } = await supabase
    .from("cash_shifts")
    .select(
      "id, branch_id, status, opened_at, primary_cashier_id, secondary_caja_template_id, branches(name)",
    )
    .eq("status", "OPEN")
    .order("opened_at", { ascending: false });
  if (sErr) throw sErr;

  const wendyShifts = (shifts ?? []).filter(
    (shift) => shift.primary_cashier_id === wendyId,
  );

  console.log("\n=== Turnos OPEN (Wendy cajera principal) ===");
  console.log(JSON.stringify(wendyShifts, null, 2));

  if (!wendyShifts.length) {
    const { data: anyShiftUsers } = await supabase
      .from("cash_shift_users")
      .select("shift_id, can_use_caja, secondary_caja_template_id, cash_shifts(id, status, opened_at, branch_id, branches(name))")
      .eq("user_id", wendyId)
      .eq("is_enabled", true);
    console.log("\n=== Wendy en turnos (cualquier rol caja) ===");
    console.log(JSON.stringify(anyShiftUsers, null, 2));
    return;
  }

  for (const shift of wendyShifts) {
    console.log(`\n--- Turno ${shift.id} (${shift.branches?.name ?? "?"}) ---`);

    const { data: csu, error: csuErr } = await supabase
      .from("cash_shift_users")
      .select(
        "user_id, is_enabled, can_use_caja, secondary_caja_template_id",
      )
      .eq("shift_id", shift.id)
      .eq("user_id", wendyId)
      .maybeSingle();
    if (csuErr) throw csuErr;
    console.log("cash_shift_users:", csu);

    if (csu?.secondary_caja_template_id) {
      const { data: tpl } = await supabase
        .from("cash_register_templates")
        .select("id, name, is_active")
        .eq("id", csu.secondary_caja_template_id)
        .maybeSingle();
      console.log("Plantilla guardada en cash_shift_users:", tpl);
    } else {
      console.log("Plantilla en cash_shift_users: NULL (bug conocido para cajero principal)");
    }

    const { data: openings, error: oErr } = await supabase
      .from("cash_register_openings")
      .select("id, status, opened_at, register_role, initial_total")
      .eq("shift_id", shift.id)
      .eq("cashier_id", wendyId)
      .order("opened_at", { ascending: false });
    if (oErr) throw oErr;
    console.log("Aperturas de caja:", openings);

    const activeOpening =
      (openings ?? []).find((row) => row.status === "abierta") ?? openings?.[0];
    if (!activeOpening) {
      console.log("Sin apertura de caja registrada para Wendy en este turno.");
      continue;
    }

    const { data: denoms, error: dErr } = await supabase
      .from("cash_shift_denoms")
      .select("denomination_id, qty_initial, qty_current, opening_id")
      .eq("shift_id", shift.id)
      .eq("cashier_id", wendyId);
    if (dErr) throw dErr;

    const openingDenoms = (denoms ?? []).filter(
      (row) =>
        !activeOpening.id ||
        row.opening_id === activeOpening.id ||
        row.opening_id == null,
    );

    const denomSig = sig(
      openingDenoms.map((row) => ({
        denomination_id: row.denomination_id,
        qty: row.qty_initial ?? row.qty_current ?? 0,
      })),
    );

    const { data: templates, error: tErr } = await supabase
      .from("cash_register_templates")
      .select(
        "id, name, is_active, cash_register_template_denoms(denomination_id, qty)",
      )
      .eq("branch_id", shift.branch_id)
      .eq("is_active", true);
    if (tErr) throw tErr;

    const matches = [];
    for (const tpl of templates ?? []) {
      const rows = (tpl.cash_register_template_denoms ?? []).map((row) => ({
        denomination_id: row.denomination_id,
        qty: row.qty,
      }));
      if (sig(rows) === denomSig) {
        matches.push({ id: tpl.id, name: tpl.name });
      }
    }

    console.log("Plantilla(s) que coinciden con el arqueo actual:", matches);

    if (shift.secondary_caja_template_id) {
      const { data: shiftTpl } = await supabase
        .from("cash_register_templates")
        .select("id, name")
        .eq("id", shift.secondary_caja_template_id)
        .maybeSingle();
      console.log("cash_shifts.secondary_caja_template_id:", shiftTpl);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
