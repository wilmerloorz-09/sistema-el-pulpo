/** Compara ordenes PAID del turno abierto actual: cuales conservan table_id. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  const path = [".env.local", ".env"]
    .map((n) => resolve(process.cwd(), n))
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
const supabase = createClient(
  env.SUPABASE_URL || env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: auth, error } = await supabase.functions.invoke("login-with-identifier", {
    body: { identifier: "wloor", password: "wkim919293" },
  });
  if (error || auth?.error) throw new Error("login fallo");
  await supabase.auth.setSession({
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
  });

  const shiftId = "dcb83862-4eba-4f46-9355-69801f8b5c48";
  const { data: orders, error: oErr } = await supabase
    .from("orders")
    .select("id, order_number, order_type, status, is_special, table_id, dispatched_at, paid_at, created_at")
    .eq("cash_shift_id", shiftId)
    .order("created_at", { ascending: true });
  if (oErr) throw oErr;

  console.log("Ordenes del turno abierto (dcb83862):");
  for (const o of orders ?? []) {
    console.log(
      `#${o.order_number} | ${o.order_type} | ${o.status} | especial=${o.is_special} | table_id=${o.table_id ?? "NULL"} | dispatched=${o.dispatched_at ? "si" : "no"} | paid=${o.paid_at ? "si" : "no"}`,
    );
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message ?? e);
  process.exit(1);
});
