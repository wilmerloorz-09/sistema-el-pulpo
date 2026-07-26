/**
 * Diagnostico temporal: Mesa 1 en "Sucursal de Prueba" entra y se sale.
 * Uso: node scripts/debug_mesa1_entra_sale.mjs
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
    .select("id, name, workflow_mode");
  if (bErr) throw bErr;
  console.log("\n=== Sucursales visibles ===");
  for (const b of branches ?? []) console.log(`${b.name} | ${b.id} | ${b.workflow_mode}`);
  const branch =
    (branches ?? []).find((b) => String(b.name).trim().toLowerCase() === "sucursal de prueba")
    ?? (branches ?? []).find((b) => /sucursal de prueba/i.test(String(b.name)));
  if (!branch) throw new Error("No se encontro Sucursal de Prueba");
  console.log("\n=== Sucursal ===");
  console.log(branch);

  const { data: shifts } = await supabase
    .from("cash_shifts")
    .select("id, status, opened_at, closed_at, active_tables_count")
    .eq("branch_id", branch.id)
    .eq("status", "OPEN")
    .order("opened_at", { ascending: false })
    .limit(1);
  const shift = shifts?.[0] ?? null;
  console.log("\n=== Turno abierto ===");
  console.log(shift ?? "(sin turno abierto)");

  const { data: tables } = await supabase
    .from("restaurant_tables")
    .select("id, name, is_active, visual_order")
    .eq("branch_id", branch.id)
    .order("visual_order");
  console.log("\n=== Mesas ===");
  for (const t of tables ?? []) console.log(`${t.name} | id=${t.id} | activa=${t.is_active} | orden_visual=${t.visual_order}`);

  const mesa1 = (tables ?? []).find((t) => /mesa\s*1$/i.test(String(t.name).trim()));
  if (!mesa1) throw new Error("No se encontro Mesa 1");

  console.log("\n=== Overview RPC (get_branch_tables_overview) ===");
  const { data: overview, error: ovErr } = await supabase.rpc("get_branch_tables_overview", {
    p_branch_id: branch.id,
  });
  if (ovErr) console.log("overview error:", ovErr.message);
  for (const row of overview ?? []) {
    console.log(
      `${row.table_name} | status=${row.status} | active_order=${row.active_order_id ?? "-"} | order_status=${row.active_order_status ?? "-"} | total_due=${row.total_due} | items=${row.item_count}`,
    );
  }

  console.log("\n=== Ordenes DINE_IN de Mesa 1 (todas, recientes primero) ===");
  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select(
      "id, order_number, order_code, status, is_special, special_group_total, special_total_manual, special_reason, table_id, table_order_position, cash_shift_id, created_at, sent_to_kitchen_at, ready_at, dispatched_at, paid_at, cancelled_at, notes",
    )
    .eq("table_id", mesa1.id)
    .eq("order_type", "DINE_IN")
    .order("created_at", { ascending: false })
    .limit(15);
  if (oErr) console.log("orders error:", oErr.message);
  for (const o of orders ?? []) {
    console.log(
      JSON.stringify(
        {
          id: o.id,
          numero: o.order_number,
          code: o.order_code,
          status: o.status,
          is_special: o.is_special,
          special_group_total: o.special_group_total,
          special_total_manual: o.special_total_manual,
          shift: o.cash_shift_id,
          en_turno_abierto: shift ? o.cash_shift_id === shift.id : null,
          created_at: o.created_at,
          sent: o.sent_to_kitchen_at,
          dispatched: o.dispatched_at,
          paid: o.paid_at,
          cancelled: o.cancelled_at,
          notes: o.notes,
        },
        null,
        0,
      ),
    );
  }

  const orderIds = (orders ?? []).map((o) => o.id);
  if (orderIds.length > 0) {
    const { data: items } = await supabase
      .from("order_items")
      .select("id, order_id, description_snapshot, quantity, unit_price, status, cantidad_especial")
      .in("order_id", orderIds);
    console.log("\n=== Items por orden ===");
    const byOrder = {};
    for (const it of items ?? []) {
      (byOrder[it.order_id] ??= []).push(it);
    }
    for (const [oid, list] of Object.entries(byOrder)) {
      console.log(`orden ${oid}:`);
      for (const it of list) {
        console.log(
          `  - ${it.quantity}x ${it.description_snapshot} | status=${it.status} | especial=${it.cantidad_especial ?? 0}`,
        );
      }
    }

    const { data: payments } = await supabase
      .from("payments")
      .select("id, order_id, amount, status, notes, created_at")
      .in("order_id", orderIds)
      .order("created_at", { ascending: false });
    console.log("\n=== Pagos de esas ordenes ===");
    for (const p of payments ?? []) {
      console.log(
        `orden ${p.order_id} | pago ${p.id} | $${p.amount} | status=${p.status} | notes=${String(p.notes ?? "").slice(0, 120)}`,
      );
    }
  }

  console.log("\n=== Simulacion create_dine_in_order (NO ejecuta, solo chequeo de bloqueo) ===");
  if (shift) {
    const { data: blockers } = await supabase
      .from("orders")
      .select("id, status, cash_shift_id")
      .eq("table_id", mesa1.id)
      .eq("order_type", "DINE_IN")
      .eq("cash_shift_id", shift.id)
      .in("status", ["DRAFT", "SENT_TO_KITCHEN", "READY", "PAID"]);
    console.log(
      blockers?.length
        ? `create_dine_in_order FALLARIA: ${blockers.length} orden(es) activa(s) en turno actual -> ${blockers.map((b) => `${b.id}(${b.status})`).join(", ")}`
        : "create_dine_in_order NO estaria bloqueado (no hay DRAFT/SENT/READY/PAID en turno actual)",
    );
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message ?? err);
  process.exit(1);
});
