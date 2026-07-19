/**
 * Diagnostico: ordenes que aparecen en Recaudar pese a estar anuladas.
 * Uso: node scripts/debug_recaudar_anuladas.mjs [nombre-sucursal]
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

const branchNameFilter = process.argv[2] ?? "Sucursal de Prueba";
const env = loadEnv();
const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

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
  const { data: branches, error: bErr } = await supabase
    .from("branches")
    .select("id, name")
    .ilike("name", `%${branchNameFilter}%`);
  if (bErr) throw bErr;
  const branch = branches?.[0];
  if (!branch) {
    console.error("Sucursal no encontrada:", branchNameFilter);
    process.exit(1);
  }
  console.log(`Sucursal: ${branch.name} (${branch.id})`);

  const { data: shifts } = await supabase
    .from("cash_shifts")
    .select("id, shift_code, status, opened_at")
    .eq("branch_id", branch.id)
    .eq("status", "OPEN")
    .order("opened_at", { ascending: false })
    .limit(1);
  const shift = shifts?.[0];
  if (!shift) {
    console.log("Sin turno OPEN en la sucursal.");
    return;
  }
  console.log(`Turno OPEN: ${shift.shift_code ?? shift.id}`);

  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select("id, order_number, order_code, order_type, status, is_special, notes, cancelled_at, created_at, updated_at")
    .eq("branch_id", branch.id)
    .eq("cash_shift_id", shift.id)
    .in("status", ["SENT_TO_KITCHEN", "READY", "KITCHEN_DISPATCHED"])
    .order("updated_at", { ascending: false });
  if (oErr) throw oErr;

  console.log(`\nOrdenes en estados pagables (aparecen en Recaudar): ${orders?.length ?? 0}`);

  for (const order of orders ?? []) {
    const { data: cancels } = await supabase
      .from("order_cancellations")
      .select("id, cancellation_type, status, reason, created_at")
      .eq("order_id", order.id);

    const { data: snapshot, error: sErr } = await supabase.rpc("get_order_operational_snapshot", {
      p_order_id: order.id,
    });

    let totals = null;
    if (!sErr && Array.isArray(snapshot)) {
      totals = snapshot.reduce(
        (acc, row) => {
          acc.ordered += Number(row.quantity_ordered ?? 0);
          acc.cancelled += Number(row.quantity_cancelled_total ?? 0);
          acc.dispatchedNet += Math.max(
            0,
            Number(row.quantity_dispatched_total ?? row.quantity_dispatched ?? 0) -
              Number(row.quantity_cancelled_dispatched ?? 0),
          );
          acc.paid += Number(row.quantity_paid ?? 0);
          acc.pendingPrepare += Number(row.quantity_pending_prepare ?? 0);
          acc.readyAvailable += Number(row.quantity_ready_available ?? 0);
          return acc;
        },
        { ordered: 0, cancelled: 0, dispatchedNet: 0, paid: 0, pendingPrepare: 0, readyAvailable: 0 },
      );
    }

    console.log(`\n--- Orden #${order.order_number} (${order.order_code ?? order.id})`);
    console.log(`   status=${order.status} type=${order.order_type} cancelled_at=${order.cancelled_at}`);
    console.log(`   notes=${JSON.stringify(order.notes)}`);
    if (totals) {
      console.log(
        `   snapshot: pedido=${totals.ordered} cancelado=${totals.cancelled} despachadoNeto=${totals.dispatchedNet} pagado=${totals.paid} pendPrep=${totals.pendingPrepare} listoDisp=${totals.readyAvailable}`,
      );
    } else {
      console.log(`   snapshot: error -> ${sErr?.message}`);
    }
    if (cancels?.length) {
      for (const c of cancels) {
        console.log(`   anulacion: type=${c.cancellation_type} status=${c.status} reason=${c.reason}`);
      }
    } else {
      console.log("   sin registros en order_cancellations");
    }
  }

  const { data: cancelledOrders } = await supabase
    .from("orders")
    .select("id, order_number, order_code, status, cancelled_at, updated_at")
    .eq("branch_id", branch.id)
    .eq("cash_shift_id", shift.id)
    .eq("status", "CANCELLED")
    .order("updated_at", { ascending: false })
    .limit(10);
  console.log(`\nOrdenes CANCELLED del turno (no deberian salir en Recaudar): ${cancelledOrders?.length ?? 0}`);
  for (const order of cancelledOrders ?? []) {
    console.log(`   #${order.order_number} ${order.order_code ?? order.id} cancelled_at=${order.cancelled_at}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
