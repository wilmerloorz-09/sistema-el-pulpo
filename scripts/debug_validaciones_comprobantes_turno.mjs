/**
 * Diagnostico: validaciones IA de comprobantes de transferencia del turno.
 * Busca discrepancias de monto (cliente transfirio mas de lo registrado).
 * Uso: node scripts/debug_validaciones_comprobantes_turno.mjs [sucursal]
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
    .select("id, shift_code")
    .eq("branch_id", branch.id)
    .eq("status", "OPEN")
    .order("opened_at", { ascending: false })
    .limit(1);
  const shift = shifts?.[0];
  if (!shift) throw new Error("Sin turno OPEN");
  console.log(`Sucursal: ${branch.name} | Turno: ${shift.shift_code}`);

  const { data: payments } = await supabase
    .from("payments")
    .select("id, amount, created_at, created_by, numero_transferencia")
    .eq("shift_id", shift.id)
    .not("numero_transferencia", "is", null);
  const payIds = (payments ?? []).map((p) => p.id);
  console.log(`Pagos por transferencia: ${payIds.length}`);
  if (!payIds.length) return;

  const { data: validaciones, error } = await supabase
    .from("validaciones_comprobantes_transferencia")
    .select("*")
    .in("pago_id", payIds);
  if (error) throw error;
  console.log(`\nValidaciones registradas: ${validaciones?.length ?? 0}`);

  for (const v of validaciones ?? []) {
    const pay = (payments ?? []).find((p) => p.id === v.pago_id);
    const analisis = v.analisis_ia ?? {};
    const montoDetectado = analisis.monto ?? analisis.montoDetectado ?? null;
    const flag =
      montoDetectado != null && pay && Math.abs(Number(montoDetectado) - Number(pay.amount)) > 0.005
        ? `  <<< MONTO COMPROBANTE ${money(montoDetectado)} != REGISTRADO ${money(pay.amount)}`
        : "";
    console.log(
      `\n- pago ${v.pago_id.slice(0, 8)} registrado=${money(pay?.amount)} nro=${pay?.numero_transferencia}`,
    );
    console.log(`  estado=${v.estado} montoDetectadoIA=${montoDetectado != null ? money(montoDetectado) : "n/d"}${flag}`);
    if (v.novedades?.length) console.log(`  novedades=${JSON.stringify(v.novedades)}`);
    if (v.motivo_aceptacion) console.log(`  motivo="${v.motivo_aceptacion}"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
