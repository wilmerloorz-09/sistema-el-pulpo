/**
 * Cierra el turno OPEN actual sin cleanup (deja PAID/borradores como están).
 * Uso: node scripts/close-open-shift-for-repro.mjs [nombre-sucursal]
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
  if (!path) throw new Error("No se encontró .env.local ni .env");
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const branchNameFilter = process.argv[2] ?? "Sucursal de Prueba";
const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: branches, error: bErr } = await supabase
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .ilike("name", `%${branchNameFilter}%`);
  if (bErr) throw bErr;
  if (!branches?.length) {
    console.error(`No hay sucursal activa que coincida con: ${branchNameFilter}`);
    process.exit(1);
  }

  for (const branch of branches) {
    const { data: shifts, error: sErr } = await supabase
      .from("cash_shifts")
      .select("id, shift_code, shift_number, opened_at, caja_status, status")
      .eq("branch_id", branch.id)
      .eq("status", "OPEN")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (sErr) throw sErr;

    const shift = shifts?.[0];
    if (!shift) {
      console.log(`[${branch.name}] Sin turno OPEN — omitido.`);
      continue;
    }

    const { data: openings, error: oErr } = await supabase
      .from("cash_register_openings")
      .select("id, status, cashier_id")
      .eq("shift_id", shift.id)
      .eq("status", "abierta");
    if (oErr) throw oErr;

    const now = new Date().toISOString();

    if (openings?.length) {
      const { error: closeOpeningsErr } = await supabase
        .from("cash_register_openings")
        .update({ status: "cerrada", closed_at: now })
        .eq("shift_id", shift.id)
        .eq("status", "abierta");
      if (closeOpeningsErr) throw closeOpeningsErr;
    }

    const { error: cajaErr } = await supabase
      .from("cash_shifts")
      .update({ caja_status: "CLOSED" })
      .eq("id", shift.id)
      .eq("status", "OPEN");
    if (cajaErr) throw cajaErr;

    const { error: shiftErr } = await supabase
      .from("cash_shifts")
      .update({
        status: "CLOSED",
        closed_at: now,
        notes: "Cierre forzado para prueba repro turno nuevo / Mesa 1 (sin limpieza)",
      })
      .eq("id", shift.id)
      .eq("status", "OPEN");
    if (shiftErr) throw shiftErr;

    const { error: tablesErr } = await supabase
      .from("restaurant_tables")
      .update({ is_active: false })
      .eq("branch_id", branch.id);
    if (tablesErr) throw tablesErr;

    const { data: paidOnTables } = await supabase
      .from("orders")
      .select("id, order_code, table_id, status, cash_shift_id")
      .eq("branch_id", branch.id)
      .eq("cash_shift_id", shift.id)
      .in("status", ["PAID", "DRAFT", "SENT_TO_KITCHEN", "READY"])
      .not("table_id", "is", null);

    console.log(`\n=== Turno cerrado: ${branch.name} ===`);
    console.log(`shift_id: ${shift.id}`);
    console.log(`codigo: ${shift.shift_code ?? shift.shift_number ?? "—"}`);
    console.log(`cajas cerradas: ${openings?.length ?? 0}`);
    console.log(`ordenes en mesa dejadas intactas: ${paidOnTables?.length ?? 0}`);
    if (paidOnTables?.length) {
      for (const o of paidOnTables.slice(0, 8)) {
        console.log(`  - ${o.order_code ?? o.id} status=${o.status} table_id=${o.table_id}`);
      }
      if (paidOnTables.length > 8) console.log(`  ... y ${paidOnTables.length - 8} mas`);
    }
  }

  const { data: stillOpen } = await supabase
    .from("cash_shifts")
    .select("id, branch_id")
    .eq("status", "OPEN");
  if (stillOpen?.length) {
    console.warn(`\nAtencion: quedan ${stillOpen.length} turno(s) OPEN en otras sucursales.`);
  } else {
    console.log("\nNo quedan turnos OPEN en el proyecto.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
