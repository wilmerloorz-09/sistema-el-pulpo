import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const envStr = fs.readFileSync(".env", "utf8");
const env = envStr.split("\n").reduce((acc, line) => {
  const [k, ...v] = line.split("=");
  if (k) acc[k.trim()] = v.join("=").trim().replace(/^"|"$/g, "");
  return acc;
}, {});

const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwbXN1aWdjdmVxdGp6YnBmaWhiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY1MzY4MSwiZXhwIjoyMDg4MjI5NjgxfQ.SQ3qbPP9-2k-apX4jxSRFDcRDCpTQEvRvmdNtOs1EAQ";
const supabase = createClient(env.VITE_SUPABASE_URL, serviceRoleKey);

async function run() {
  console.log("Fetching open cash shifts...");
  const { data: shifts, error: shiftError } = await supabase
    .from("cash_shifts")
    .select("id, branch_id, status, primary_cashier_id, secondary_cajas_enabled, secondary_caja_template_id")
    .eq("status", "OPEN");

  if (shiftError) {
    console.error("Error fetching shifts:", shiftError);
    return;
  }

  console.log("Open shifts:", shifts);

  for (const shift of shifts) {
    console.log(`\nUsers for shift ${shift.id}:`);
    const { data: users, error: userError } = await supabase
      .from("cash_shift_users")
      .select("*")
      .eq("shift_id", shift.id);

    if (userError) {
      console.error("Error fetching shift users:", userError);
      continue;
    }

    console.log(users);
  }
}

run();
