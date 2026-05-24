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
  const { data, error } = await supabase.rpc('get_my_branch_shift_gate', { p_branch_id: 'c4e4b52e-fb01-4467-8f52-fb9f829ecfc0' });
  console.log(data);
}

run();
